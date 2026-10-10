// Owns the normalized, application-managed SQLite usage database.
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class InternalDatabase
{
    private const int SchemaVersion = 2;
    private const int ApplicationId = 1_414_284_359;
    private const string UnknownProjectId = "acm:unknown-project";
    private const string UnknownProjectName = "Inconnu";

    private const string Schema = """
        CREATE TABLE agents (
            agent_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL
        );
        CREATE TABLE data_sources (
            source_id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL REFERENCES agents(agent_id),
            source_key TEXT NOT NULL,
            source_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_imported_at TEXT,
            last_sync_attempt_at TEXT NOT NULL,
            last_sync_error TEXT,
            UNIQUE(agent_id, source_key)
        );
        CREATE TABLE source_channels (
            source_id TEXT NOT NULL REFERENCES data_sources(source_id),
            channel_key TEXT NOT NULL,
            channel_path TEXT NOT NULL,
            last_imported_at TEXT,
            last_sync_attempt_at TEXT NOT NULL,
            last_sync_error TEXT,
            PRIMARY KEY(source_id, channel_key)
        );
        CREATE TABLE providers (
            provider_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL
        );
        CREATE TABLE models (
            provider_id TEXT NOT NULL REFERENCES providers(provider_id),
            model_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            PRIMARY KEY(provider_id, model_id)
        );
        CREATE TABLE projects (
            source_id TEXT NOT NULL REFERENCES data_sources(source_id),
            external_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            project_path TEXT NOT NULL,
            PRIMARY KEY(source_id, external_id)
        );
        CREATE TABLE sessions (
            source_id TEXT NOT NULL REFERENCES data_sources(source_id),
            external_id TEXT NOT NULL,
            project_external_id TEXT NOT NULL,
            title TEXT NOT NULL,
            parent_external_id TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(source_id, external_id),
            FOREIGN KEY(source_id, project_external_id)
                REFERENCES projects(source_id, external_id)
        );
        CREATE TABLE messages (
            source_id TEXT NOT NULL REFERENCES data_sources(source_id),
            external_id TEXT NOT NULL,
            session_external_id TEXT NOT NULL,
            role TEXT NOT NULL,
            message_at INTEGER,
            provider_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            stored_cost REAL NOT NULL,
            input_tokens REAL,
            output_tokens REAL,
            cache_read_tokens REAL,
            cache_write_tokens REAL,
            reasoning_tokens REAL,
            PRIMARY KEY(source_id, external_id),
            FOREIGN KEY(provider_id, model_id)
                REFERENCES models(provider_id, model_id)
        );
        CREATE INDEX ix_messages_role_date ON messages(role, message_at);
        CREATE INDEX ix_sessions_project_date ON sessions(project_external_id, created_at);
        """;

    public static string DatabasePath => PathResolver.InternalDatabasePath();

    public static void ImportSource(
        string agentId,
        string agentName,
        string sourceKey,
        string sourcePath,
        SourceImportSnapshot snapshot,
        string channelKey = "database",
        string? channelPath = null)
    {
        var fullSourcePath = Path.GetFullPath(sourcePath);
        var fullChannelPath = Path.GetFullPath(channelPath ?? sourcePath);
        var sourceId = CreateSourceId(agentId, sourceKey);
        using var connection = Open(DatabasePath);
        using var transaction = connection.BeginTransaction(deferred: false);
        var importedAt = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture);

        Execute(connection, transaction,
            "INSERT INTO agents(agent_id, display_name) VALUES($id, $name) ON CONFLICT(agent_id) DO NOTHING",
            ("$id", agentId), ("$name", agentName));
        Execute(connection, transaction, """
            INSERT INTO data_sources(
                source_id, agent_id, source_key, source_path, created_at,
                last_imported_at, last_sync_attempt_at, last_sync_error)
            VALUES($id, $agent, $key, $path, $created, $imported, $imported, NULL)
            ON CONFLICT(source_id) DO UPDATE SET
                source_path = excluded.source_path,
                last_imported_at = excluded.last_imported_at,
                last_sync_attempt_at = excluded.last_sync_attempt_at,
                last_sync_error = NULL
            """,
            ("$id", sourceId), ("$agent", agentId), ("$key", sourceKey), ("$path", fullSourcePath),
            ("$created", importedAt), ("$imported", importedAt));
        Execute(connection, transaction, """
            INSERT INTO source_channels(source_id, channel_key, channel_path, last_imported_at, last_sync_attempt_at, last_sync_error)
            VALUES($source, $channel, $path, $imported, $imported, NULL)
            ON CONFLICT(source_id, channel_key) DO UPDATE SET
                channel_path = excluded.channel_path,
                last_imported_at = excluded.last_imported_at,
                last_sync_attempt_at = excluded.last_sync_attempt_at,
                last_sync_error = NULL
            """,
            ("$source", sourceId), ("$channel", channelKey), ("$path", fullChannelPath), ("$imported", importedAt));
        if (agentId == "opencode" && channelKey == "database")
        {
            Execute(connection, transaction, """
                INSERT OR IGNORE INTO source_channels(source_id, channel_key, channel_path, last_imported_at, last_sync_attempt_at, last_sync_error)
                VALUES($source, 'api', $path, NULL, $attempted, NULL)
                """,
                ("$source", sourceId), ("$path", PathResolver.OpenCodeServiceStatePath()), ("$attempted", importedAt));
        }

        foreach (var session in snapshot.Sessions)
        {
            var projectId = ProjectId(session.Project);
            var projectName = ProjectName(session.Project);
            var projectPath = string.IsNullOrWhiteSpace(session.Project) ? string.Empty : session.Project;
            Execute(connection, transaction, """
                INSERT INTO projects(source_id, external_id, display_name, project_path)
                VALUES($source, $project, $name, $path)
                ON CONFLICT(source_id, external_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    project_path = excluded.project_path
                """,
                ("$source", sourceId), ("$project", projectId),
                ("$name", projectName), ("$path", projectPath));
        }

        foreach (var session in snapshot.Sessions)
        {
            Execute(connection, transaction, """
                INSERT INTO sessions(source_id, external_id, project_external_id, title, parent_external_id, created_at)
                VALUES($source, $id, $project, $title, $parent, $created)
                ON CONFLICT(source_id, external_id) DO UPDATE SET
                    project_external_id = CASE WHEN excluded.project_external_id = $unknownProject
                        THEN sessions.project_external_id ELSE excluded.project_external_id END,
                    title = CASE WHEN excluded.title = '' THEN sessions.title ELSE excluded.title END,
                    parent_external_id = COALESCE(excluded.parent_external_id, sessions.parent_external_id),
                    created_at = CASE WHEN excluded.created_at = 0 THEN sessions.created_at ELSE excluded.created_at END
                """,
                ("$source", sourceId), ("$id", session.SessionId), ("$project", ProjectId(session.Project)),
                ("$title", session.Title), ("$parent", DbValue(session.ParentId)), ("$created", session.Date),
                ("$unknownProject", UnknownProjectId));
        }

        foreach (var message in snapshot.Messages)
        {
            Execute(connection, transaction,
                "INSERT INTO providers(provider_id, display_name) VALUES($id, $name) ON CONFLICT(provider_id) DO UPDATE SET display_name = excluded.display_name",
                ("$id", message.Provider), ("$name", message.Provider));
            Execute(connection, transaction,
                "INSERT INTO models(provider_id, model_id, display_name) VALUES($provider, $id, $name) ON CONFLICT(provider_id, model_id) DO UPDATE SET display_name = excluded.display_name",
                ("$provider", message.Provider), ("$id", message.Model), ("$name", message.Model));
            Execute(connection, transaction, """
                INSERT INTO messages(
                    source_id, external_id, session_external_id, role, message_at,
                    provider_id, model_id, stored_cost, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, reasoning_tokens)
                VALUES(
                    $source, $id, $session, $role, $date,
                    $provider, $model, $cost, $input, $output,
                    $cacheRead, $cacheWrite, $reasoning)
                ON CONFLICT(source_id, external_id) DO UPDATE SET
                    session_external_id = excluded.session_external_id,
                    role = excluded.role,
                    message_at = COALESCE(excluded.message_at, messages.message_at),
                    provider_id = CASE WHEN excluded.provider_id = '' THEN messages.provider_id ELSE excluded.provider_id END,
                    model_id = CASE WHEN excluded.model_id = '' THEN messages.model_id ELSE excluded.model_id END,
                    stored_cost = CASE WHEN excluded.stored_cost = 0 AND messages.stored_cost > 0
                        THEN messages.stored_cost ELSE excluded.stored_cost END,
                    input_tokens = COALESCE(excluded.input_tokens, messages.input_tokens),
                    output_tokens = COALESCE(excluded.output_tokens, messages.output_tokens),
                    cache_read_tokens = COALESCE(excluded.cache_read_tokens, messages.cache_read_tokens),
                    cache_write_tokens = COALESCE(excluded.cache_write_tokens, messages.cache_write_tokens),
                    reasoning_tokens = COALESCE(excluded.reasoning_tokens, messages.reasoning_tokens)
                """,
                ("$source", sourceId), ("$id", message.MessageId), ("$session", message.SessionId),
                ("$role", message.Role), ("$date", DbValue(message.MessageDate)),
                ("$provider", message.Provider), ("$model", message.Model), ("$cost", message.StoredCost),
                ("$input", DbValue(message.Tokens?.Input)), ("$output", DbValue(message.Tokens?.Output)),
                ("$cacheRead", DbValue(message.Tokens?.CacheRead)), ("$cacheWrite", DbValue(message.Tokens?.CacheWrite)),
                ("$reasoning", DbValue(message.Tokens?.Reasoning)));
        }

        transaction.Commit();
    }

    public static List<UsageRow> LoadUsageRows()
    {
        using var connection = Open(DatabasePath);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT m.source_id, m.external_id, p.display_name, s.external_id, s.title,
                   s.parent_external_id, s.created_at, m.message_at, m.provider_id,
                   m.model_id, m.stored_cost, m.input_tokens, m.output_tokens,
                   m.cache_read_tokens, m.cache_write_tokens, m.reasoning_tokens
            FROM messages m
            JOIN sessions s ON s.source_id = m.source_id AND s.external_id = m.session_external_id
            JOIN projects p ON p.source_id = s.source_id AND p.external_id = s.project_external_id
            WHERE m.role = 'assistant'
            ORDER BY m.source_id, m.external_id
            """;
        using var reader = command.ExecuteReader();
        var rows = new List<UsageRow>();
        while (reader.Read())
        {
            var sourceId = reader.GetString(0);
            var sessionId = reader.GetString(3);
            rows.Add(new UsageRow(
                MessageId: ExternalKey(sourceId, reader.GetString(1)),
                Project: reader.GetString(2),
                SessionId: ExternalKey(sourceId, sessionId),
                Title: reader.GetString(4),
                ParentId: reader.IsDBNull(5) ? null : ExternalKey(sourceId, reader.GetString(5)),
                Date: reader.GetInt64(6),
                MessageDate: reader.IsDBNull(7) ? null : reader.GetInt64(7),
                Provider: reader.GetString(8),
                Model: reader.GetString(9),
                StoredCost: reader.GetDouble(10),
                Tokens: ReadTokens(reader, 11)));
        }
        return rows;
    }

    public static DatabaseAuditSnapshot LoadAuditSnapshot()
    {
        using var connection = Open(DatabasePath);
        using var transaction = connection.BeginTransaction(deferred: true);
        var usageRows = ReadUsageRows(connection, transaction);
        var ignoredRows = new List<IgnoredRow>();
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT source_id, external_id, session_external_id, role FROM messages WHERE role <> 'assistant' ORDER BY source_id, external_id";
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var sourceId = reader.GetString(0);
                ignoredRows.Add(new IgnoredRow(
                    ExternalKey(sourceId, reader.GetString(1)),
                    ExternalKey(sourceId, reader.GetString(2)),
                    reader.GetString(3)));
            }
        }

        var sessionRows = new List<DatabaseSessionRow>();
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                SELECT s.source_id, s.external_id, p.display_name, s.title,
                       s.parent_external_id, s.created_at
                FROM sessions s
                JOIN projects p ON p.source_id = s.source_id AND p.external_id = s.project_external_id
                ORDER BY s.source_id, s.external_id
                """;
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var sourceId = reader.GetString(0);
                sessionRows.Add(new DatabaseSessionRow(
                    ExternalKey(sourceId, reader.GetString(1)),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.IsDBNull(4) ? null : ExternalKey(sourceId, reader.GetString(4)),
                    reader.GetInt64(5)));
            }
        }

        var totalSessions = CountRows(connection, transaction, "sessions");
        var totalMessages = CountRows(connection, transaction, "messages");
        transaction.Commit();
        return new DatabaseAuditSnapshot(usageRows, ignoredRows, sessionRows, totalSessions, totalMessages);
    }

    public static InternalStoreStatus GetStatus()
    {
        using var connection = Open(DatabasePath);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                (SELECT COUNT(*) FROM projects),
                (SELECT COUNT(*) FROM sessions),
                (SELECT COUNT(*) FROM messages),
                (SELECT COUNT(*) FROM data_sources),
                (SELECT MAX(last_imported_at) FROM data_sources),
                (SELECT last_sync_error FROM data_sources ORDER BY last_sync_attempt_at DESC LIMIT 1)
            """;
        using var reader = command.ExecuteReader();
        reader.Read();
        return new InternalStoreStatus(
            Path.GetFullPath(DatabasePath),
            reader.GetInt64(0),
            reader.GetInt64(1),
            reader.GetInt64(2),
            reader.GetInt64(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5));
    }

    public static IReadOnlyList<InternalStoreSource> GetSources()
    {
        using var connection = Open(DatabasePath);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.source_id, a.display_name, c.channel_path, c.last_imported_at,
                   c.last_sync_attempt_at, c.last_sync_error, c.channel_key
            FROM source_channels c
            JOIN data_sources d ON d.source_id = c.source_id
            JOIN agents a ON a.agent_id = d.agent_id
            ORDER BY a.display_name, c.channel_key
            """;
        using var reader = command.ExecuteReader();
        var sources = new List<InternalStoreSource>();
        while (reader.Read())
        {
            sources.Add(new InternalStoreSource(
                reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5))
            {
                ChannelKey = reader.GetString(6),
            });
        }
        return sources;
    }

    public static string SourceIdFor(string agentId, string sourceKey) => CreateSourceId(agentId, sourceKey);

    public static void RecordSyncFailure(string agentId, string agentName, string sourceKey, string sourcePath, string error)
    {
        var fullSourcePath = Path.GetFullPath(sourcePath);
        var sourceId = CreateSourceId(agentId, sourceKey);
        var attemptedAt = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
        using var connection = Open(DatabasePath);
        using var transaction = connection.BeginTransaction(deferred: false);
        Execute(connection, transaction,
            "INSERT INTO agents(agent_id, display_name) VALUES($id, $name) ON CONFLICT(agent_id) DO NOTHING",
            ("$id", agentId), ("$name", agentName));
        Execute(connection, transaction, """
            INSERT INTO data_sources(
                source_id, agent_id, source_key, source_path, created_at,
                last_imported_at, last_sync_attempt_at, last_sync_error)
            VALUES($id, $agent, $key, $path, $attempted, NULL, $attempted, $error)
            ON CONFLICT(source_id) DO UPDATE SET
                source_path = excluded.source_path,
                last_sync_attempt_at = excluded.last_sync_attempt_at,
                last_sync_error = excluded.last_sync_error
            """,
            ("$id", sourceId), ("$agent", agentId), ("$key", sourceKey),
            ("$path", fullSourcePath), ("$attempted", attemptedAt), ("$error", error));
        Execute(connection, transaction, """
            INSERT INTO source_channels(source_id, channel_key, channel_path, last_imported_at, last_sync_attempt_at, last_sync_error)
            VALUES($source, 'database', $path, NULL, $attempted, $error)
            ON CONFLICT(source_id, channel_key) DO UPDATE SET
                channel_path = excluded.channel_path,
                last_sync_attempt_at = excluded.last_sync_attempt_at,
                last_sync_error = excluded.last_sync_error
            """,
            ("$source", sourceId), ("$path", fullSourcePath), ("$attempted", attemptedAt), ("$error", error));
        transaction.Commit();
    }

    public static void RecordChannelSyncFailure(
        string agentId, string agentName, string sourceKey, string channelKey, string channelPath, string error)
    {
        var fullPath = Path.GetFullPath(channelPath);
        var sourceId = CreateSourceId(agentId, sourceKey);
        var attemptedAt = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
        using var connection = Open(DatabasePath);
        using var transaction = connection.BeginTransaction(deferred: false);
        Execute(connection, transaction,
            "INSERT INTO agents(agent_id, display_name) VALUES($id, $name) ON CONFLICT(agent_id) DO NOTHING",
            ("$id", agentId), ("$name", agentName));
        Execute(connection, transaction, """
            INSERT INTO data_sources(source_id, agent_id, source_key, source_path, created_at, last_imported_at, last_sync_attempt_at, last_sync_error)
            VALUES($id, $agent, $key, $path, $attempted, NULL, $attempted, $error)
            ON CONFLICT(source_id) DO UPDATE SET last_sync_attempt_at = excluded.last_sync_attempt_at
            """,
            ("$id", sourceId), ("$agent", agentId), ("$key", sourceKey), ("$path", fullPath),
            ("$attempted", attemptedAt), ("$error", error));
        Execute(connection, transaction, """
            INSERT INTO source_channels(source_id, channel_key, channel_path, last_imported_at, last_sync_attempt_at, last_sync_error)
            VALUES($source, $channel, $path, NULL, $attempted, $error)
            ON CONFLICT(source_id, channel_key) DO UPDATE SET
                channel_path = excluded.channel_path,
                last_sync_attempt_at = excluded.last_sync_attempt_at,
                last_sync_error = excluded.last_sync_error
            """,
            ("$source", sourceId), ("$channel", channelKey), ("$path", fullPath),
            ("$attempted", attemptedAt), ("$error", error));
        transaction.Commit();
    }

    public static bool HasImportedData()
    {
        using var connection = Open(DatabasePath);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM sessions) OR EXISTS(SELECT 1 FROM messages)";
        return Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture) != 0;
    }

    public static long GetDatabaseSize()
    {
        Open(DatabasePath).Dispose();
        return File.Exists(DatabasePath) ? new FileInfo(DatabasePath).Length : 0;
    }

    public static void ExportBackup(string targetPath)
    {
        var target = Path.GetFullPath(targetPath);
        if (PathsEqual(target, DatabasePath))
        {
            throw new InvalidDataException("La sauvegarde ne peut pas écraser la base interne.");
        }

        var directory = Path.GetDirectoryName(target)
            ?? throw new InvalidDataException("Le chemin de sauvegarde est invalide.");
        Directory.CreateDirectory(directory);
        var temporaryPath = $"{target}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var source = Open(DatabasePath))
            using (var destination = Open(temporaryPath))
            {
                source.BackupDatabase(destination);
            }
            File.Move(temporaryPath, target, overwrite: true);
        }
        finally
        {
            TryDelete(temporaryPath);
            TryDelete(temporaryPath + "-wal");
            TryDelete(temporaryPath + "-shm");
        }
    }

    public static InternalStoreMergeResult MergeBackup(string backupPath)
    {
        var backup = Path.GetFullPath(backupPath);
        if (!File.Exists(backup)) throw new FileNotFoundException("Le fichier de sauvegarde est introuvable.", backup);
        if (PathsEqual(backup, DatabasePath)) throw new InvalidDataException("La base interne ne peut pas être fusionnée avec elle-même.");

        using var connection = Open(DatabasePath);
        using (var attach = connection.CreateCommand())
        {
            attach.CommandText = "ATTACH DATABASE $path AS restore_source";
            attach.Parameters.AddWithValue("$path", backup);
            attach.ExecuteNonQuery();
        }

        try
        {
            ValidateAttachedBackup(connection);
            var previousProjects = CountRows(connection, null, "projects");
            var previousSessions = CountRows(connection, null, "sessions");
            var previousMessages = CountRows(connection, null, "messages");

            using (var transaction = connection.BeginTransaction(deferred: false))
            {
                Execute(connection, transaction, "INSERT OR IGNORE INTO agents SELECT * FROM restore_source.agents");
                Execute(connection, transaction, "INSERT OR IGNORE INTO data_sources SELECT * FROM restore_source.data_sources");
                var backupHasChannels = Convert.ToInt32(Scalar(connection, transaction,
                    "SELECT COUNT(*) FROM restore_source.sqlite_master WHERE type='table' AND name='source_channels'"),
                    System.Globalization.CultureInfo.InvariantCulture) > 0;
                if (backupHasChannels)
                    Execute(connection, transaction, "INSERT OR IGNORE INTO source_channels SELECT * FROM restore_source.source_channels");
                else
                    Execute(connection, transaction, """
                        INSERT OR IGNORE INTO source_channels(source_id, channel_key, channel_path, last_imported_at, last_sync_attempt_at, last_sync_error)
                        SELECT source_id, 'database', source_path, last_imported_at, last_sync_attempt_at, last_sync_error
                        FROM restore_source.data_sources
                        """);
                Execute(connection, transaction, "INSERT OR IGNORE INTO providers SELECT * FROM restore_source.providers");
                Execute(connection, transaction, "INSERT OR IGNORE INTO models SELECT * FROM restore_source.models");
                Execute(connection, transaction, "INSERT OR IGNORE INTO projects SELECT * FROM restore_source.projects");
                Execute(connection, transaction, "INSERT OR IGNORE INTO sessions SELECT * FROM restore_source.sessions");
                Execute(connection, transaction, "INSERT OR IGNORE INTO messages SELECT * FROM restore_source.messages");
                transaction.Commit();
            }

            return new InternalStoreMergeResult(
                CountRows(connection, null, "projects") - previousProjects,
                CountRows(connection, null, "sessions") - previousSessions,
                CountRows(connection, null, "messages") - previousMessages);
        }
        finally
        {
            using var detach = connection.CreateCommand();
            detach.CommandText = "DETACH DATABASE restore_source";
            detach.ExecuteNonQuery();
        }
    }

    private static List<UsageRow> ReadUsageRows(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT m.source_id, m.external_id, p.display_name, s.external_id, s.title,
                   s.parent_external_id, s.created_at, m.message_at, m.provider_id,
                   m.model_id, m.stored_cost, m.input_tokens, m.output_tokens,
                   m.cache_read_tokens, m.cache_write_tokens, m.reasoning_tokens
            FROM messages m
            JOIN sessions s ON s.source_id = m.source_id AND s.external_id = m.session_external_id
            JOIN projects p ON p.source_id = s.source_id AND p.external_id = s.project_external_id
            WHERE m.role = 'assistant'
            ORDER BY m.source_id, m.external_id
            """;
        using var reader = command.ExecuteReader();
        var rows = new List<UsageRow>();
        while (reader.Read())
        {
            var sourceId = reader.GetString(0);
            var sessionId = reader.GetString(3);
            rows.Add(new UsageRow(
                ExternalKey(sourceId, reader.GetString(1)),
                reader.GetString(2),
                ExternalKey(sourceId, sessionId),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : ExternalKey(sourceId, reader.GetString(5)),
                reader.GetInt64(6),
                reader.IsDBNull(7) ? null : reader.GetInt64(7),
                reader.GetString(8),
                reader.GetString(9),
                reader.GetDouble(10),
                ReadTokens(reader, 11)));
        }
        return rows;
    }

    private static void ValidateAttachedBackup(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA restore_source.application_id";
        var applicationId = Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        command.CommandText = "PRAGMA restore_source.user_version";
        var schemaVersion = Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        if (applicationId != ApplicationId || schemaVersion is not (1 or SchemaVersion))
        {
            throw new InvalidDataException("Cette sauvegarde n'est pas compatible avec la version actuelle de la base interne.");
        }

        command.CommandText = "SELECT COUNT(*) FROM restore_source.sqlite_master WHERE type = 'table' AND name IN ('agents', 'data_sources', 'providers', 'models', 'projects', 'sessions', 'messages')";
        if (Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture) != 7)
        {
            throw new InvalidDataException("La sauvegarde ne contient pas le schéma interne attendu.");
        }
    }

    private static SqliteConnection Open(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath)
            ?? throw new InvalidOperationException("Could not resolve the internal database directory.");
        Directory.CreateDirectory(directory);
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = fullPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
        }.ToString())
        {
            DefaultTimeout = 5,
        };

        try
        {
            connection.Open();
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;";
                command.ExecuteNonQuery();
            }
            EnsureSchema(connection);
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private static void EnsureSchema(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA application_id";
        var applicationId = Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        command.CommandText = "PRAGMA user_version";
        var version = Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);

        if (version == 0 && applicationId == 0)
        {
            using var transaction = connection.BeginTransaction(deferred: false);
            command.Transaction = transaction;
            command.CommandText = Schema;
            command.ExecuteNonQuery();
            command.CommandText = $"PRAGMA application_id = {ApplicationId}; PRAGMA user_version = {SchemaVersion};";
            command.ExecuteNonQuery();
            transaction.Commit();
            return;
        }

        if (applicationId == ApplicationId && version == 1)
        {
            using var transaction = connection.BeginTransaction(deferred: false);
            command.Transaction = transaction;
            command.CommandText = """
                CREATE TABLE source_channels (
                    source_id TEXT NOT NULL REFERENCES data_sources(source_id),
                    channel_key TEXT NOT NULL,
                    channel_path TEXT NOT NULL,
                    last_imported_at TEXT,
                    last_sync_attempt_at TEXT NOT NULL,
                    last_sync_error TEXT,
                    PRIMARY KEY(source_id, channel_key)
                );
                INSERT INTO source_channels(source_id, channel_key, channel_path, last_imported_at, last_sync_attempt_at, last_sync_error)
                SELECT source_id, 'database', source_path, last_imported_at, last_sync_attempt_at, last_sync_error FROM data_sources;
                PRAGMA user_version = 2;
                """;
            command.ExecuteNonQuery();
            transaction.Commit();
            return;
        }

        if (applicationId != ApplicationId || version != SchemaVersion)
        {
            throw new InvalidDataException("La base interne est invalide ou sa version de schéma n'est pas prise en charge.");
        }
    }

    private static Tokens? ReadTokens(SqliteDataReader reader, int start)
    {
        if (Enumerable.Range(start, 5).Any(index => reader.IsDBNull(index))) return null;
        var values = Enumerable.Range(start, 5).Select(reader.GetDouble).ToArray();
        if (values.Any(value => !double.IsFinite(value) || value < 0)) return null;
        return new Tokens(values[0], values[1], values[2], values[3], values[4]);
    }

    private static long CountRows(SqliteConnection connection, SqliteTransaction? transaction, string table)
    {
        var query = table switch
        {
            "projects" => "SELECT COUNT(*) FROM projects",
            "sessions" => "SELECT COUNT(*) FROM sessions",
            "messages" => "SELECT COUNT(*) FROM messages",
            _ => throw new ArgumentOutOfRangeException(nameof(table)),
        };
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = query;
        return Convert.ToInt64(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static void Execute(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }
        command.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        return command.ExecuteScalar();
    }

    private static object DbValue(object? value) => value ?? DBNull.Value;

    private static string CreateSourceId(string agentId, string sourceKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sourceKey));
        return $"{agentId}-{Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    private static string ExternalKey(string sourceId, string externalId) => $"{sourceId}/{externalId}";

    private static string ProjectId(string value) => string.IsNullOrWhiteSpace(value) ? UnknownProjectId : value;

    private static string ProjectName(string value) => string.IsNullOrWhiteSpace(value) ? UnknownProjectName : value;

    private static bool PathsEqual(string left, string right) =>
        string.Equals(Path.GetFullPath(left), Path.GetFullPath(right),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
