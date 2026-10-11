// Defines normalized source records consumed by agent import adapters.
namespace OpencodeCostsViewer.Backend.Models;

internal sealed record SourceImportSnapshot(
    IReadOnlyList<SourceSessionRow> Sessions,
    IReadOnlyList<SourceMessageRow> Messages,
    long? LastSourceTimestamp = null,
    IReadOnlyDictionary<string, long>? SessionWatermarks = null);

internal sealed record SourceImportState(
    long? LastSourceTimestamp,
    IReadOnlyDictionary<string, long> SessionWatermarks);

internal sealed record SourceSessionRow(
    string SessionId,
    string Project,
    string Title,
    string? ParentId,
    long Date);

internal sealed record SourceMessageRow(
    string MessageId,
    string SessionId,
    string Role,
    long? MessageDate,
    string Provider,
    string Model,
    double StoredCost,
    Tokens? Tokens);

public sealed record InternalStoreStatus(
    string DatabasePath,
    long Projects,
    long Sessions,
    long Messages,
    long Sources,
    string? LastImportedAt,
    string? LastSyncError);

public sealed record InternalStoreSource(
    string SourceId,
    string AgentName,
    string SourcePath,
    string? LastImportedAt,
    string LastSyncAttemptAt,
    string? LastSyncError)
{
    public string ChannelKey { get; init; } = "database";
}

public sealed record InternalStoreMergeResult(long ProjectsAdded, long SessionsAdded, long MessagesAdded);
