// Reads and writes application settings in the resolved settings directory.
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;
using OpencodeCostsViewer.Backend.Application;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true,
    };

    public static Settings Load(string settingsDirectory)
    {
        var path = Path.Combine(settingsDirectory, "settings.json");
        string contents;
        try
        {
            contents = File.ReadAllText(path);
        }
        catch (FileNotFoundException)
        {
            return new Settings();
        }
        catch (DirectoryNotFoundException)
        {
            return new Settings();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new BackendException("configuration", $"Erreur de configuration: lecture de {path}: {exception.Message}", exception);
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(contents);
        }
        catch (JsonException exception)
        {
            throw new BackendException("configuration", $"Erreur de configuration: JSON invalide dans {path}: {exception.Message}", exception);
        }

        Settings settings;
        using (document)
        {
            try
            {
                settings = JsonSerializer.Deserialize<Settings>(document.RootElement.GetRawText(), JsonOptions)
                    ?? throw new JsonException("L'objet racine est invalide.");
            }
            catch (JsonException exception)
            {
                throw new BackendException("settings", $"Erreur de validation des réglages dans {path}: {exception.Message}", exception);
            }
        }

        try
        {
            Validate(settings);
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("settings", $"Erreur de validation des réglages dans {path}: {exception.Message}", exception);
        }

        return settings;
    }

    public static SettingsStatus LoadForStatus(string settingsDirectory)
    {
        var path = Path.Combine(settingsDirectory, "settings.json");
        string contents;
        try
        {
            contents = File.ReadAllText(path);
        }
        catch (FileNotFoundException)
        {
            return new SettingsStatus(new Settings(), null);
        }
        catch (DirectoryNotFoundException)
        {
            return new SettingsStatus(new Settings(), null);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return new SettingsStatus(
                new Settings(),
                new AppError("configuration", $"Erreur de configuration: lecture de {path}: {exception.Message}"));
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(contents);
        }
        catch (JsonException exception)
        {
            return new SettingsStatus(
                new Settings(),
                new AppError("configuration", $"Erreur de configuration: JSON invalide dans {path}: {exception.Message}"));
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return new SettingsStatus(
                    new Settings(),
                    new AppError("settings", "Erreur de validation des réglages: l'objet racine est invalide"));
            }

            var settings = new Settings();
            var invalidFields = new SortedSet<string>(StringComparer.Ordinal);
            var root = document.RootElement;
            var knownFields = new HashSet<string>(
                ["dbPath", "configPath", "live", "theme", "language", "defaultPeriodDays", "customGroups", "customRates", "fixedSubscriptions"],
                StringComparer.Ordinal);

            foreach (var property in root.EnumerateObject())
            {
                if (!knownFields.Contains(property.Name)) invalidFields.Add(property.Name);
            }

            if (root.TryGetProperty("dbPath", out var dbPath))
            {
                if (dbPath.ValueKind == JsonValueKind.Null) settings = settings with { DbPath = null };
                else if (dbPath.ValueKind == JsonValueKind.String) settings = settings with { DbPath = dbPath.GetString() };
                else invalidFields.Add("dbPath");
            }
            if (root.TryGetProperty("configPath", out var configPath))
            {
                if (configPath.ValueKind == JsonValueKind.Null) settings = settings with { ConfigPath = null };
                else if (configPath.ValueKind == JsonValueKind.String) settings = settings with { ConfigPath = configPath.GetString() };
                else invalidFields.Add("configPath");
            }
            if (root.TryGetProperty("live", out var live))
            {
                if (live.ValueKind is JsonValueKind.True or JsonValueKind.False) settings = settings with { Live = live.GetBoolean() };
                else invalidFields.Add("live");
            }
            if (root.TryGetProperty("theme", out var theme))
            {
                if (theme.ValueKind == JsonValueKind.String
                    && theme.GetString() is { } themeName
                    && themeName is "system" or "light" or "dark")
                {
                    settings = settings with { Theme = themeName };
                }
                else invalidFields.Add("theme");
            }
            if (root.TryGetProperty("language", out var language))
            {
                if (language.ValueKind == JsonValueKind.Null)
                {
                    settings = settings with { Language = null };
                }
                else if (language.ValueKind == JsonValueKind.String
                    && language.GetString() is { } languageName
                    && languageName is "fr" or "en")
                {
                    settings = settings with { Language = languageName };
                }
                else invalidFields.Add("language");
            }
            if (root.TryGetProperty("defaultPeriodDays", out var period))
            {
                if (period.TryGetInt64(out var days) && days is >= 1 and <= 3650)
                {
                    settings = settings with { DefaultPeriodDays = days };
                }
                else invalidFields.Add("defaultPeriodDays");
            }
            if (root.TryGetProperty("customGroups", out var customGroups))
            {
                if (customGroups.ValueKind != JsonValueKind.Array)
                {
                    invalidFields.Add("customGroups");
                }
                else
                {
                    var groups = new List<CustomGroup>();
                    foreach (var group in customGroups.EnumerateArray())
                    {
                        if (group.ValueKind != JsonValueKind.Object)
                        {
                            invalidFields.Add("customGroups");
                            continue;
                        }

                        if (group.EnumerateObject().Any(property => property.Name is not ("name" or "projects")))
                        {
                            invalidFields.Add("customGroups");
                        }

                        if (!group.TryGetProperty("name", out var name)
                            || name.ValueKind != JsonValueKind.String
                            || !group.TryGetProperty("projects", out var projects)
                            || projects.ValueKind != JsonValueKind.Array)
                        {
                            invalidFields.Add("customGroups");
                            continue;
                        }

                        var projectNames = new List<string>();
                        var groupValid = !string.IsNullOrWhiteSpace(name.GetString());
                        foreach (var project in projects.EnumerateArray())
                        {
                            if (project.ValueKind != JsonValueKind.String
                                || string.IsNullOrWhiteSpace(project.GetString()))
                            {
                                groupValid = false;
                                continue;
                            }
                            projectNames.Add(project.GetString()!);
                        }

                        if (groupValid)
                        {
                            groups.Add(new CustomGroup { Name = name.GetString()!, Projects = projectNames });
                        }
                        else invalidFields.Add("customGroups");
                    }
                    settings = settings with { CustomGroups = groups };
                }
            }

            if (root.TryGetProperty("customRates", out var customRates))
            {
                if (customRates.ValueKind != JsonValueKind.Array)
                {
                    invalidFields.Add("customRates");
                }
                else
                {
                    try
                    {
                        var rates = JsonSerializer.Deserialize<List<ConfiguredRateVersion>>(
                            customRates.GetRawText(), JsonOptions);
                        if (rates is null)
                        {
                            invalidFields.Add("customRates");
                        }
                        else
                        {
                            settings = settings with { CustomRates = rates };
                        }
                    }
                    catch (JsonException)
                    {
                        invalidFields.Add("customRates");
                    }
                }
            }

            if (root.TryGetProperty("fixedSubscriptions", out var fixedSubscriptions))
            {
                if (fixedSubscriptions.ValueKind != JsonValueKind.Array)
                {
                    invalidFields.Add("fixedSubscriptions");
                }
                else
                {
                    var subscriptions = new List<FixedSubscription>();
                    foreach (var subscription in fixedSubscriptions.EnumerateArray())
                    {
                        if (subscription.ValueKind != JsonValueKind.Object
                            || subscription.EnumerateObject().Any(property => property.Name is not ("id" or "provider" or "amount" or "period" or "models" or "effectiveFrom" or "effectiveTo"))
                            || (subscription.TryGetProperty("id", out var existingId)
                                && (existingId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(existingId.GetString())))
                            || !subscription.TryGetProperty("provider", out var provider)
                            || provider.ValueKind != JsonValueKind.String
                            || string.IsNullOrWhiteSpace(provider.GetString())
                            || !subscription.TryGetProperty("amount", out var amount)
                            || !amount.TryGetDouble(out var amountValue)
                            || !double.IsFinite(amountValue)
                            || amountValue <= 0
                            || !subscription.TryGetProperty("period", out var subscriptionPeriod)
                            || subscriptionPeriod.ValueKind != JsonValueKind.String
                            || subscriptionPeriod.GetString() is not ("monthly" or "annual")
                            || !subscription.TryGetProperty("models", out var models)
                            || models.ValueKind != JsonValueKind.Array
                            || !subscription.TryGetProperty("effectiveFrom", out var effectiveFrom)
                            || effectiveFrom.ValueKind != JsonValueKind.String
                            || !IsValidDate(effectiveFrom.GetString())
                            || !subscription.TryGetProperty("effectiveTo", out var effectiveTo)
                            || (effectiveTo.ValueKind != JsonValueKind.Null
                                && (effectiveTo.ValueKind != JsonValueKind.String || !IsValidDate(effectiveTo.GetString()))))
                        {
                            invalidFields.Add("fixedSubscriptions");
                            continue;
                        }

                        var modelNames = new List<string>();
                        var modelsValid = true;
                        foreach (var model in models.EnumerateArray())
                        {
                            if (model.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(model.GetString()))
                            {
                                modelsValid = false;
                                continue;
                            }
                            modelNames.Add(model.GetString()!);
                        }

                        var startDate = DateOnly.ParseExact(effectiveFrom.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
                        var endDate = effectiveTo.ValueKind == JsonValueKind.String
                            ? DateOnly.ParseExact(effectiveTo.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture)
                            : (DateOnly?)null;
                        if (!modelsValid || (endDate is { } end && end < startDate))
                        {
                            invalidFields.Add("fixedSubscriptions");
                            continue;
                        }

                        subscriptions.Add(new FixedSubscription
                        {
                            Id = subscription.TryGetProperty("id", out var subscriptionId)
                                && subscriptionId.ValueKind == JsonValueKind.String
                                && !string.IsNullOrWhiteSpace(subscriptionId.GetString())
                                    ? subscriptionId.GetString()!
                                    : Guid.NewGuid().ToString("N"),
                            Provider = provider.GetString()!,
                            Amount = amountValue,
                            Period = subscriptionPeriod.GetString()!,
                            Models = modelNames,
                            EffectiveFrom = effectiveFrom.GetString()!,
                            EffectiveTo = endDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        });
                    }
                    settings = settings with { FixedSubscriptions = subscriptions };
                    if (subscriptions.Select(subscription => subscription.Id).Distinct(StringComparer.Ordinal).Count() != subscriptions.Count)
                    {
                        invalidFields.Add("fixedSubscriptions");
                    }
                }
            }

            if (!AreValidCustomRates(settings.CustomRates)) invalidFields.Add("customRates");

            var diagnostic = invalidFields.Count == 0
                ? null
                : new AppError("settings", $"Erreur de validation des réglages: champs invalides: {string.Join(", ", invalidFields)}");
            return new SettingsStatus(settings, diagnostic);
        }
    }

    public static void Save(string settingsDirectory, Settings settings)
    {
        Validate(settings);
        var contents = JsonSerializer.SerializeToUtf8Bytes(settings, JsonOptions);
        WriteAtomic(settingsDirectory, contents);
    }

    public static byte[]? Snapshot(string settingsDirectory)
    {
        var path = Path.Combine(settingsDirectory, "settings.json");
        try
        {
            return File.ReadAllBytes(path);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
    }

    public static void RestoreSnapshot(string settingsDirectory, byte[]? contents)
    {
        var path = Path.Combine(settingsDirectory, "settings.json");
        if (contents is not null)
        {
            WriteAtomic(settingsDirectory, contents);
        }
        else if (File.Exists(path))
        {
            File.Delete(path);
            AtomicFileOperations.SyncDirectory(settingsDirectory);
        }
    }

    public static void Validate(Settings settings)
    {
        if (settings.Theme is not ("system" or "light" or "dark"))
        {
            throw new InvalidDataException($"Erreur de validation des réglages: thème inconnu: {settings.Theme}");
        }
        if (settings.Language is not null && settings.Language is not ("fr" or "en"))
        {
            throw new InvalidDataException($"Erreur de validation des réglages: langue inconnue: {settings.Language}");
        }
        if (settings.DefaultPeriodDays is < 1 or > 3650)
        {
            throw new InvalidDataException("Erreur de validation des réglages: defaultPeriodDays doit être compris entre 1 et 3650");
        }
        if (settings.CustomGroups is null
            || settings.CustomGroups.Any(group => group is null
                || string.IsNullOrWhiteSpace(group.Name)
                || group.Projects is null
                || group.Projects.Any(string.IsNullOrWhiteSpace)))
        {
            throw new InvalidDataException("Erreur de validation des réglages: groupe personnalisé invalide");
        }
        if (settings.FixedSubscriptions is null
            || settings.FixedSubscriptions.Any(subscription => subscription is null
                || string.IsNullOrWhiteSpace(subscription.Id)
                || string.IsNullOrWhiteSpace(subscription.Provider)
                || !double.IsFinite(subscription.Amount)
                || subscription.Amount <= 0
                || subscription.Period is not ("monthly" or "annual")
                || subscription.Models is null
                || subscription.Models.Any(string.IsNullOrWhiteSpace)
                || !IsValidDate(subscription.EffectiveFrom)
                || (subscription.EffectiveTo is not null && !IsValidDate(subscription.EffectiveTo))
                || (subscription.EffectiveTo is { } end && DateOnly.ParseExact(end, "yyyy-MM-dd", CultureInfo.InvariantCulture)
                    < DateOnly.ParseExact(subscription.EffectiveFrom, "yyyy-MM-dd", CultureInfo.InvariantCulture))))
        {
            throw new InvalidDataException("Erreur de validation des réglages: forfait fixe invalide");
        }
        if (settings.FixedSubscriptions.Select(subscription => subscription.Id).Distinct(StringComparer.Ordinal).Count()
            != settings.FixedSubscriptions.Count)
        {
            throw new InvalidDataException("Erreur de validation des réglages: identifiant de forfait fixe dupliqué");
        }
        if (!AreValidCustomRates(settings.CustomRates))
        {
            throw new InvalidDataException("Erreur de validation des réglages: tarif personnalisé invalide");
        }
    }

    private static bool AreValidCustomRates(IReadOnlyList<ConfiguredRateVersion>? rates)
    {
        if (rates is null || rates.Any(rate => rate is null
            || string.IsNullOrWhiteSpace(rate.Id)
            || string.IsNullOrWhiteSpace(rate.Provider)
            || string.IsNullOrWhiteSpace(rate.Model)
            || !new Rate(rate.Input, rate.Output, rate.CacheRead, rate.CacheWrite).IsValid
            || !IsValidUtcTimestamp(rate.EffectiveFrom)
            || string.IsNullOrWhiteSpace(rate.Source)))
        {
            return false;
        }

        if (rates.Select(rate => rate.Id).Distinct(StringComparer.Ordinal).Count() != rates.Count) return false;
        var versions = new HashSet<(string Provider, string Model, long EffectiveTicks)>();
        return rates.All(rate => versions.Add((rate.Provider, rate.Model,
            DateTimeOffset.ParseExact(rate.EffectiveFrom, UtcTimestampFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal).UtcTicks)));
    }

    private static readonly string[] UtcTimestampFormats =
    [
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'",
    ];

    private static bool IsValidUtcTimestamp(string? value) => value is not null
        && DateTimeOffset.TryParseExact(value, UtcTimestampFormats, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out _);

    private static bool IsValidDate(string? value) => value is not null
        && DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static void WriteAtomic(string settingsDirectory, byte[] contents)
    {
        Directory.CreateDirectory(settingsDirectory);
        var targetPath = Path.Combine(settingsDirectory, "settings.json");
        var temporaryPath = Path.Combine(settingsDirectory, $".settings.json.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                4096,
                FileOptions.WriteThrough))
            {
                stream.Write(contents);
                stream.Flush(flushToDisk: true);
            }
            AtomicFileOperations.Replace(temporaryPath, targetPath);
            AtomicFileOperations.SyncDirectory(settingsDirectory);
        }
        finally
        {
            try
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
