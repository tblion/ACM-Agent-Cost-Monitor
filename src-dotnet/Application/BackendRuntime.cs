// Composes backend services and manages their runtime lifecycle.
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;
using OpencodeCostsViewer.Backend.Protocol;
using System.ComponentModel;

namespace OpencodeCostsViewer.Backend.Application;

internal sealed class BackendRuntime : IDisposable
{
    public BackendRuntime(ProtocolWriter writer)
    {
        Watcher = new DatabaseWatcher(writer, ReportWatcherFailure);
        var startup = SettingsService.LoadForStatus();
        SettingsError = startup.Diagnostic;
        if (startup.Diagnostic is null && startup.Settings.Live)
        {
            try
            {
                var databasePath = SettingsService.ResolvePaths(startup.Settings).Db;
                Watcher.StartOrRestart(databasePath);
            }
            catch (Exception exception) when (IsWatcherFailure(exception))
            {
                WatcherError = new AppError("watcher", exception.Message);
            }
        }
    }

    public DatabaseWatcher Watcher { get; }
    public AppError? SettingsError { get; set; }
    private AppError? _watcherError;
    public AppError? WatcherError
    {
        get => Volatile.Read(ref _watcherError);
        set => Volatile.Write(ref _watcherError, value);
    }
    public bool LiveActive => Watcher.ActivePath is not null;

    public void Dispose() => Watcher.Dispose();

    private void ReportWatcherFailure(string message) =>
        WatcherError = new AppError("watcher", message);

    internal static bool IsWatcherFailure(Exception exception) =>
        exception is IOException
        or UnauthorizedAccessException
        or ArgumentException
        or InvalidOperationException
        or PlatformNotSupportedException
        or Win32Exception;
}
