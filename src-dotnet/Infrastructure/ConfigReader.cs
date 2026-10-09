// Reads OpenCode configuration and extracts supported pricing settings.
using System.Text.Json;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class ConfigReader
{
    public static Dictionary<(string Provider, string Model), Rate> ExtractRates(string configText)
    {
        using var document = JsonDocument.Parse(JsoncReader.Normalize(configText));
        var rates = new Dictionary<(string Provider, string Model), Rate>();
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("provider", out var providers)
            || providers.ValueKind != JsonValueKind.Object)
        {
            return rates;
        }

        foreach (var provider in providers.EnumerateObject())
        {
            if (provider.Value.ValueKind != JsonValueKind.Object
                || !provider.Value.TryGetProperty("models", out var models)
                || models.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            foreach (var model in models.EnumerateObject())
            {
                if (model.Value.ValueKind != JsonValueKind.Object
                    || !model.Value.TryGetProperty("cost", out var costValue))
                {
                    continue;
                }

                if (costValue.ValueKind != JsonValueKind.Object)
                {
                    throw new InvalidDataException($"Tarif {provider.Name}/{model.Name}: le champ cost doit être un objet");
                }

                rates[(provider.Name, model.Name)] = new Rate(
                    ParseRateField(costValue, provider.Name, model.Name, "input"),
                    ParseRateField(costValue, provider.Name, model.Name, "output"),
                    ParseRateField(costValue, provider.Name, model.Name, "cache_read"),
                    ParseRateField(costValue, provider.Name, model.Name, "cache_write"));
            }
        }

        return rates;
    }

    public static Dictionary<(string Provider, string Model), Rate> LoadRates(string path)
    {
        string contents;
        try
        {
            contents = File.ReadAllText(path);
        }
        catch (FileNotFoundException)
        {
            return [];
        }
        catch (DirectoryNotFoundException)
        {
            return [];
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new IOException($"Lecture de la configuration impossible: {exception.Message}", exception);
        }

        try
        {
            return ExtractRates(contents);
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException)
        {
            throw new InvalidDataException($"Configuration invalide dans {path}: {exception.Message}", exception);
        }
    }

    public static Dictionary<(string Provider, string Model), Rate> LoadRatesStrict(string path)
    {
        string contents;
        try
        {
            contents = File.ReadAllText(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new IOException($"Lecture de la configuration impossible: {exception.Message}", exception);
        }

        return ExtractRates(contents);
    }

    private static double ParseRateField(JsonElement cost, string provider, string model, string field)
    {
        if (!cost.TryGetProperty(field, out var value))
        {
            return 0;
        }

        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number))
        {
            throw new InvalidDataException($"Tarif {provider}/{model}: le champ {field} doit être un nombre");
        }
        if (!double.IsFinite(number) || number < 0)
        {
            throw new InvalidDataException($"Tarif {provider}/{model}: le champ {field} doit être un nombre fini positif ou nul");
        }
        return number;
    }
}
