using System.Text.Json;
using OpencodeCostsViewer.Backend.Application;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed class OperationDispatcher : IDisposable
{
    private readonly BackendRuntime _runtime;

    public OperationDispatcher(ProtocolWriter writer)
    {
        _runtime = new BackendRuntime(writer);
    }

    public ValueTask<object?> DispatchAsync(
        string operation,
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
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
                "get_rates" => GetRates(),
                "get_catalog_status" => GetCatalogStatus(),
                "recalculate_data" => RecalculateData(),
                "get_audit_report" => GetAuditReport(),
                _ => throw new ProtocolException("invalid_input", $"Unknown operation: {operation}"),
            };
            return ValueTask.FromResult(result);
        }
        catch (BackendException exception)
        {
            throw new ProtocolException(exception.Code, exception.Message);
        }
    }

    public void Dispose() => _runtime.Dispose();

    private IReadOnlyList<SessionRecord> GetData()
    {
        var paths = SettingsService.ResolvePaths(SettingsService.LoadForCommands());
        return DataService.Compute(paths.Db, paths.Config);
    }

    private IReadOnlyList<CostSummary> GetCostSummary()
    {
        var paths = SettingsService.ResolvePaths(SettingsService.LoadForCommands());
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

        var settings = SettingsService.LoadForCommands();
        var databasePath = includeSize.GetBoolean()
            ? SettingsService.ResolvePaths(settings).Db
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

    private IReadOnlyList<RateEntry> GetRates()
    {
        var paths = SettingsService.ResolvePaths(SettingsService.LoadForCommands());
        return DataService.GetRates(paths.Db, paths.Config);
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

    private RecalculationResult RecalculateData()
    {
        var paths = SettingsService.ResolvePaths(SettingsService.LoadForCommands());
        return DataService.Recalculate(paths.Db, paths.Config);
    }

    private AuditReport GetAuditReport()
    {
        var paths = SettingsService.ResolvePaths(SettingsService.LoadForCommands());
        return AuditService.Build(paths.Db, paths.Config);
    }
}
