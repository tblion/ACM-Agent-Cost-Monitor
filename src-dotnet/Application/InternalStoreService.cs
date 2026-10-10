// Exposes safe status, export, and merge operations for the internal store.
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class InternalStoreService
{
    public static InternalStoreStatus GetStatus()
    {
        try
        {
            return InternalDatabase.GetStatus();
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible de lire la base interne: {exception.Message}", exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            throw new BackendException("database", exception.Message, exception);
        }
    }

    public static IReadOnlyList<InternalStoreSource> GetSources()
    {
        try
        {
            return InternalDatabase.GetSources();
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible de lire les sources: {exception.Message}", exception);
        }
    }

    public static void Export(string sourcePath, string targetPath)
    {
        try
        {
            UsageImportService.SyncOpenCode(sourcePath);
            InternalDatabase.ExportBackup(targetPath);
        }
        catch (BackendException)
        {
            throw;
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible d'exporter la base interne: {exception.Message}", exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            throw new BackendException("database", $"Impossible d'exporter la base interne: {exception.Message}", exception);
        }
    }

    public static InternalStoreMergeResult Merge(string backupPath)
    {
        try
        {
            return InternalDatabase.MergeBackup(backupPath);
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible de fusionner la sauvegarde: {exception.Message}", exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            throw new BackendException("database", $"Impossible de fusionner la sauvegarde: {exception.Message}", exception);
        }
    }
}
