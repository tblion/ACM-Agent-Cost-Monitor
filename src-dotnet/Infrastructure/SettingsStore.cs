using System.Text.Json;
using System.Text.Json.Serialization;
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
                ["dbPath", "configPath", "live", "theme", "language", "defaultPeriodDays", "customGroups"],
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
    }

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
