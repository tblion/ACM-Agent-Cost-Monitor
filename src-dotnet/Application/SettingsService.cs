// Validates and persists backend settings and diagnostics.
using System.ComponentModel;
using OpencodeCostsViewer.Backend.Application;
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class SettingsService
{
    public static Settings LoadForCommands() => SettingsStore.Load(PathResolver.SettingsDirectory());

    public static SettingsStatus LoadForStatus() => SettingsStore.LoadForStatus(PathResolver.SettingsDirectory());

    public static ResolvedPaths ResolvePaths(Settings settings) => PathResolver.Resolve(settings);

    public static void Save(Settings settings)
    {
        try
        {
            SettingsStore.Save(PathResolver.SettingsDirectory(), settings);
        }
        catch (BackendException)
        {
            throw;
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("invalid_input", exception.Message, exception);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new BackendException("settings", $"Écriture des réglages impossible: {exception.Message}", exception);
        }
        catch (Win32Exception exception)
        {
            throw new BackendException("settings", $"Écriture des réglages impossible: {exception.Message}", exception);
        }
    }

    public static void SaveTransactional(Settings next, BackendRuntime runtime)
    {
        var settingsDirectory = PathResolver.SettingsDirectory();
        Settings previous;
        var previousInvalid = false;
        try
        {
            previous = SettingsStore.Load(settingsDirectory);
        }
        catch (BackendException)
        {
            previous = new Settings();
            previousInvalid = true;
        }

        byte[]? previousFile;
        try
        {
            previousFile = SettingsStore.Snapshot(settingsDirectory);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new BackendException("settings", exception.Message, exception);
        }

        try
        {
            SettingsStore.Validate(next);
        }
        catch (InvalidDataException exception)
        {
            throw new BackendException("invalid_input", exception.Message, exception);
        }

        var previousWatcherPath = runtime.Watcher.ActivePath;
        var watcherChanged = previousInvalid
            || previous.Live != next.Live
            || previous.DbPath != next.DbPath
            || (next.Live && previousWatcherPath is null);

        try
        {
            SettingsStore.Save(settingsDirectory, next);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or Win32Exception)
        {
            var saveError = new BackendException("settings", exception.Message, exception);
            try
            {
                SettingsStore.RestoreSnapshot(settingsDirectory, previousFile);
            }
            catch (Exception rollbackException) when (rollbackException is IOException or UnauthorizedAccessException or Win32Exception)
            {
                throw new BackendException("settings",
                    $"{saveError.Message}: restauration des réglages impossible: {rollbackException.Message}", saveError);
            }
            throw saveError;
        }

        if (watcherChanged)
        {
            runtime.WatcherError = null;
            try
            {
                if (next.Live)
                {
                    runtime.Watcher.StartOrRestart(ResolvePaths(next).Db);
                    if (runtime.Watcher.ActivePath is null)
                    {
                        throw new IOException(
                            runtime.WatcherError?.Message ?? "Database watcher did not remain active after startup.");
                    }
                }
                else
                {
                    runtime.Watcher.Stop();
                }
            }
            catch (Exception watcherException) when (BackendRuntime.IsWatcherFailure(watcherException))
            {
                var rollbackErrors = new List<string>();
                try
                {
                    SettingsStore.RestoreSnapshot(settingsDirectory, previousFile);
                }
                catch (Exception fileException) when (fileException is IOException or UnauthorizedAccessException or Win32Exception)
                {
                    rollbackErrors.Add($"restauration des réglages impossible: {fileException.Message}");
                }

                try
                {
                    if (previousWatcherPath is null) runtime.Watcher.Stop();
                    else runtime.Watcher.StartOrRestart(previousWatcherPath);
                }
                catch (Exception watcherRollbackException) when (BackendRuntime.IsWatcherFailure(watcherRollbackException))
                {
                    rollbackErrors.Add($"restauration du watcher impossible: {watcherRollbackException.Message}");
                }

                var context = rollbackErrors.Count == 0 ? string.Empty : $"; {string.Join("; ", rollbackErrors)}";
                var watcherError = new BackendException("watcher", $"{watcherException.Message}{context}", watcherException);
                runtime.WatcherError = new AppError(watcherError.Code, watcherError.Message);
                throw watcherError;
            }
        }

        runtime.SettingsError = null;
        if (!watcherChanged) runtime.WatcherError = null;
    }
}
