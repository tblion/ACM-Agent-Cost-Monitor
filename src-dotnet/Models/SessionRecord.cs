namespace OpencodeCostsViewer.Backend.Models;

public enum CostSource
{
    Configured,
    Stored,
}

public sealed class ModelUsage
{
    public required string Provider { get; init; }
    public required string Model { get; init; }
    public double Cost { get; set; }
    public Tokens Tokens { get; set; } = new();
    public CostSource Source { get; set; }
}

public sealed class SessionRecord
{
    public required string Id { get; init; }
    public required string Project { get; init; }
    public required string Title { get; init; }
    public long Date { get; init; }
    public double Cost { get; set; }
    public Tokens Tokens { get; set; } = new();
    public bool IsSubagent { get; init; }
    public string? ParentId { get; init; }
    public CostSource Source { get; set; } = CostSource.Configured;
    public List<ModelUsage> Models { get; } = [];
}
