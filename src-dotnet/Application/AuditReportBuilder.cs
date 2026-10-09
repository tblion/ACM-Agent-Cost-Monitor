// Builds audit reports from database records and pricing diagnostics.
using System.Globalization;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal sealed class AuditPaths(string databasePath, string configPath, string catalogPath)
{
    public string DatabasePath { get; } = databasePath;
    public string ConfigPath { get; } = configPath;
    public string CatalogPath { get; } = catalogPath;
}

internal static class AuditReportBuilder
{
    public static AuditReport Build(
        IReadOnlyList<UsageRow> rows,
        IReadOnlyList<IgnoredRow> ignoredRows,
        IReadOnlyList<DatabaseSessionRow> sessionRows,
        long totalSessions,
        long totalMessages,
        PricingCatalog catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> overrides,
        AuditPaths paths)
    {
        var failed = new List<string>();
        var sessions = new SortedDictionary<string, SessionAccumulator>(StringComparer.Ordinal);
        var seenMessageIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var session in sessionRows)
        {
            if (!sessions.TryAdd(session.SessionId, new SessionAccumulator(
                    session.Project,
                    session.Title,
                    session.ParentId)))
            {
                failed.Add($"duplicateSession:{session.SessionId}");
            }
        }

        if (totalSessions != sessionRows.Count) failed.Add("sessionCount");
        if (totalMessages != rows.Count + ignoredRows.Count) failed.Add("messageClassification");

        var sortedRows = rows.OrderBy(row => row.MessageId, StringComparer.Ordinal).ToArray();
        var messages = new List<AuditMessage>(sortedRows.Length);
        var storedCostTotal = 0.0;
        var calculatedCostTotal = 0.0;
        var selectedCostTotal = 0.0;
        var summaryTokens = new Tokens();
        long recalculableMessages = 0;
        long customRateMessages = 0;
        long catalogRateMessages = 0;
        long storedFallbackMessages = 0;
        long missingTokenMessages = 0;
        long missingDateMessages = 0;
        long missingRateMessages = 0;
        long missingTokens = 0;
        long missingDate = 0;
        long missingRate = 0;
        long invalidRate = 0;
        long storedCostFallback = 0;
        var catalogIndex = PricingService.CreateIndex(catalog);

        foreach (var row in sortedRows)
        {
            if (!seenMessageIds.Add(row.MessageId))
            {
                failed.Add($"duplicateMessage:{row.MessageId}");
            }

            var tokens = row.Tokens is { IsValid: true } ? row.Tokens : null;
            var hasInvalidCustomRate = overrides.TryGetValue((row.Provider, row.Model), out var configuredRate)
                && !configuredRate.IsValid;
            var resolvedRate = PricingService.ResolveRateDetail(row, catalogIndex, overrides);
            var anomalies = new List<AuditAnomaly>();

            if (tokens is null)
            {
                anomalies.Add(AuditAnomaly.MissingTokens);
                missingTokenMessages++;
                missingTokens++;
            }
            if (row.MessageDate is null)
            {
                anomalies.Add(AuditAnomaly.MissingDate);
                missingDateMessages++;
                missingDate++;
            }
            if (hasInvalidCustomRate)
            {
                anomalies.Add(AuditAnomaly.InvalidRate);
                invalidRate++;
            }
            if (resolvedRate is null)
            {
                anomalies.Add(AuditAnomaly.MissingRate);
                missingRateMessages++;
                missingRate++;
            }

            AuditRateSource? rateSource = null;
            if (resolvedRate is not null)
            {
                if (resolvedRate.Source == RateSource.Configured)
                {
                    rateSource = AuditRateSource.Configured;
                    customRateMessages++;
                }
                else
                {
                    rateSource = AuditRateSource.Catalog;
                    catalogRateMessages++;
                }
            }

            var auditRate = resolvedRate is null
                ? null
                : new AuditRate(
                    resolvedRate.Rate.Input,
                    resolvedRate.Rate.Output,
                    resolvedRate.Rate.CacheRead,
                    resolvedRate.Rate.CacheWrite);
            var breakdown = tokens is not null && resolvedRate is not null
                ? CostCalculator.MessageCostBreakdown(tokens, resolvedRate.Rate)
                : null;
            double? calculatedCost = tokens is not null && resolvedRate is not null
                ? IndependentCostReference(tokens, resolvedRate.Rate)
                : null;
            var selectedCost = calculatedCost ?? row.StoredCost;
            var costSource = calculatedCost is not null
                ? rateSource switch
                {
                    AuditRateSource.Configured => AuditCostSource.Configured,
                    AuditRateSource.Catalog => AuditCostSource.Catalog,
                    _ => throw new InvalidDataException("Calculated audit cost has no rate source."),
                }
                : AuditCostSource.Stored;

            if (calculatedCost is not null)
            {
                recalculableMessages++;
            }
            else
            {
                anomalies.Add(AuditAnomaly.StoredCostFallback);
                storedFallbackMessages++;
                storedCostFallback++;
            }

            if (tokens is not null) summaryTokens = summaryTokens.Add(tokens);
            storedCostTotal = AddFinite(storedCostTotal, row.StoredCost);
            calculatedCostTotal = AddFinite(calculatedCostTotal, calculatedCost ?? 0.0);
            selectedCostTotal = AddFinite(selectedCostTotal, selectedCost);

            if (!sessions.TryGetValue(row.SessionId, out var session))
            {
                failed.Add($"missingSession:{row.SessionId}");
                session = new SessionAccumulator(row.Project, row.Title, row.ParentId);
                sessions.Add(row.SessionId, session);
            }
            session.AssistantMessages++;
            session.Cost = AddFinite(session.Cost, selectedCost);
            if (tokens is not null) session.Tokens = session.Tokens.Add(tokens);
            session.MessageIds.Add(row.MessageId);

            var auditMessage = new AuditMessage(
                row.MessageId,
                row.SessionId,
                row.Project,
                row.Provider,
                row.Model,
                row.MessageDate,
                tokens,
                row.StoredCost,
                calculatedCost,
                selectedCost,
                costSource,
                rateSource,
                resolvedRate?.EffectiveFrom,
                auditRate,
                breakdown,
                anomalies);
            messages.Add(auditMessage);
            session.Messages.Add(auditMessage);
        }

