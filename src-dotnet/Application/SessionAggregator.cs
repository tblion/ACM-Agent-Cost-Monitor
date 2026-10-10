// Aggregates message usage into session-level cost and token summaries.
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class SessionAggregator
{
    public static IReadOnlyList<SessionRecord> Aggregate(
        IEnumerable<UsageRow> rows,
        PricingCatalog catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> overrides)
    {
        var sessions = new Dictionary<string, SessionRecord>(StringComparer.Ordinal);
        var modelIndexes = new Dictionary<string, Dictionary<(string Provider, string Model), ModelUsage>>(StringComparer.Ordinal);
        var catalogIndex = PricingService.CreateIndex(catalog);
        foreach (var row in rows)
        {
            var tokensAreValid = row.Tokens?.IsValid == true;
            var resolvedRate = tokensAreValid
                ? PricingService.ResolveRateDetail(row, catalogIndex, overrides)
                : null;
            var usedConfiguredRate = resolvedRate is not null;
            var cost = resolvedRate is null
                ? row.StoredCost
                : CostCalculator.MessageCost(row.Tokens!, resolvedRate.Rate);
            var tokens = tokensAreValid ? row.Tokens! : new Tokens();
            var sessionKey = row.SessionId;

            if (!sessions.TryGetValue(sessionKey, out var session))
            {
                session = new SessionRecord
                {
                    Id = row.SessionId,
                    Project = row.Project,
                    Title = row.Title,
                    Date = row.Date,
                    IsSubagent = row.ParentId is not null,
                    ParentId = row.ParentId,
                };
                sessions.Add(sessionKey, session);
                modelIndexes.Add(sessionKey, []);
            }

            session.Messages.Add(new MessageUsage
            {
                Date = row.MessageDate,
                Provider = row.Provider,
                Model = row.Model,
                Cost = cost,
                Tokens = tokens,
                Source = usedConfiguredRate ? CostSource.Configured : CostSource.Stored,
            });

            session.Cost = AddFinite(session.Cost, cost);
            session.Tokens = session.Tokens.Add(tokens);
            if (!usedConfiguredRate)
            {
                session.Source = CostSource.Stored;
            }

            var models = modelIndexes[sessionKey];
            var modelKey = (row.Provider, row.Model);
            if (!models.TryGetValue(modelKey, out var modelUsage))
            {
                modelUsage = new ModelUsage
                {
                    Provider = row.Provider,
                    Model = row.Model,
                    Cost = cost,
                    Tokens = tokens,
                    Source = usedConfiguredRate ? CostSource.Configured : CostSource.Stored,
                };
                session.Models.Add(modelUsage);
                models.Add(modelKey, modelUsage);
            }
            else
            {
                modelUsage.Cost = AddFinite(modelUsage.Cost, cost);
                modelUsage.Tokens = modelUsage.Tokens.Add(tokens);
                if (!usedConfiguredRate)
                {
                    modelUsage.Source = CostSource.Stored;
                }
            }
        }

        foreach (var session in sessions.Values)
        {
            session.Models.Sort(static (left, right) =>
            {
                var providerOrder = StringComparer.Ordinal.Compare(left.Provider, right.Provider);
                return providerOrder != 0
                    ? providerOrder
                    : StringComparer.Ordinal.Compare(left.Model, right.Model);
            });
        }

        return sessions.Values
            .OrderByDescending(session => session.Date)
            .ThenBy(session => session.Id, StringComparer.Ordinal)
            .ToArray();
    }

    private static double AddFinite(double left, double right)
    {
        var sum = left + right;
        return double.IsFinite(sum)
            ? sum
            : throw new InvalidDataException("Aggregated session cost is not finite.");
    }
}
