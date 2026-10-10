// Defines session and per-model usage records returned to the renderer.
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

public sealed class MessageUsage
{
    public long? Date { get; init; }
    public required string Provider { get; init; }
    public required string Model { get; init; }
    public double Cost { get; init; }
    public Tokens Tokens { get; init; } = new();
    public CostSource Source { get; init; }
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
    public List<MessageUsage> Messages { get; } = [];
}