        for (var messageIndex = 0; messageIndex < messages.Count; messageIndex++)
        {
            var message = messages[messageIndex];
            var row = sortedRows[messageIndex];
            if (message.Breakdown is not null
                && message.Tokens is not null
                && IndependentRateProvenance(row, catalog, overrides) is { } breakdownRate
                && !BreakdownMatchesReference(message.Breakdown, message.CalculatedCost ?? double.NaN,
                    message.Tokens, breakdownRate.Rate))
            {
                failed.Add($"breakdownCost:{message.MessageId}");
            }

            if (!RateProvenanceMatches(row, message, catalog, overrides))
            {
                failed.Add($"rateProvenance:{message.MessageId}");
            }
        }

        var ignored = ignoredRows
            .Select(row => new AuditIgnoredMessage(row.MessageId, row.SessionId, row.Role, "nonAssistant"))
            .OrderBy(row => row.MessageId, StringComparer.Ordinal)
            .ToArray();

        var auditSessions = new List<AuditSession>(sessions.Count);
        foreach (var (sessionId, session) in sessions)
        {
            session.MessageIds.Sort(StringComparer.Ordinal);
            var sessionMessages = session.Messages;
            var messageCost = sessionMessages.Sum(message => message.SelectedCost);
            if (!ApproximatelyEqual(session.Cost, messageCost)) failed.Add($"sessionCost:{sessionId}");
            var messageTokens = new Tokens();
            foreach (var message in sessionMessages)
            {
                if (message.Tokens is not null) messageTokens = messageTokens.Add(message.Tokens);
            }
            if (!TokensEqual(session.Tokens, messageTokens)) failed.Add($"sessionTokens:{sessionId}");
            if (session.AssistantMessages != sessionMessages.Count) failed.Add($"sessionMessages:{sessionId}");

            auditSessions.Add(new AuditSession(
                sessionId,
                session.Project,
                session.Title,
                session.ParentId,
                session.AssistantMessages,
                session.Cost,
                session.Tokens,
                session.MessageIds));
        }

        var invariantStatus = new AuditInvariantStatus(failed.Count == 0, failed);
        var summary = new AuditSummary(
            totalSessions,
            totalMessages,
            auditSessions.LongCount(session => session.AssistantMessages > 0),
            messages.Count,
            ignored.Length,
            recalculableMessages,
            customRateMessages,
            catalogRateMessages,
            storedFallbackMessages,
            missingTokenMessages,
            missingDateMessages,
            missingRateMessages,
            storedCostTotal,
            calculatedCostTotal,
            selectedCostTotal,
            summaryTokens,
            new AuditAnomalyCounts(missingTokens, missingDate, missingRate, invalidRate, storedCostFallback));
        var provenance = new AuditProvenance(
            paths.DatabasePath,
            paths.ConfigPath,
            paths.CatalogPath,
            catalog.Version,
            catalog.SourceVersion,
            catalog.GeneratedAt,
            catalog.Rates.Count);

