// Defines persisted application preferences and resolved path data.
using System.Text.Json.Serialization;

namespace OpencodeCostsViewer.Backend.Models;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record Settings
{
    public string? DbPath { get; init; }
    public string? ConfigPath { get; init; }
    public bool Live { get; init; }
    public string Theme { get; init; } = "system";
    public string? Language { get; init; }
    public long DefaultPeriodDays { get; init; } = 30;
    public List<CustomGroup> CustomGroups { get; init; } = [];
    public List<ConfiguredRateVersion> CustomRates { get; init; } = [];
    public List<FixedSubscription> FixedSubscriptions { get; init; } = [];
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CustomGroup
{
    public required string Name { get; init; }
    public required List<string> Projects { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class FixedSubscription
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public required string Provider { get; init; }
    public string? Name { get; init; }
    public double Amount { get; init; }
    public required string Period { get; init; }
    public List<string> Models { get; init; } = [];
    public required string EffectiveFrom { get; init; }
    public string? EffectiveTo { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ConfiguredRateVersion
{
    public required string Id { get; init; }
    public required string Provider { get; init; }
    public required string Model { get; init; }
    public double Input { get; init; }
    public double Output { get; init; }
    public double CacheRead { get; init; }
    public double CacheWrite { get; init; }
    public required string EffectiveFrom { get; init; }
    public required string Source { get; init; }
}

public sealed record ResolvedPaths(string Db, string Config);

public sealed record AppError(string Code, string Message);

public sealed record SettingsStatus(Settings Settings, AppError? Diagnostic);
