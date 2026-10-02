using System.Text.Json;
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class OpencodeDatabase
{
    private const string UsageRowsQuery = """
        SELECT s.directory, m.id, s.id, s.title, s.parent_id,
               s.time_created, m.time_created, m.data
        FROM session s
        JOIN message m ON m.session_id = s.id
        WHERE json_extract(m.data, '$.role') = 'assistant'
        """;

    private const string CostSummaryQuery = """
        SELECT COALESCE(json_extract(m.data, '$.providerID'), ''),
               COALESCE(json_extract(m.data, '$.modelID'), ''),
               COUNT(CASE WHEN json_extract(m.data, '$.cost') > 0 THEN 1 END),
               COALESCE(SUM(CASE WHEN json_extract(m.data, '$.cost') > 0
                                 THEN json_extract(m.data, '$.cost') ELSE 0 END), 0)
        FROM message m
        WHERE json_extract(m.data, '$.role') = 'assistant'
        GROUP BY json_extract(m.data, '$.providerID'), json_extract(m.data, '$.modelID')
        HAVING SUM(CASE WHEN json_extract(m.data, '$.cost') > 0
                        THEN json_extract(m.data, '$.cost') ELSE 0 END) > 0
        ORDER BY 1, 2
        """;

    private const string SessionRowsQuery = """
        SELECT id, directory, title, parent_id
        FROM session
        ORDER BY id
        """;

    private const string IgnoredRowsQuery = """
        SELECT id, session_id, COALESCE(json_extract(data, '$.role'), '')
        FROM message
        WHERE COALESCE(json_extract(data, '$.role'), '') <> 'assistant'
        ORDER BY id
        """;

    public static List<UsageRow> LoadUsageRows(string databasePath)
    {
        using var connection = OpenReadOnly(databasePath);
        return ReadUsageRows(connection, transaction: null);
    }

    public static DatabaseAuditSnapshot LoadAuditSnapshot(string databasePath)
    {
        using var connection = OpenReadOnly(databasePath);
        using var transaction = connection.BeginTransaction(deferred: true);
        var rows = ReadUsageRows(connection, transaction);
        var totalSessions = CountRows(connection, transaction, "session");
        var totalMessages = CountRows(connection, transaction, "message");
        var sessionRows = ReadSessionRows(connection, transaction);
        var ignoredRows = ReadIgnoredRows(connection, transaction);
        transaction.Commit();
        return new DatabaseAuditSnapshot(rows, ignoredRows, sessionRows, totalSessions, totalMessages);
    }

    private static List<UsageRow> ReadUsageRows(SqliteConnection connection, SqliteTransaction? transaction)
    {
        using var command = connection.CreateCommand();
        command.CommandText = UsageRowsQuery;
        command.Transaction = transaction;
        using var reader = command.ExecuteReader();
        var rows = new List<UsageRow>();

        while (reader.Read())
        {
            var rawData = reader.GetString(7);
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
                rows.Add(new UsageRow(
                    MessageId: reader.GetString(1),
                    Project: reader.GetString(0),
                    SessionId: reader.GetString(2),
                    Title: reader.GetString(3),
                    ParentId: reader.IsDBNull(4) ? null : reader.GetString(4),
                    Date: reader.GetInt64(5),
                    MessageDate: ReadIntegerTimestamp(reader.GetValue(6)),
                    Provider: ReadStringOrEmpty(data, "providerID"),
                    Model: ReadStringOrEmpty(data, "modelID"),
                    StoredCost: ReadStoredCost(data),
                    Tokens: ParseTokens(data)));
            }
        }

        return rows;
    }

    public static List<CostSummary> LoadCostSummary(string databasePath)
    {
        using var connection = OpenReadOnly(databasePath);
        using var command = connection.CreateCommand();
        command.CommandText = CostSummaryQuery;
        using var reader = command.ExecuteReader();
        var summaries = new List<CostSummary>();
        while (reader.Read())
        {
            var messages = reader.GetInt64(2);
            if (messages < 0)
            {
                throw new InvalidDataException("Invalid stored-cost message count.");
            }
            summaries.Add(new CostSummary(
                Provider: reader.GetString(0),
                Model: reader.GetString(1),
                Messages: (ulong)messages,
                StoredCost: reader.GetDouble(3),
                Configured: false));
        }
        return summaries;
    }

    private static long CountRows(SqliteConnection connection, SqliteTransaction transaction, string table)
    {
        var query = table switch
        {
            "session" => "SELECT COUNT(*) FROM session",
            "message" => "SELECT COUNT(*) FROM message",
            _ => throw new ArgumentOutOfRangeException(nameof(table)),
        };
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = query;
        return Convert.ToInt64(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
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
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }
        return rows;
    }

    private static List<IgnoredRow> ReadIgnoredRows(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = IgnoredRowsQuery;
        using var reader = command.ExecuteReader();
        var rows = new List<IgnoredRow>();
        while (reader.Read())
        {
            rows.Add(new IgnoredRow(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        }
        return rows;
    }

    private static SqliteConnection OpenReadOnly(string databasePath)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
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
