// Calculates message costs from token counts and per-million-token rates.
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class CostCalculator
{
    private const double TokensPerRateUnit = 1_000_000.0;

    public static double MessageCost(Tokens tokens, Rate rate) => MessageCostBreakdown(tokens, rate).Total;

    public static CostBreakdown MessageCostBreakdown(Tokens tokens, Rate rate)
    {
        var input = tokens.Input * rate.Input / TokensPerRateUnit;
        var output = tokens.Output * rate.Output / TokensPerRateUnit;
        var cacheRead = tokens.CacheRead * rate.CacheRead / TokensPerRateUnit;
        var cacheWrite = tokens.CacheWrite * rate.CacheWrite / TokensPerRateUnit;
        // Reasoning tokens follow the output rate in the pricing model.
        var reasoning = tokens.Reasoning * rate.Output / TokensPerRateUnit;
        var total = input + output + cacheRead + cacheWrite + reasoning;
        if (!double.IsFinite(total))
        {
            throw new InvalidDataException("Calculated message cost is not finite.");
        }

        return new CostBreakdown(
            input,
            output,
            cacheRead,
            cacheWrite,
            reasoning,
            total);
    }
}
