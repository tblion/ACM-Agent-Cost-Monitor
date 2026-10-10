// Coordinates source-specific import adapters and normalized persistence.
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;
using Serilog;

namespace OpencodeCostsViewer.Backend.Application;

internal interface IUsageSourceAdapter
{
    string AgentId { get; }
    string AgentName { get; }
    string SourceKey { get; }
    SourceImportSnapshot ReadSnapshot(string sourcePath);
}

internal sealed class OpenCodeSourceAdapter : IUsageSourceAdapter
{
    public string AgentId => "opencode";
    public string AgentName => "OpenCode";
    public string SourceKey => "default";
    public SourceImportSnapshot ReadSnapshot(string sourcePath) => OpencodeDatabase.LoadImportSnapshot(sourcePath);
}

internal static class UsageImportService
{
    private static readonly SemaphoreSlim ApiSyncGate = new(1, 1);
    public static void RefreshSource(string sourceId, string sourcePath)
    {
        var adapter = new OpenCodeSourceAdapter();
        if (!string.Equals(sourceId, InternalDatabase.SourceIdFor(adapter.AgentId, adapter.SourceKey), StringComparison.Ordinal))
        {
            throw new BackendException("invalid_input", "Cette source ne peut pas être actualisée par l’adaptateur OpenCode.");
        }
        SyncOpenCode(sourcePath);
    }

    public static void SyncOpenCode(string sourcePath)
    {
        var adapter = new OpenCodeSourceAdapter();
        SourceImportSnapshot snapshot;
        try
        {
            snapshot = adapter.ReadSnapshot(sourcePath);
            Log.Information("Read {SessionCount} sessions and {MessageCount} messages from {Agent}",
                snapshot.Sessions.Count, snapshot.Messages.Count, adapter.AgentName);
        }
        catch (SqliteException exception)
        {
            if (CanUseImportedData(adapter, sourcePath, exception)) return;
            throw SourceReadError(exception);
        }
        catch (InvalidDataException exception)
        {
            if (CanUseImportedData(adapter, sourcePath, exception)) return;
            throw SourceReadError(exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            if (CanUseImportedData(adapter, sourcePath, exception)) return;
            throw SourceReadError(exception);
        }

        try
        {
            InternalDatabase.ImportSource(adapter.AgentId, adapter.AgentName, adapter.SourceKey, sourcePath, snapshot);
            Log.Information("Imported {Agent} source into the internal usage database", adapter.AgentName);
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible d'enregistrer les données importées: {exception.Message}", exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            throw new BackendException("database", $"Impossible d'enregistrer les données importées: {exception.Message}", exception);
        }
    }

    public static async Task SyncOpenCodeApiAsync(CancellationToken cancellationToken)
    {
        await ApiSyncGate.WaitAsync(cancellationToken);
        try
        {
        var channelPath = PathResolver.OpenCodeServiceStatePath();
        var sourcePath = SettingsService.ResolvePaths(SettingsService.LoadForCommands()).Db;
        try
        {
            var snapshot = await OpencodeApi.LoadImportSnapshotAsync(cancellationToken);
            InternalDatabase.ImportSource("opencode", "OpenCode", "default", sourcePath, snapshot, "api", channelPath);
            Log.Information("Imported OpenCode API snapshot: {SessionCount} sessions and {MessageCount} messages",
                snapshot.Sessions.Count, snapshot.Messages.Count);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or IOException
            or UnauthorizedAccessException or InvalidDataException or JsonException or Microsoft.Data.Sqlite.SqliteException)
        {
            try
            {
                InternalDatabase.RecordChannelSyncFailure("opencode", "OpenCode", "default", "api", channelPath, exception.Message);
            }
            catch (Exception statusException) when (statusException is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
            {
                Log.Error(statusException, "Unable to record the OpenCode API channel failure");
            }
            throw new BackendException("integration", $"Canal API OpenCode : {exception.Message}", exception);
        }
        }
        finally
        {
            ApiSyncGate.Release();
        }
    }

    private static bool CanUseImportedData(IUsageSourceAdapter adapter, string sourcePath, Exception sourceError)
    {
        Log.Warning(sourceError, "Unable to read the {Agent} source; trying the archived data", adapter.AgentName);
        try
        {
            InternalDatabase.RecordSyncFailure(adapter.AgentId, adapter.AgentName, adapter.SourceKey, sourcePath, sourceError.Message);
            return InternalDatabase.HasImportedData();
        }
        catch (Exception exception) when (exception is SqliteException or IOException or UnauthorizedAccessException or InvalidDataException)
        {
            throw new BackendException("database", $"La source est illisible et l'état de la base interne ne peut pas être vérifié: {exception.Message}", exception);
        }
    }

    private static BackendException SourceReadError(Exception exception) =>
        new("database", $"Impossible de lire la source OpenCode: {exception.Message}", exception);
}
