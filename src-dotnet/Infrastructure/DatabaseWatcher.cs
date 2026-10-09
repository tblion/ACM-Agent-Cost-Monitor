// Watches the OpenCode database for changes and emits debounced notifications.
using System.Threading.Channels;
using OpencodeCostsViewer.Backend.Protocol;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal sealed class DatabaseWatcher(ProtocolWriter writer, Action<string> onError) : IDisposable
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);
    private static readonly TimeSpan DebounceInterval = TimeSpan.FromMilliseconds(1000);
    private readonly object _sync = new();
    private WatchHandle? _active;

    public string? ActivePath
    {
        get
        {
            lock (_sync)
            {
                return _active is { Worker.IsCompleted: false } ? _active.Path : null;
            }
        }
    }

    public void StartOrRestart(string databasePath)
    {
        var fullPath = Path.GetFullPath(databasePath);
        if (!File.Exists(fullPath))
        {
            throw new IOException($"DB introuvable pour le watcher: {fullPath}");
        }

        var directory = Path.GetDirectoryName(fullPath)
            ?? throw new IOException("Impossible de déterminer le dossier de la base pour le watcher.");
        var filename = Path.GetFileName(fullPath);
        Stop();
        FileSystemWatcher? watcher = null;
        WatchHandle? handle = null;
        try
        {
            var channel = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
            {
                FullMode = BoundedChannelFullMode.DropWrite,
                SingleReader = true,
                SingleWriter = false,
            });
            watcher = new FileSystemWatcher(directory, filename)
            {
                IncludeSubdirectories = false,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                EnableRaisingEvents = false,
            };
            handle = new WatchHandle(fullPath, watcher, channel, new CancellationTokenSource());
            var activeHandle = handle;
            watcher.Changed += (_, args) => SignalIfTarget(activeHandle, args.FullPath);
            watcher.Created += (_, args) => SignalIfTarget(activeHandle, args.FullPath);
            watcher.Deleted += (_, args) => SignalIfTarget(activeHandle, args.FullPath);
            watcher.Renamed += (_, args) =>
            {
                SignalIfTarget(activeHandle, args.OldFullPath);
                SignalIfTarget(activeHandle, args.FullPath);
            };
            watcher.Error += (_, args) =>
            {
                ReportFailure(activeHandle, args.GetException());
            };

            lock (_sync) _active = handle;
            handle.Worker = Task.Run(() => RunAsync(handle));
            watcher.EnableRaisingEvents = true;
            if (handle.Failure is { } failure)
            {
                throw new IOException($"Database watcher failed to start: {failure}");
            }
        }
        catch
        {
            if (handle is not null)
            {
                StopHandle(handle);
            }
            else if (watcher is not null)
            {
                try
                {
                    watcher.Dispose();
                }
                catch (Exception)
                {
                }
            }

            throw;
        }
    }

    public void Stop()
    {
        WatchHandle? handle;
        lock (_sync)
        {
            handle = _active;
            _active = null;
        }
        if (handle is null) return;

        StopHandle(handle);
    }

    private void StopHandle(WatchHandle handle)
    {
        lock (_sync)
        {
            if (ReferenceEquals(_active, handle)) _active = null;
        }
        if (Interlocked.Exchange(ref handle.Stopping, 1) != 0) return;

        CancelSafely(handle.Cancellation);
        try
        {
            handle.Watcher.EnableRaisingEvents = false;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Database watcher shutdown: {exception.Message}");
        }
        finally
        {
            try
            {
                handle.Watcher.Dispose();
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"Database watcher dispose failed: {exception.Message}");
            }
        }
        try
        {
            handle.Worker.GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Database watcher worker shutdown: {exception.Message}");
        }
        finally
        {
            handle.Cancellation.Dispose();
        }
    }

    public void Dispose() => Stop();

    private static void CancelSafely(CancellationTokenSource cancellation)
    {
        try
        {
            cancellation.Cancel();
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Database watcher cancellation failed: {exception.Message}");
        }
    }

    private void ReportFailure(WatchHandle handle, Exception exception)
    {
        if (!handle.TrySetFailure(exception.Message)) return;
        try
        {
            onError(exception.Message);
        }
        catch (Exception callbackException)
        {
            Console.Error.WriteLine($"Database watcher error callback failed: {callbackException.Message}");
        }
        CancelSafely(handle.Cancellation);
        _ = Task.Run(() => StopHandle(handle));
    }

    private void SignalIfTarget(WatchHandle handle, string path)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (string.Equals(Path.GetFullPath(path), handle.Path, comparison))
        {
            handle.Changes.Writer.TryWrite(true);
        }
    }

    private async Task RunAsync(WatchHandle handle)
    {
        using var timer = new PeriodicTimer(PollInterval);
        DateTimeOffset? lastEvent = null;
        try
        {
            while (await timer.WaitForNextTickAsync(handle.Cancellation.Token))
            {
                while (handle.Changes.Reader.TryRead(out _)) lastEvent = DateTimeOffset.UtcNow;
                if (lastEvent is null || DateTimeOffset.UtcNow - lastEvent.Value < DebounceInterval) continue;

                lastEvent = null;
                await writer.WriteEventAsync("db-changed", null, handle.Cancellation.Token);
            }
        }
        catch (OperationCanceledException) when (handle.Cancellation.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            await Console.Error.WriteLineAsync($"Watcher event delivery failed: {exception.Message}");
            ReportFailure(handle, exception);
        }
    }

    private sealed class WatchHandle(
        string path,
        FileSystemWatcher watcher,
        Channel<bool> changes,
        CancellationTokenSource cancellation)
    {
        public string Path { get; } = path;
        public FileSystemWatcher Watcher { get; } = watcher;
        public Channel<bool> Changes { get; } = changes;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public Task Worker { get; set; } = Task.CompletedTask;
        public int Stopping;
        private string? _failure;
        public string? Failure => Volatile.Read(ref _failure);

        public bool TrySetFailure(string message) =>
            Interlocked.CompareExchange(ref _failure, message, null) is null;
    }
}
