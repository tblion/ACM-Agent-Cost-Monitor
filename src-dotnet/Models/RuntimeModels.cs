namespace OpencodeCostsViewer.Backend.Models;

public sealed record SettingsResponse(Settings Settings, AppError? Diagnostic, bool LiveActive);

public sealed record RuntimeMetrics(ulong? DatabaseSizeBytes, ulong? ProcessMemoryBytes, long MeasuredAt);

public sealed record RateEntry(
    string Provider,
    string Model,
    double Input,
    double Output,
    double CacheRead,
    double CacheWrite,
    string Source,
    string? EffectiveFrom);

public sealed record CatalogStatus(
    bool Valid,
    uint Version,
    string GeneratedAt,
    string SourceVersion,
    int RateCount);

public sealed record RecalculationDiagnostics(
    bool CatalogueValid,
    int RecalculableMessages,
    int MissingDates,
    int MissingTokens,
    int MissingRates);

public sealed record RecalculationResult(
    IReadOnlyList<SessionRecord> Sessions,
    RecalculationDiagnostics Diagnostics);
