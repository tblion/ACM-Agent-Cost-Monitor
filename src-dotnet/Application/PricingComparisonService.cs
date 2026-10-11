// Fetches independent public pricing sources and normalizes explicit model prices.
using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal sealed class PricingComparisonService : IDisposable
{
    private static readonly (string Provider, string SourceId, string Name, Uri Url)[] OfficialSources =
    [
        ("openai", "openai-official", "OpenAI (official)", new Uri("https://developers.openai.com/api/docs/pricing")),
        ("anthropic", "anthropic-official", "Anthropic (official)", new Uri("https://platform.claude.com/docs/en/about-claude/pricing")),
        ("google", "google-official", "Google Gemini API (official)", new Uri("https://ai.google.dev/gemini-api/docs/pricing")),
    ];
    private static readonly (string Provider, string SourceId, string Name, Uri Url)[] SubscriptionSources =
    [
        ("openai", "openai-subscription", "OpenAI (official)", new Uri("https://chatgpt.com/pricing/")),
        ("anthropic", "anthropic-subscription", "Anthropic (official)", new Uri("https://claude.com/pricing")),
        ("google", "google-subscription", "Google AI plans (official)", new Uri("https://one.google.com/intl/en_us/about/google-ai-plans/")),
    ];
    private static readonly Uri LiteLlmPricing = new("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json");
    private readonly HttpClient _httpClient;

    public PricingComparisonService(HttpClient? httpClient = null) =>
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };

    public void Dispose() => _httpClient.Dispose();

    public async Task<PricingComparisonResult> GetCandidatesAsync(
        IReadOnlyList<PricingLookupKey> keys,
        CancellationToken cancellationToken)
    {
        ValidateKeys(keys);
        var retrievedAt = DateTimeOffset.UtcNow;
        var sources = new List<PricingSourceResult>();
        foreach (var source in OfficialSources.Where(source => keys.Any(key => key.Kind == "usage"
                     && key.Provider.Equals(source.Provider, StringComparison.OrdinalIgnoreCase))))
        {
            sources.Add(await ReadSourceAsync(
                source.SourceId, "official", source.Name, source.Url,
                uri => ParseOfficialAsync(uri, source, keys.Where(key => key.Kind == "usage"
                    && key.Provider.Equals(source.Provider, StringComparison.OrdinalIgnoreCase)).Select(key => key.Model)
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), retrievedAt, cancellationToken), cancellationToken));
        }

        var requestedModels = keys.Where(key => key.Kind == "usage").Select(key => key.Model)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (requestedModels.Length > 0)
        {
            sources.Add(await ReadSourceAsync(
                "litellm", "aggregator", "LiteLLM (community-maintained)", LiteLlmPricing,
                uri => ParseLiteLlmAsync(uri, keys, retrievedAt, cancellationToken), cancellationToken));
        }

        foreach (var source in SubscriptionSources.Where(source => keys.Any(key => key.Kind == "subscription"
                     && key.Provider.Equals(source.Provider, StringComparison.OrdinalIgnoreCase))))
        {
            var offers = keys.Where(key => key.Kind == "subscription"
                && key.Provider.Equals(source.Provider, StringComparison.OrdinalIgnoreCase)).Select(key => key.Model)
                .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            sources.Add(await ReadSourceAsync(
                source.SourceId, "official", source.Name, source.Url,
                uri => ParseSubscriptionAsync(uri, source, offers, retrievedAt, cancellationToken), cancellationToken));
        }

        if (IsE2ePricingEnabled())
        {
            sources.Add(await ReadSourceAsync(
                "failed-source", "official", "Unavailable fixture source", new Uri("https://fixture.invalid/"),
                async _ => await FetchFailedFixtureAsync(cancellationToken), cancellationToken));
        }

        return new PricingComparisonResult(retrievedAt, AddAgreementReasons(sources));
    }

    private async Task<PricingSourceResult> ReadSourceAsync(
        string sourceId,
        string sourceType,
        string sourceName,
        Uri defaultUri,
        Func<Uri, Task<IReadOnlyList<PricingCandidate>>> read,
        CancellationToken cancellationToken)
    {
        var uri = ResolveUri(sourceId, defaultUri);
        try
        {
            var candidates = await read(uri);
            return new PricingSourceResult(sourceId, sourceType, sourceName, uri.ToString(), "available", null, candidates);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException or InvalidDataException)
        {
            return new PricingSourceResult(sourceId, sourceType, sourceName, uri.ToString(), "error", exception.Message, []);
        }
    }

    private async Task<IReadOnlyList<PricingCandidate>> ParseOfficialAsync(
        Uri uri,
        (string Provider, string SourceId, string Name, Uri Url) source,
        IReadOnlyList<string> requestedModels,
        DateTimeOffset retrievedAt,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        if (response.Content.Headers.ContentType?.MediaType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true)
        {
            using var document = JsonDocument.Parse(content);
            if (!document.RootElement.TryGetProperty("candidates", out var candidates)) return [];
            return candidates.EnumerateArray().Select(item => new PricingCandidate(
                source.SourceId, "official", source.Name, uri.ToString(), retrievedAt,
                item.TryGetProperty("effectiveFrom", out var effectiveFrom) ? effectiveFrom.GetString() : null,
                source.Provider, item.GetProperty("model").GetString()!, null, "USD", "per_million_tokens",
                ReadNullableNumber(item, "input"), ReadNullableNumber(item, "output"),
                ReadNullableNumber(item, "cacheRead"), ReadNullableNumber(item, "cacheWrite"),
                "exact", ["Official source", "Exact model identifier", "USD per million tokens"])).ToArray();
        }

        var result = new List<PricingCandidate>();
        foreach (var model in requestedModels)
        {
            var row = Regex.Match(content,
                $@"<tr\b[^>]*>(?:(?!</tr>).)*?(?<![\w.-]){Regex.Escape(model)}(?![\w.-])(?:(?!</tr>).)*?</tr>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (!row.Success) continue;
            var rowText = WebUtility.HtmlDecode(Regex.Replace(row.Value, "<[^>]+>", " "));
            var values = Regex.Matches(rowText, @"\$\s*(?<value>\d+(?:\.\d+)?)");
            if (values.Count < 2) continue;
            var numbers = values.Select(value => double.Parse(value.Groups["value"].Value, CultureInfo.InvariantCulture)).ToArray();
            result.Add(new PricingCandidate(
                source.SourceId, "official", source.Name, uri.ToString(), retrievedAt,
                null, source.Provider, model, null, "USD", "per_million_tokens", numbers[0], numbers[1],
                numbers.Length > 2 ? numbers[2] : null, numbers.Length > 3 ? numbers[3] : null,
                "exact", ["Official source", "Exact model identifier", "USD per million tokens"]));
        }
        return result;
    }

    private async Task<IReadOnlyList<PricingCandidate>> ParseLiteLlmAsync(
        Uri uri,
        IReadOnlyList<PricingLookupKey> keys,
        DateTimeOffset retrievedAt,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var root = document.RootElement;
        var result = new List<PricingCandidate>();
        foreach (var key in keys.Where(key => key.Kind == "usage"))
        {
            foreach (var entry in root.EnumerateObject())
            {
                if (!entry.Value.TryGetProperty("litellm_provider", out var providerValue)
                    || !string.Equals(providerValue.GetString(), key.Provider, StringComparison.OrdinalIgnoreCase)) continue;
                var exact = string.Equals(entry.Name, key.Model, StringComparison.OrdinalIgnoreCase);
                var similar = entry.Name.Contains(key.Model, StringComparison.OrdinalIgnoreCase)
                    || key.Model.Contains(entry.Name, StringComparison.OrdinalIgnoreCase);
                if (!exact && !similar) continue;
                var item = entry.Value;
                var input = ReadNullableNumber(item, "input_cost_per_token");
                var output = ReadNullableNumber(item, "output_cost_per_token");
                if (input is null && output is null) continue;
                result.Add(new PricingCandidate(
                    "litellm", "aggregator", "LiteLLM (community-maintained)", uri.ToString(), retrievedAt,
                    null, key.Provider, entry.Name, null, "USD", "per_million_tokens",
                    ScaleToMillionTokens(input), ScaleToMillionTokens(output),
                    ScaleToMillionTokens(ReadNullableNumber(item, "cache_read_input_token_cost")),
                    ScaleToMillionTokens(ReadNullableNumber(item, "cache_creation_input_token_cost")),
                    exact ? "exact" : "ambiguous",
                    exact
                        ? ["Community-maintained aggregator", "Exact model identifier", "USD per million tokens"]
                        : ["Community-maintained aggregator", "Model identifier differs; manual verification required"]));
            }
        }
        return result;
    }

    private async Task<IReadOnlyList<PricingCandidate>> ParseSubscriptionAsync(
        Uri uri,
        (string Provider, string SourceId, string Name, Uri Url) source,
        IReadOnlyList<string> offers,
        DateTimeOffset retrievedAt,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        if (response.Content.Headers.ContentType?.MediaType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true)
        {
            using var document = JsonDocument.Parse(content);
            if (!document.RootElement.TryGetProperty("candidates", out var candidates)) return [];
            return candidates.EnumerateArray().Where(item => offers.Any(offer =>
                    offer.Equals(item.GetProperty("model").GetString(), StringComparison.OrdinalIgnoreCase)))
                .Select(item => new PricingCandidate(
                    source.SourceId, "official", source.Name, uri.ToString(), retrievedAt,
                    item.TryGetProperty("effectiveFrom", out var effectiveFrom) ? effectiveFrom.GetString() : null,
                    source.Provider, item.GetProperty("model").GetString()!,
                    item.TryGetProperty("region", out var region) ? region.GetString() : null,
                    item.TryGetProperty("currency", out var currency) ? currency.GetString() ?? "UNKNOWN" : "UNKNOWN",
                    item.TryGetProperty("unit", out var unit) ? unit.GetString() ?? "period unknown" : "period unknown",
                    ReadNullableNumber(item, "amount"), null, null, null, "ambiguous",
                    ["Official source", "Region not specified", "Tax inclusion not specified"]))
                .ToArray();
        }
        var text = WebUtility.HtmlDecode(Regex.Replace(content, "<[^>]+>", " "));
        var result = new List<PricingCandidate>();
        foreach (var offer in offers)
        {
            var index = text.IndexOf(offer, StringComparison.OrdinalIgnoreCase);
            if (index < 0) continue;
            var excerpt = text[index..Math.Min(text.Length, index + 600)];
            var price = Regex.Match(excerpt,
                @"(?<currency>USD|EUR|GBP|CAD|AUD|\$|€|£)\s*(?<amount>\d+(?:\.\d{1,2})?)\s*(?:/|per)\s*(?<period>month|monthly|year|annual|annually)",
                RegexOptions.IgnoreCase);
            if (!price.Success) continue;
            var currency = price.Groups["currency"].Value.ToUpperInvariant() switch
            {
                "€" => "EUR",
                "£" => "GBP",
                "$" => "USD",
                var code => code,
            };
            var period = price.Groups["period"].Value.StartsWith("m", StringComparison.OrdinalIgnoreCase) ? "monthly" : "annual";
            var ambiguousCurrency = price.Groups["currency"].Value is "$";
            result.Add(new PricingCandidate(
                source.SourceId, "official", source.Name, uri.ToString(), retrievedAt, null,
                source.Provider, offer, null, currency, period,
                double.Parse(price.Groups["amount"].Value, CultureInfo.InvariantCulture), null, null, null,
                "ambiguous",
                ["Official source", "Region not specified", "Tax inclusion not specified",
                    .. (ambiguousCurrency ? new[] { "Currency symbol does not identify a country" } : Array.Empty<string>())]));
        }
        return result;
    }

    private async Task<IReadOnlyList<PricingCandidate>> FetchFailedFixtureAsync(CancellationToken cancellationToken)
    {
        var uri = ResolveUri("failed-source", new Uri("http://127.0.0.1/"));
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        return [];
    }

    private static IReadOnlyList<PricingSourceResult> AddAgreementReasons(IReadOnlyList<PricingSourceResult> sources) =>
        sources.Select(source => source with
        {
            Candidates = source.Candidates.Select(candidate =>
            {
                var independent = sources.SelectMany(other => other.Candidates)
                    .Where(other => other.SourceId != candidate.SourceId
                        && other.MatchStatus == "exact"
                        && other.Provider.Equals(candidate.Provider, StringComparison.OrdinalIgnoreCase)
                        && other.Model.Equals(candidate.Model, StringComparison.OrdinalIgnoreCase)
                        && other.Currency == candidate.Currency
                        && other.Unit == candidate.Unit).ToArray();
                var agrees = independent.Any(other => other.Input == candidate.Input && other.Output == candidate.Output);
                var disagrees = independent.Any(other => other.Input != candidate.Input || other.Output != candidate.Output);
                return candidate with
                {
                    ConfidenceReasons = [
                        .. candidate.ConfidenceReasons,
                        candidate.RetrievedAt.Date == DateTimeOffset.UtcNow.Date
                            ? "Retrieved during this comparison"
                            : $"Retrieved on {candidate.RetrievedAt:yyyy-MM-dd}",
                        .. (agrees ? new[] { "Independent exact source agrees on published prices" } : Array.Empty<string>()),
                        .. (disagrees ? new[] { "Independent exact source reports a different price" } : Array.Empty<string>()),
                    ],
                };
            }).ToArray(),
        }).ToArray();

    private static Uri ResolveUri(string sourceId, Uri defaultUri)
    {
        if (!IsE2ePricingEnabled()) return defaultUri;
        var variable = sourceId switch
        {
            "openai-official" => "OPENCODE_COSTS_PRICING_OFFICIAL_URL",
            "anthropic-official" => "OPENCODE_COSTS_PRICING_OFFICIAL_URL",
            "google-official" => "OPENCODE_COSTS_PRICING_OFFICIAL_URL",
            "openai-subscription" => "OPENCODE_COSTS_PRICING_SUBSCRIPTION_URL",
            "anthropic-subscription" => "OPENCODE_COSTS_PRICING_SUBSCRIPTION_URL",
            "google-subscription" => "OPENCODE_COSTS_PRICING_SUBSCRIPTION_URL",
            "litellm" => "OPENCODE_COSTS_PRICING_AGGREGATOR_URL",
            "failed-source" => "OPENCODE_COSTS_PRICING_FAILED_SOURCE_URL",
            _ => throw new InvalidOperationException("Unknown pricing source."),
        };
        var configured = Environment.GetEnvironmentVariable(variable);
        if (!Uri.TryCreate(configured, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttp || !uri.IsLoopback)
            throw new InvalidDataException("E2E pricing endpoints must use loopback HTTP.");
        return uri;
    }

    private static bool IsE2ePricingEnabled() =>
        string.Equals(Environment.GetEnvironmentVariable("OPENCODE_COSTS_PRICING_E2E"), "true", StringComparison.Ordinal);

    private static double? ReadNullableNumber(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : null;

    private static double? ScaleToMillionTokens(double? value) => value * 1_000_000;

    private static void ValidateKeys(IReadOnlyList<PricingLookupKey> keys)
    {
        if (keys.Count is 0 or > 100) throw new ArgumentException("Provide between 1 and 100 pricing lookup keys.");
        if (keys.Any(key => key.Kind is not ("usage" or "subscription") || string.IsNullOrWhiteSpace(key.Provider)
            || string.IsNullOrWhiteSpace(key.Model) || key.Provider.Length > 100 || key.Model.Length > 200))
            throw new ArgumentException("Only bounded usage provider/model identifiers are supported.");
    }
}
