// Coordinates database reads and report generation for audit requests.
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class AuditService
{
    public static AuditReport Build(string databasePath, string configPath)
    {
        DatabaseAuditSnapshot snapshot;
        try
        {
            snapshot = OpencodeDatabase.LoadAuditSnapshot(databasePath);
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible de lire la base: {exception.Message}", exception);
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("database", exception.Message, exception);
        }

        Dictionary<(string Provider, string Model), Rate> overrides;
        try
        {
            overrides = ConfigReader.LoadRatesStrict(configPath);
        }
        catch (IOException exception)
        {
            throw new BackendException("configuration", exception.Message, exception);
        }
        catch (Exception exception) when (exception is System.Text.Json.JsonException or InvalidDataException)
        {
            throw new BackendException("configuration", exception.Message, exception);
        }

        PricingCatalog catalog;
        try
        {
            catalog = PricingCatalogLoader.LoadEmbedded();
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("pricing", exception.Message, exception);
        }

        try
        {
            return AuditReportBuilder.Build(
                snapshot.Rows,
                snapshot.IgnoredRows,
                snapshot.SessionRows,
                snapshot.TotalSessions,
                snapshot.TotalMessages,
                catalog,
                overrides,
                new AuditPaths(databasePath, configPath, "embedded://pricing.json"));
        }
        catch (Exception exception) when (exception is InvalidDataException or OverflowException)
        {
            throw new BackendException("pricing", exception.Message, exception);
        }
    }
}
