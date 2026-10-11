// Routes protocol operations to backend application services.
using System.Text.Json;
using OpencodeCostsViewer.Backend.Application;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;
using Serilog;

namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed class OperationDispatcher : IDisposable
{
    private readonly BackendRuntime _runtime;

    public OperationDispatcher(ProtocolWriter writer)
    {
        _runtime = new BackendRuntime(writer);
    }

    public async ValueTask<object?> DispatchAsync(
        string operation,
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Log.Information("Processing backend operation {Operation}", operation);
        try
        {
            object? result = operation switch
            {
                "get_data" => GetData(),
                "get_cost_summary" => GetCostSummary(),
                "get_settings" => GetSettings(),
                "get_settings_status" => GetSettingsStatus(),
                "get_runtime_metrics" => GetRuntimeMetrics(arguments),
                "save_settings" => SaveSettings(arguments),
                "get_resolved_paths" => GetResolvedPaths(),
                "get_internal_store_status" => InternalStoreService.GetStatus(),
                "get_internal_store_sources" => InternalStoreService.GetSources(),
                "refresh_internal_store_source" => RefreshInternalStoreSource(arguments),
                "refresh_opencode_api" => await RefreshOpenCodeApi(cancellationToken),
                "reimport_all_sources" => await ReimportAllSources(cancellationToken),
                "export_internal_store" => ExportInternalStore(arguments),
                "merge_internal_store" => MergeInternalStore(arguments),
                "get_rates" => GetRates(),
                "get_catalog_rates" => GetCatalogRates(),
                "get_catalog_status" => GetCatalogStatus(),
                "get_pricing_candidates" => await GetPricingCandidates(arguments, cancellationToken),
                "recalculate_data" => RecalculateData(),
                "preview_recalculation" => PreviewRecalculation(),
                "get_audit_report" => GetAuditReport(),
                _ => throw new ProtocolException("invalid_input", $"Unknown operation: {operation}"),
            };
            return result;
        }
        catch (BackendException exception)
        {
            throw new ProtocolException(exception.Code, exception.Message);
        }
    }

    public void Dispose() => _runtime.Dispose();

    private IReadOnlyList<SessionRecord> GetData()
    {
        var settings = SettingsService.LoadForCommands();
        var paths = SettingsService.ResolvePaths(settings);
        return DataService.Compute(paths.Db, paths.Config, settings.FixedSubscriptions, settings.CustomRates);
    }

    private IReadOnlyList<CostSummary> GetCostSummary()
    {
        var settings = SettingsService.LoadForCommands();
        var paths = SettingsService.ResolvePaths(settings);
        return DataService.ComputeCostSummary(paths.Db, paths.Config);
    }

    private Settings GetSettings()
    {
        var status = SettingsService.LoadForStatus();
        _runtime.SettingsError = status.Diagnostic;
        return status.Settings;
    }

    private SettingsResponse GetSettingsStatus()
    {
        var status = SettingsService.LoadForStatus();
        _runtime.SettingsError = status.Diagnostic;
        return new SettingsResponse(
            status.Settings,
            _runtime.SettingsError ?? _runtime.WatcherError,
            _runtime.LiveActive);
    }

    private RuntimeMetrics GetRuntimeMetrics(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("includeDatabaseSize", out var includeSize)
            || includeSize.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new ProtocolException("invalid_input", "includeDatabaseSize must be a boolean.");
        }

        var databasePath = includeSize.GetBoolean()
            ? InternalDatabase.DatabasePath
            : null;
        return RuntimeMetricsService.Collect(databasePath);
    }

    private object? SaveSettings(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("s", out var settingsValue)
            || settingsValue.ValueKind != JsonValueKind.Object)
        {
            throw new ProtocolException("invalid_input", "Settings argument 's' must be an object.");
        }

        Settings settings;
        try
        {
            settings = JsonSerializer.Deserialize<Settings>(settingsValue.GetRawText(), ProtocolJson.Options)
                ?? throw new JsonException("Settings must not be null.");
        }
        catch (JsonException exception)
        {
            throw new ProtocolException("invalid_input", $"Invalid settings payload: {exception.Message}");
        }

        SettingsService.SaveTransactional(settings, _runtime);
        return null;
    }

    private ResolvedPaths GetResolvedPaths()
    {
        var status = SettingsService.LoadForStatus();
        _runtime.SettingsError = status.Diagnostic;
        return SettingsService.ResolvePaths(status.Settings);
    }

    private object? ExportInternalStore(JsonElement arguments)
    {
        var paths = SettingsService.ResolvePaths(SettingsService.LoadForCommands());
        InternalStoreService.Export(paths.Db, ReadPathArgument(arguments));
        return null;
    }

    private InternalStoreMergeResult MergeInternalStore(JsonElement arguments) =>
        InternalStoreService.Merge(ReadPathArgument(arguments));

    private object? RefreshInternalStoreSource(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("sourceId", out var sourceId)
            || sourceId.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(sourceId.GetString()))
        {
            throw new ProtocolException("invalid_input", "A source id is required.");
        }
        var sourcePath = SettingsService.ResolvePaths(SettingsService.LoadForCommands()).Db;
        UsageImportService.RefreshSource(sourceId.GetString()!, sourcePath);
        return null;
    }

    private static async Task<object?> RefreshOpenCodeApi(CancellationToken cancellationToken)
    {
        await UsageImportService.SyncOpenCodeApiAsync(cancellationToken);
        return null;
    }

    private static async Task<object?> ReimportAllSources(CancellationToken cancellationToken)
    {
        await UsageImportService.ReimportAllAsync(cancellationToken);
        return null;
    }

    private static string ReadPathArgument(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("path", out var path)
            || path.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(path.GetString()))
        {
            throw new ProtocolException("invalid_input", "A non-empty database path is required.");
        }
        return path.GetString()!;
    }

    private IReadOnlyList<RateEntry> GetRates()
    {
        var settings = SettingsService.LoadForCommands();
        var paths = SettingsService.ResolvePaths(settings);
        return DataService.GetRates(paths.Db, paths.Config, settings.FixedSubscriptions, settings.CustomRates);
    }

    private static IReadOnlyList<RateEntry> GetCatalogRates()
    {
        var catalog = PricingCatalogLoader.LoadEmbedded();
        return catalog.Rates.Select(rate => new RateEntry(
                rate.Provider,
                rate.Model,
                rate.Input,
                rate.Output,
                rate.CacheRead,
                rate.CacheWrite,
                "catalog",
                rate.EffectiveFrom))
            .OrderBy(rate => rate.Provider, StringComparer.Ordinal)
            .ThenBy(rate => rate.Model, StringComparer.Ordinal)
            .ThenBy(rate => rate.EffectiveFrom, StringComparer.Ordinal)
            .ToArray();
    }

    private CatalogStatus GetCatalogStatus()
    {
        try
        {
            return PricingService.GetCatalogStatus(PricingCatalogLoader.LoadEmbedded());
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("pricing", exception.Message, exception);
        }
    }

    private static async Task<PricingComparisonResult> GetPricingCandidates(
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        if (!arguments.TryGetProperty("keys", out var keysValue) || keysValue.ValueKind != JsonValueKind.Array)
            throw new ProtocolException("invalid_input", "Pricing lookup keys must be an array.");
        PricingLookupKey[] keys;
        try
        {
            keys = JsonSerializer.Deserialize<PricingLookupKey[]>(keysValue.GetRawText(), ProtocolJson.Options)
                ?? throw new JsonException("Pricing lookup keys must not be null.");
        }
        catch (JsonException exception)
        {
            throw new ProtocolException("invalid_input", $"Invalid pricing lookup keys: {exception.Message}");
        }
        try
        {
            using var comparisonService = new PricingComparisonService();
            return await comparisonService.GetCandidatesAsync(keys, cancellationToken);
        }
        catch (ArgumentException exception)
        {
            throw new ProtocolException("invalid_input", exception.Message);
        }
    }

    private RecalculationResult RecalculateData()
    {
        var settings = SettingsService.LoadForCommands();
        var paths = SettingsService.ResolvePaths(settings);
        return DataService.Recalculate(paths.Db, paths.Config, settings.FixedSubscriptions, settings.CustomRates);
    }

    private RecalculationResult PreviewRecalculation()
    {
        var settings = SettingsService.LoadForCommands();
        var paths = SettingsService.ResolvePaths(settings);
        return DataService.Preview(paths.Db, paths.Config, settings.FixedSubscriptions, settings.CustomRates);
    }

    private AuditReport GetAuditReport()
    {
        var settings = SettingsService.LoadForCommands();
        var paths = SettingsService.ResolvePaths(settings);
        return AuditService.Build(paths.Db, paths.Config, settings.FixedSubscriptions, settings.CustomRates);
    }
}
