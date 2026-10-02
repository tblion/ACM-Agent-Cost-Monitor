namespace OpencodeCostsViewer.Backend.Models;

internal sealed record UsageRow(
    string MessageId,
    string Project,
    string SessionId,
    string Title,
    string? ParentId,
    long Date,
    long? MessageDate,
    string Provider,
    string Model,
    double StoredCost,
    Tokens? Tokens);

internal sealed record IgnoredRow(string MessageId, string SessionId, string Role);

internal sealed record DatabaseSessionRow(string SessionId, string Project, string Title, string? ParentId);

internal sealed record DatabaseAuditSnapshot(
    List<UsageRow> Rows,
    List<IgnoredRow> IgnoredRows,
    List<DatabaseSessionRow> SessionRows,
    long TotalSessions,
    long TotalMessages);
