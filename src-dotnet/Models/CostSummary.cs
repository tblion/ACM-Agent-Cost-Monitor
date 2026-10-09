// Defines summarized cost totals grouped by provider and model.
namespace OpencodeCostsViewer.Backend.Models;

public sealed record CostSummary(
    string Provider,
    string Model,
    ulong Messages,
    double StoredCost,
    bool Configured);
