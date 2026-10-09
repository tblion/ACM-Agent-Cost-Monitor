// Resolves OpenCode data, configuration, and application settings paths.
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class PathResolver
{
    public static ResolvedPaths Resolve(Settings settings) => new(
        settings.DbPath ?? DefaultDatabasePath(),
        ResolveConfigPath(settings.ConfigPath));

    public static string DefaultDatabasePath() => Path.Combine(
        GetXdgBaseDirectory("XDG_DATA_HOME", ".local", "share"),
        "opencode",
        "opencode.db");

    public static string DefaultConfigPath() => Path.Combine(
        GetXdgBaseDirectory("XDG_CONFIG_HOME", ".config"),
        "opencode",
        "opencode.jsonc");

    public static string ResolveConfigPath(string? customPath)
    {
        var baseDirectory = GetXdgBaseDirectory("XDG_CONFIG_HOME", ".config");
        var jsoncPath = Path.Combine(baseDirectory, "opencode", "opencode.jsonc");
        var jsonPath = Path.Combine(baseDirectory, "opencode", "opencode.json");
        if (!string.IsNullOrEmpty(customPath) && File.Exists(customPath))
        {
            return customPath;
        }
        if (File.Exists(jsoncPath))
        {
            return jsoncPath;
        }
        if (File.Exists(jsonPath))
        {
            return jsonPath;
        }
        return jsoncPath;
    }

    public static string SettingsDirectory()
    {
        var configured = Environment.GetEnvironmentVariable("OPENCODE_COSTS_VIEWER_SETTINGS_DIR");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        return Path.Combine(GetXdgBaseDirectory("XDG_CONFIG_HOME", ".config"), "opencode-costs-viewer");
    }

    private static string GetXdgBaseDirectory(string variable, params string[] fallbackParts)
    {
        var configured = Environment.GetEnvironmentVariable(variable);
        if (!string.IsNullOrEmpty(configured))
        {
            return configured;
        }

        var home = Environment.GetEnvironmentVariable("HOME");
        if (string.IsNullOrEmpty(home))
        {
            home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
        if (string.IsNullOrEmpty(home))
        {
            throw new InvalidOperationException("Could not resolve the user's home directory.");
        }

        return fallbackParts.Aggregate(home, Path.Combine);
    }
}
