using System.Text.Json.Serialization;

namespace OpencodeCostsViewer.Backend.Models;

public sealed record Tokens(
    double Input = 0,
    double Output = 0,
    double CacheRead = 0,
    double CacheWrite = 0,
    double Reasoning = 0)
{
    [JsonIgnore]
    public bool IsValid =>
        IsValidValue(Input)
        && IsValidValue(Output)
        && IsValidValue(CacheRead)
        && IsValidValue(CacheWrite)
        && IsValidValue(Reasoning);

    public Tokens Add(Tokens other) => new(
        AddFinite(Input, other.Input),
        AddFinite(Output, other.Output),
        AddFinite(CacheRead, other.CacheRead),
        AddFinite(CacheWrite, other.CacheWrite),
        AddFinite(Reasoning, other.Reasoning));

    private static bool IsValidValue(double value) => double.IsFinite(value) && value >= 0;

    private static double AddFinite(double left, double right)
    {
        var sum = left + right;
        return double.IsFinite(sum)
            ? sum
            : throw new InvalidDataException("Aggregated token count is not finite.");
    }
}

public sealed record CostBreakdown(
    double Input,
    double Output,
    double CacheRead,
    double CacheWrite,
    double Reasoning,
    double Total);
