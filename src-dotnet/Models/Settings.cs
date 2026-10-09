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
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class CustomGroup
{
    public required string Name { get; init; }
    public required List<string> Projects { get; init; }
}

public sealed record ResolvedPaths(string Db, string Config);

public sealed record AppError(string Code, string Message);

public sealed record SettingsStatus(Settings Settings, AppError? Diagnostic);
