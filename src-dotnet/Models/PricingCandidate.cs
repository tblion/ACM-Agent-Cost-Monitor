// Defines normalized public pricing candidates and independent source outcomes.
namespace OpencodeCostsViewer.Backend.Models;

public sealed record PricingLookupKey(string Kind, string Provider, string Model);

public sealed record PricingCandidate(
    string SourceId,
    string SourceType,
    string SourceName,
    string SourceUrl,
    DateTimeOffset RetrievedAt,
    string? EffectiveFrom,
    string Provider,
    string Model,
    string? Region,
    string Currency,
    string Unit,
    double? Input,
    double? Output,
    double? CacheRead,
    double? CacheWrite,
    string MatchStatus,
    IReadOnlyList<string> ConfidenceReasons);

public sealed record PricingSourceResult(
    string SourceId,
    string SourceType,
    string SourceName,
    string SourceUrl,
    string Status,
    string? Error,
    IReadOnlyList<PricingCandidate> Candidates);

public sealed record PricingComparisonResult(
    DateTimeOffset RetrievedAt,
    IReadOnlyList<PricingSourceResult> Sources);