        return new AuditReport(
            DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            invariantStatus.Valid,
            provenance,
            summary,
            messages,
            ignored,
            auditSessions,
            invariantStatus);
    }

    private static double IndependentCostReference(Tokens tokens, Rate rate) =>
        tokens.Input * rate.Input / 1_000_000.0
        + tokens.Output * rate.Output / 1_000_000.0
        + tokens.CacheRead * rate.CacheRead / 1_000_000.0
        + tokens.CacheWrite * rate.CacheWrite / 1_000_000.0
        + tokens.Reasoning * rate.Output / 1_000_000.0;

    private static IndependentRate? IndependentRateProvenance(
        UsageRow row,
        PricingCatalog catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> overrides)
    {
        if (overrides.TryGetValue((row.Provider, row.Model), out var customRate) && customRate.IsValid)
        {
            return new IndependentRate(customRate, AuditRateSource.Configured, null);
        }

        if (row.MessageDate is not { } messageDate) return null;
        var catalogRate = catalog.Rates
            .Where(rate => rate.Provider == row.Provider && rate.Model == row.Model)
            .Select(rate => (Rate: rate, Milliseconds: DateTimeOffset.Parse(
                rate.EffectiveFrom,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal).ToUnixTimeMilliseconds()))
            .Where(candidate => candidate.Milliseconds <= messageDate)
            .OrderByDescending(candidate => candidate.Milliseconds)
            .Select(candidate => candidate.Rate)
            .FirstOrDefault();
        if (catalogRate is null) return null;

        var rate = new Rate(catalogRate.Input, catalogRate.Output, catalogRate.CacheRead, catalogRate.CacheWrite);
        return rate.IsValid
            ? new IndependentRate(rate, AuditRateSource.Catalog, catalogRate.EffectiveFrom)
            : null;
    }

    private static bool RateProvenanceMatches(
        UsageRow row,
        AuditMessage message,
        PricingCatalog catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> overrides)
    {
        var expected = IndependentRateProvenance(row, catalog, overrides);
        if (expected is null)
        {
            return message.RateSource is null
                && message.EffectiveFrom is null
                && message.Rate is null;
        }

        return message.RateSource == expected.Source
            && message.EffectiveFrom == expected.EffectiveFrom
            && message.Rate is { } actual
            && ApproximatelyEqual(actual.Input, expected.Rate.Input)
            && ApproximatelyEqual(actual.Output, expected.Rate.Output)
            && ApproximatelyEqual(actual.CacheRead, expected.Rate.CacheRead)
            && ApproximatelyEqual(actual.CacheWrite, expected.Rate.CacheWrite);
    }

    private static bool BreakdownMatchesReference(
        CostBreakdown breakdown,
        double calculatedCost,
        Tokens tokens,
        Rate rate)
    {
        var reference = IndependentCostReference(tokens, rate);
        return ApproximatelyEqual(breakdown.Total, reference)
            && ApproximatelyEqual(calculatedCost, reference);
    }

    private static bool TokensEqual(Tokens left, Tokens right) =>
        ApproximatelyEqual(left.Input, right.Input)
        && ApproximatelyEqual(left.Output, right.Output)
        && ApproximatelyEqual(left.CacheRead, right.CacheRead)
        && ApproximatelyEqual(left.CacheWrite, right.CacheWrite)
        && ApproximatelyEqual(left.Reasoning, right.Reasoning);

    private static bool ApproximatelyEqual(double left, double right)
    {
        if (left == right) return true;
        var scale = Math.Max(Math.Max(Math.Abs(left), Math.Abs(right)), 1.0);
        return Math.Abs(left - right) <= 1e-9 * scale;
    }

    private static double AddFinite(double left, double right)
    {
        var sum = left + right;
        return double.IsFinite(sum)
            ? sum
            : throw new InvalidDataException("Audit total is not finite.");
    }

    private sealed class SessionAccumulator(string project, string title, string? parentId)
    {
        public string Project { get; } = project;
        public string Title { get; } = title;
        public string? ParentId { get; } = parentId;
        public long AssistantMessages { get; set; }
        public double Cost { get; set; }
        public Tokens Tokens { get; set; } = new();
        public List<string> MessageIds { get; } = [];
        public List<AuditMessage> Messages { get; } = [];
    }

    private sealed record IndependentRate(Rate Rate, AuditRateSource Source, string? EffectiveFrom);
}
