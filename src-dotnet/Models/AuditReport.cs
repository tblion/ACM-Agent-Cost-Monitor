namespace OpencodeCostsViewer.Backend.Models;

public enum AuditCostSource
{
    Configured,
    Catalog,
    Stored,
}

public enum AuditRateSource
{
    Configured,
    Catalog,
}

public enum AuditAnomaly
{
    MissingTokens,
    MissingDate,
    MissingRate,
    InvalidRate,
    StoredCostFallback,
}

public sealed record AuditRate(double Input, double Output, double CacheRead, double CacheWrite);

public sealed record AuditAnomalyCounts(
    long MissingTokens,
    long MissingDate,
    long MissingRate,
    long InvalidRate,
    long StoredCostFallback);

public sealed record AuditProvenance(
    string DatabasePath,
    string ConfigPath,
    string CatalogPath,
    uint CatalogVersion,
    string CatalogSourceVersion,
    string CatalogGeneratedAt,
    long CatalogRateCount);

public sealed record AuditSummary(
    long AllSessions,
    long TotalMessages,
    long SessionsWithAssistant,
    long AssistantMessages,
    long IgnoredMessages,
    long RecalculableMessages,
    long CustomRateMessages,
    long CatalogRateMessages,
    long StoredFallbackMessages,
    long MissingTokenMessages,
    long MissingDateMessages,
    long MissingRateMessages,
    double StoredCostTotal,
    double CalculatedCostTotal,
    double SelectedCostTotal,
    Tokens Tokens,
    AuditAnomalyCounts AnomalyCounts);

public sealed record AuditMessage(
    string MessageId,
    string SessionId,
    string Project,
    string Provider,
    string Model,
    long? MessageDate,
    Tokens? Tokens,
    double StoredCost,
    double? CalculatedCost,
    double SelectedCost,
    AuditCostSource CostSource,
    AuditRateSource? RateSource,
    string? EffectiveFrom,
    AuditRate? Rate,
    CostBreakdown? Breakdown,
    IReadOnlyList<AuditAnomaly> Anomalies);

public sealed record AuditIgnoredMessage(string MessageId, string SessionId, string Role, string Reason);

public sealed record AuditSession(
    string SessionId,
    string Project,
    string Title,
    string? ParentId,
    long AssistantMessages,
    double Cost,
    Tokens Tokens,
    IReadOnlyList<string> MessageIds);

public sealed record AuditInvariantStatus(bool Valid, IReadOnlyList<string> Failed);

public sealed record AuditReport(
    string GeneratedAt,
    bool Valid,
    AuditProvenance Provenance,
    AuditSummary Summary,
    IReadOnlyList<AuditMessage> Messages,
    IReadOnlyList<AuditIgnoredMessage> Ignored,
    IReadOnlyList<AuditSession> Sessions,
    AuditInvariantStatus Invariants);
