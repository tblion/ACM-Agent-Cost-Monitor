// Reads OpenCode sessions and maps them into renderer-facing records.
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class DataService
{
    public static IReadOnlyList<SessionRecord> Compute(string databasePath, string configPath)
    {
        var inputs = LoadInputs(databasePath, configPath);
        return SessionAggregator.Aggregate(inputs.Rows, inputs.Catalog, inputs.Rates);
    }

    public static IReadOnlyList<RateEntry> GetRates(string databasePath, string configPath)
    {
        var inputs = LoadInputs(databasePath, configPath);
        return PricingService.RatesForRows(inputs.Rows, inputs.Catalog, inputs.Rates);
    }

    public static IReadOnlyList<CostSummary> ComputeCostSummary(string databasePath, string configPath)
    {
        var inputs = LoadInputs(databasePath, configPath);
        return inputs.Rows
            .Where(row => row.StoredCost > 0)
            .GroupBy(row => (row.Provider, row.Model))
            .OrderBy(group => group.Key.Provider, StringComparer.Ordinal)
            .ThenBy(group => group.Key.Model, StringComparer.Ordinal)
            .Select(group => new CostSummary(
                group.Key.Provider,
                group.Key.Model,
                checked((ulong)group.LongCount()),
                group.Sum(row => row.StoredCost),
                inputs.Rates.ContainsKey(group.Key)))
            .ToArray();
    }

    public static RecalculationResult Recalculate(string databasePath, string configPath)
    {
        var inputs = LoadInputs(databasePath, configPath);
        return new RecalculationResult(
            SessionAggregator.Aggregate(inputs.Rows, inputs.Catalog, inputs.Rates),
            BuildDiagnostics(inputs.Rows, inputs.Catalog, inputs.Rates));
    }

    public static RecalculationDiagnostics BuildDiagnostics(
        IReadOnlyList<UsageRow> rows,
        PricingCatalog catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> rates)
    {
        var catalogIndex = PricingService.CreateIndex(catalog);
        var recalculableMessages = 0;
        var missingDates = 0;
        var missingTokens = 0;
        var missingRates = 0;
        foreach (var row in rows)
        {
            var validTokens = row.Tokens?.IsValid == true;
            if (row.MessageDate is null) missingDates++;
            if (!validTokens) missingTokens++;
            var hasRate = PricingService.ResolveRateDetail(row, catalogIndex, rates) is not null;
            if (validTokens && hasRate) recalculableMessages++;
            if (!hasRate) missingRates++;
        }

        return new RecalculationDiagnostics(
            CatalogueValid: true,
            RecalculableMessages: recalculableMessages,
            MissingDates: missingDates,
            MissingTokens: missingTokens,
            MissingRates: missingRates);
    }

    private static DataInputs LoadInputs(string databasePath, string configPath)
    {
        var rates = LoadRates(configPath);
        List<UsageRow> rows;
        try
        {
            UsageImportService.SyncOpenCode(databasePath);
            rows = InternalDatabase.LoadUsageRows();
        }
        catch (SqliteException exception)
        {
            throw new BackendException("database", $"Impossible de lire la base: {exception.Message}", exception);
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("database", exception.Message, exception);
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

        return new DataInputs(rows, catalog, rates);
    }

    private static Dictionary<(string Provider, string Model), Rate> LoadRates(string configPath)
    {
        try
        {
            return ConfigReader.LoadRates(configPath);
        }
        catch (BackendException)
        {
            throw;
        }
        catch (IOException exception)
        {
            throw new BackendException("configuration", exception.Message, exception);
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException)
        {
            throw new BackendException("configuration", $"Configuration invalide dans {configPath}: {exception.Message}", exception);
        }
    }

    private sealed record DataInputs(
        List<UsageRow> Rows,
        PricingCatalog Catalog,
        Dictionary<(string Provider, string Model), Rate> Rates);
}
