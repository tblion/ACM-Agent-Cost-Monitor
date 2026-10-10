// Composes backend services and manages their runtime lifecycle.
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Models;
using OpencodeCostsViewer.Backend.Protocol;
using System.ComponentModel;

namespace OpencodeCostsViewer.Backend.Application;

internal sealed class BackendRuntime : IDisposable
{
    private CancellationTokenSource? _apiPollingCancellation;
    private Task? _apiPollingTask;

    public BackendRuntime(ProtocolWriter writer)
    {
        Watcher = new DatabaseWatcher(writer, ReportWatcherFailure);
        var startup = SettingsService.LoadForStatus();
        SettingsError = startup.Diagnostic;
        if (startup.Diagnostic is null && startup.Settings.Live)
        {
            StartApiPolling();
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

    public bool ApiPollingActive => _apiPollingTask is { IsCompleted: false };

    public void StartApiPolling()
    {
        if (ApiPollingActive) return;
        _apiPollingCancellation?.Dispose();
        _apiPollingCancellation = new CancellationTokenSource();
        _apiPollingTask = PollOpenCodeApiAsync(_apiPollingCancellation.Token);
    }

    public void StopApiPolling()
    {
        _apiPollingCancellation?.Cancel();
        _apiPollingTask = null;
        _apiPollingCancellation?.Dispose();
        _apiPollingCancellation = null;
    }

    public void Dispose()
    {
        StopApiPolling();
        Watcher.Dispose();
    }

    private static async Task PollOpenCodeApiAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await UsageImportService.SyncOpenCodeApiAsync(cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (BackendException exception)
            {
                // L’échec de l’API reste isolé du watcher de la base.
                Serilog.Log.Warning(exception, "OpenCode API polling failed");
            }

            try
            {
                if (!await timer.WaitForNextTickAsync(cancellationToken)) return;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
        }
    }

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
