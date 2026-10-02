using System.Globalization;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class PricingService
{
    public static PricingCatalogIndex CreateIndex(PricingCatalog catalog) => new(catalog);

    public static CatalogStatus GetCatalogStatus(PricingCatalog catalog) => new(
        true,
        catalog.Version,
        catalog.GeneratedAt,
        catalog.SourceVersion,
        catalog.Rates.Count);

    public static IReadOnlyList<RateEntry> RatesForRows(
        IEnumerable<UsageRow> rows,
        PricingCatalog catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> overrides)
    {
        var index = CreateIndex(catalog);
        var entries = new Dictionary<RateEntryKey, RateEntry>();
        foreach (var row in rows)
        {
            if (row.Tokens?.IsValid != true) continue;
            var resolved = ResolveRateDetail(row, index, overrides);
            if (resolved is null) continue;

            var entry = new RateEntry(
                row.Provider,
                row.Model,
                resolved.Rate.Input,
                resolved.Rate.Output,
                resolved.Rate.CacheRead,
                resolved.Rate.CacheWrite,
                resolved.Source == RateSource.Configured ? "configured" : "catalog",
                resolved.EffectiveFrom);
            entries.TryAdd(RateEntryKey.From(entry), entry);
        }

        return entries.Values
            .OrderBy(entry => entry.Provider, StringComparer.Ordinal)
            .ThenBy(entry => entry.Model, StringComparer.Ordinal)
            .ThenBy(entry => entry.EffectiveFrom, NullableOrdinalComparer.Instance)
            .ToArray();
    }

    public static ResolvedRate? ResolveRateDetail(
        UsageRow row,
        PricingCatalogIndex catalog,
        IReadOnlyDictionary<(string Provider, string Model), Rate> overrides)
    {
        if (overrides.TryGetValue((row.Provider, row.Model), out var configuredRate) && configuredRate.IsValid)
        {
            return new ResolvedRate(configuredRate, RateSource.Configured, null);
        }

        if (row.MessageDate is not { } messageDate)
        {
            return null;
        }

        var rate = catalog.RateFor(row.Provider, row.Model, messageDate);
        if (rate is null)
        {
            return null;
        }

        var resolvedRate = new Rate(rate.Input, rate.Output, rate.CacheRead, rate.CacheWrite);
        return resolvedRate.IsValid
            ? new ResolvedRate(resolvedRate, RateSource.Catalog, rate.EffectiveFrom)
            : null;
    }
}

internal sealed class PricingCatalogIndex
{
    private readonly Dictionary<(string Provider, string Model), IndexedPricingRate[]> _ratesByModel;

    public PricingCatalogIndex(PricingCatalog catalog)
    {
        _ratesByModel = catalog.Rates
            .GroupBy(rate => (rate.Provider, rate.Model))
            .ToDictionary(
                group => group.Key,
                group => group.Select(rate => new IndexedPricingRate(
                        rate,
                        DateTimeOffset.Parse(rate.EffectiveFrom, CultureInfo.InvariantCulture,
                            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal).ToUnixTimeMilliseconds()))
                    .OrderBy(rate => rate.EffectiveAtMilliseconds)
                    .ToArray());
    }

    public PricingRate? RateFor(string provider, string model, long messageDate)
    {
        if (!_ratesByModel.TryGetValue((provider, model), out var rates))
        {
            return null;
        }

        var low = 0;
        var high = rates.Length - 1;
        var best = -1;
        while (low <= high)
        {
            var middle = low + ((high - low) / 2);
            if (rates[middle].EffectiveAtMilliseconds <= messageDate)
            {
                best = middle;
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        return best < 0 ? null : rates[best].Rate;
    }

    private sealed record IndexedPricingRate(PricingRate Rate, long EffectiveAtMilliseconds);
}

internal readonly record struct RateEntryKey(
    string Provider,
    string Model,
    long Input,
    long Output,
    long CacheRead,
    long CacheWrite,
    string Source,
    string? EffectiveFrom)
{
    public static RateEntryKey From(RateEntry entry) => new(
        entry.Provider,
        entry.Model,
        Bits(entry.Input),
        Bits(entry.Output),
        Bits(entry.CacheRead),
        Bits(entry.CacheWrite),
        entry.Source,
        entry.EffectiveFrom);

    private static long Bits(double value) => BitConverter.DoubleToInt64Bits(value == 0 ? 0 : value);
}

internal sealed class NullableOrdinalComparer : IComparer<string?>
{
    public static NullableOrdinalComparer Instance { get; } = new();

    public int Compare(string? left, string? right) => StringComparer.Ordinal.Compare(left, right);
}
