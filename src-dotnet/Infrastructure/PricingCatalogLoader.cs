using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static partial class PricingCatalogLoader
{
    private const string EmbeddedResourceName = "OpencodeCostsViewer.Backend.Resources.pricing.json";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public static PricingCatalog LoadEmbedded()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(EmbeddedResourceName)
            ?? throw new InvalidDataException($"Embedded pricing catalog not found: {EmbeddedResourceName}");
        using var reader = new StreamReader(stream);
        return Validate(reader.ReadToEnd());
    }

    public static PricingCatalog Validate(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            throw new InvalidDataException("pricing catalog is empty");
        }

        PricingCatalog catalog;
        try
        {
            catalog = JsonSerializer.Deserialize<PricingCatalog>(json, JsonOptions)
                ?? throw new JsonException("Catalog root is null.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"invalid pricing catalog JSON: {exception.Message}", exception);
        }

        if (catalog.Version == 0)
        {
            throw new InvalidDataException("catalog version must be greater than zero");
        }
        if (string.IsNullOrWhiteSpace(catalog.SourceVersion))
        {
            throw new InvalidDataException("sourceVersion must not be empty");
        }
        if (catalog.Rates is null)
        {
            throw new InvalidDataException("rates must not be null");
        }
        if (catalog.Rates.Count == 0)
        {
            throw new InvalidDataException("rates must not be empty");
        }
        if (catalog.GeneratedAt is null)
        {
            throw new InvalidDataException("generatedAt must not be null");
        }
        ValidateUtc(catalog.GeneratedAt, "generatedAt", maximumFractionDigits: 9);

        var datesByKey = new Dictionary<(string Provider, string Model), List<DateTimeOffset>>();
        for (var index = 0; index < catalog.Rates.Count; index++)
        {
            var rate = catalog.Rates[index];
            if (rate is null)
            {
                throw new InvalidDataException($"rates[{index}] must not be null");
            }
            ValidateRate(rate, index);
            var key = (rate.Provider, rate.Model);
            if (!datesByKey.TryGetValue(key, out var dates))
            {
                dates = [];
                datesByKey.Add(key, dates);
            }
            dates.Add(ParseEffectiveFrom(rate.EffectiveFrom, $"rates[{index}].effectiveFrom"));
        }

        foreach (var ((provider, model), dates) in datesByKey)
        {
            for (var index = 1; index < dates.Count; index++)
            {
                if (dates[index - 1] == dates[index])
                {
                    throw new InvalidDataException(
                        $"duplicate effectiveFrom for provider '{provider}' and model '{model}'");
                }
                if (dates[index - 1] > dates[index])
                {
                    throw new InvalidDataException(
                        $"effectiveFrom dates must be strictly increasing for provider '{provider}' and model '{model}'");
                }
            }
        }

        return catalog;
    }

    private static void ValidateRate(PricingRate rate, int index)
    {
        foreach (var (field, value) in new[]
        {
            ("provider", rate.Provider),
            ("model", rate.Model),
            ("source", rate.Source),
        })
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new InvalidDataException($"rates[{index}].{field} must not be empty");
            }
        }

        foreach (var (field, value) in new[]
        {
            ("input", rate.Input),
            ("output", rate.Output),
            ("cacheRead", rate.CacheRead),
            ("cacheWrite", rate.CacheWrite),
        })
        {
            if (!double.IsFinite(value) || value < 0)
            {
                throw new InvalidDataException($"rates[{index}].{field} must be finite and non-negative");
            }
        }
    }

    private static void ValidateUtc(string? value, string field, int maximumFractionDigits)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidDataException($"{field} must not be empty");
        }

        var match = Rfc3339UtcPattern().Match(value);
        if (!match.Success)
        {
            throw new InvalidDataException($"{field} must be a valid RFC3339 date in UTC");
        }

        var fraction = match.Groups["fraction"].Value;
        if (fraction.Length > maximumFractionDigits)
        {
            throw new InvalidDataException($"{field} must have at most {maximumFractionDigits} fractional second digits");
        }

        var representableFraction = fraction[..Math.Min(fraction.Length, 7)];
        var parseableValue = value[..19]
            + (representableFraction.Length == 0 ? string.Empty : $".{representableFraction}")
            + "Z";
        var format = representableFraction.Length == 0
            ? "yyyy-MM-dd'T'HH:mm:ss'Z'"
            : $"yyyy-MM-dd'T'HH:mm:ss.{new string('f', representableFraction.Length)}'Z'";
        if (!DateTimeOffset.TryParseExact(
                parseableValue,
                format,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out _))
        {
            throw new InvalidDataException($"{field} must be a valid RFC3339 date in UTC");
        }
    }

    private static DateTimeOffset ParseEffectiveFrom(string value, string field)
    {
        ValidateUtc(value, field, maximumFractionDigits: 3);
        var wholeSeconds = DateTime.ParseExact(
            value[..19],
            "yyyy-MM-dd'T'HH:mm:ss",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None);
        var fraction = Rfc3339UtcPattern().Match(value).Groups["fraction"].Value;

        var fractionalTicks = fraction.Length == 0
            ? 0
            : long.Parse(fraction.PadRight(7, '0'), CultureInfo.InvariantCulture);
        return new DateTimeOffset(DateTime.SpecifyKind(wholeSeconds, DateTimeKind.Utc))
            .AddTicks(fractionalTicks);
    }

    [GeneratedRegex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.(?<fraction>\\d+))?Z$", RegexOptions.CultureInvariant)]
    private static partial Regex Rfc3339UtcPattern();
}
