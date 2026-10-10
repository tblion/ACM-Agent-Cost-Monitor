// Reads OpenCode SQLite records into a privacy-preserving import snapshot.
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class OpencodeDatabase
{
    private const string SessionRowsQuery = """
        SELECT id, directory, title, parent_id, time_created
        FROM session
        ORDER BY id
        """;

    private const string ImportMessagesQuery = """
        SELECT id, session_id, time_created, data
        FROM message
        ORDER BY id
        """;

    private const string SessionV2RowsQuery = """
        SELECT id, directory, title, parent_id, time_created
        FROM session_v2
        ORDER BY id
        """;

    private const string ImportMessagesV2Query = """
        SELECT id, session_id, type, time_created, data
        FROM session_message
        ORDER BY id
        """;

    public static SourceImportSnapshot LoadImportSnapshot(string databasePath)
    {
        using var connection = OpenReadOnly(databasePath);
        using var transaction = connection.BeginTransaction(deferred: true);
        var hasVersionOneTables = TableExists(connection, transaction, "session")
            && TableExists(connection, transaction, "message");
        var hasVersionTwoTables = TableExists(connection, transaction, "session_v2")
            && TableExists(connection, transaction, "session_message");
        if (!hasVersionOneTables && !hasVersionTwoTables)
        {
            throw new InvalidDataException("Aucune table de sessions OpenCode V1 ou V2 n’a été trouvée.");
        }

        var sessionsById = new Dictionary<string, SourceSessionRow>(StringComparer.Ordinal);
        var messagesById = new Dictionary<string, SourceMessageRow>(StringComparer.Ordinal);
        if (hasVersionOneTables)
        {
            foreach (var session in ReadSessionRows(connection, transaction))
            {
                sessionsById[session.SessionId] = new SourceSessionRow(
                    session.SessionId, session.Project, session.Title, session.ParentId, session.Date);
            }
            foreach (var message in ReadImportMessages(connection, transaction))
            {
                messagesById[message.MessageId] = message;
            }
        }

        if (hasVersionTwoTables)
        {
            foreach (var session in ReadSessionV2Rows(connection, transaction))
            {
                sessionsById[session.SessionId] = new SourceSessionRow(
                    session.SessionId, session.Project, session.Title, session.ParentId, session.Date);
            }
            foreach (var message in ReadImportMessagesV2(connection, transaction))
            {
                messagesById[message.MessageId] = message;
            }
        }

        var sessions = sessionsById.Values.OrderBy(session => session.SessionId, StringComparer.Ordinal).ToArray();
        var messages = messagesById.Values.OrderBy(message => message.MessageId, StringComparer.Ordinal).ToArray();
        transaction.Commit();
        return new SourceImportSnapshot(sessions, messages);
    }

    private static bool TableExists(SqliteConnection connection, SqliteTransaction transaction, string tableName)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name)";
        command.Parameters.AddWithValue("$name", tableName);
        return Convert.ToInt64(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture) != 0;
    }

    private static List<DatabaseSessionRow> ReadSessionRows(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = SessionRowsQuery;
        using var reader = command.ExecuteReader();
        var rows = new List<DatabaseSessionRow>();
        while (reader.Read())
        {
            rows.Add(new DatabaseSessionRow(
                reader.GetString(0),
                reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetInt64(4)));
        }
        return rows;
    }

    private static List<DatabaseSessionRow> ReadSessionV2Rows(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = SessionV2RowsQuery;
        using var reader = command.ExecuteReader();
        var rows = new List<DatabaseSessionRow>();
        while (reader.Read())
        {
            rows.Add(new DatabaseSessionRow(
                reader.GetString(0),
                reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                reader.IsDBNull(2) ? string.Empty : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetInt64(4)));
        }
        return rows;
    }

    private static List<SourceMessageRow> ReadImportMessages(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = ImportMessagesQuery;
        using var reader = command.ExecuteReader();
        var rows = new List<SourceMessageRow>();
        while (reader.Read())
        {
            var rawData = reader.GetString(3);
            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(rawData);
            }
            catch (JsonException exception)
            {
                throw new InvalidDataException($"Ligne de message illisible: {exception.Message}", exception);
            }

            using (document)
            {
                var data = document.RootElement;
                rows.Add(new SourceMessageRow(
                    reader.GetString(0),
                    reader.GetString(1),
                    ReadStringOrEmpty(data, "role"),
                    ReadIntegerTimestamp(reader.GetValue(2)),
                    ReadStringOrEmpty(data, "providerID"),
                    ReadStringOrEmpty(data, "modelID"),
                    ReadStoredCost(data),
                    ParseTokens(data)));
            }
        }

        return rows;
    }

    private static List<SourceMessageRow> ReadImportMessagesV2(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = ImportMessagesV2Query;
        using var reader = command.ExecuteReader();
        var rows = new List<SourceMessageRow>();
        while (reader.Read())
        {
            using var document = ParseMessageData(reader.GetString(4));
            var data = document.RootElement;
            rows.Add(new SourceMessageRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                ReadIntegerTimestamp(reader.GetValue(3)),
                ReadNestedString(data, "model", "providerID"),
                ReadNestedString(data, "model", "id"),
                ReadStoredCost(data),
                ParseTokens(data)));
        }

        return rows;
    }

    private static JsonDocument ParseMessageData(string rawData)
    {
        try
        {
            return JsonDocument.Parse(rawData);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"Ligne de message illisible: {exception.Message}", exception);
        }
    }

    private static SqliteConnection OpenReadOnly(string databasePath)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false,
        }.ToString();
        var connection = new SqliteConnection(connectionString)
        {
            DefaultTimeout = 5,
        };

        try
        {
            connection.Open();
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private static long? ReadIntegerTimestamp(object value) => value is long timestamp ? timestamp : null;

    private static string ReadNestedString(JsonElement value, string objectName, string propertyName) =>
        value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(objectName, out var nested)
        && nested.ValueKind == JsonValueKind.Object
        ? ReadStringOrEmpty(nested, propertyName)
        : string.Empty;

    private static string ReadStringOrEmpty(JsonElement value, string propertyName) =>
        value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(propertyName, out var property)
        && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? string.Empty
            : string.Empty;

    private static double ReadStoredCost(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object
            && value.TryGetProperty("cost", out var cost)
            && cost.ValueKind == JsonValueKind.Number
            && cost.TryGetDouble(out var number)
            && double.IsFinite(number))
        {
            return number;
        }
        return 0;
    }

    private static Tokens? ParseTokens(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object
            || !value.TryGetProperty("tokens", out var tokenObject)
            || tokenObject.ValueKind != JsonValueKind.Object
            || !TryReadTokenNumber(tokenObject, "input", out var input)
            || !TryReadTokenNumber(tokenObject, "output", out var output)
            || !tokenObject.TryGetProperty("cache", out var cache)
            || cache.ValueKind != JsonValueKind.Object
            || !TryReadTokenNumber(cache, "read", out var cacheRead)
            || !TryReadTokenNumber(cache, "write", out var cacheWrite)
            || !TryReadTokenNumber(tokenObject, "reasoning", out var reasoning))
        {
            return null;
        }

        return new Tokens(input, output, cacheRead, cacheWrite, reasoning);
    }

    private static bool TryReadTokenNumber(JsonElement value, string propertyName, out double number)
    {
        number = 0;
        return value.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.Number
            && property.TryGetDouble(out number)
            && double.IsFinite(number)
            && number >= 0;
    }
}
