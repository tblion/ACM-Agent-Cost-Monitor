using System.Text.Json.Serialization;

namespace OpencodeCostsViewer.Backend.Models;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PricingCatalog
{
    public required uint Version { get; init; }
    public required string GeneratedAt { get; init; }
    public required string SourceVersion { get; init; }
    public required List<PricingRate> Rates { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PricingRate
{
    public required string Provider { get; init; }
    public required string Model { get; init; }
    public required string EffectiveFrom { get; init; }
    public required double Input { get; init; }
    public required double Output { get; init; }
    public required double CacheRead { get; init; }
    public required double CacheWrite { get; init; }
    public required string Source { get; init; }
}

public enum RateSource
{
    Configured,
    Catalog,
}

public sealed record Rate(double Input, double Output, double CacheRead, double CacheWrite)
{
    public bool IsValid =>
        IsValidValue(Input)
        && IsValidValue(Output)
        && IsValidValue(CacheRead)
        && IsValidValue(CacheWrite);

    private static bool IsValidValue(double value) => double.IsFinite(value) && value >= 0;
}

internal sealed record ResolvedRate(Rate Rate, RateSource Source, string? EffectiveFrom);
