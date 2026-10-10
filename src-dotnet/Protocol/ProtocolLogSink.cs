// Forwards structured Serilog events through the backend JSON Lines protocol.
using System.Globalization;
using Serilog.Core;
using Serilog.Events;

namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed record BackendLogEntry(string Timestamp, string Level, string Message, string? Exception);

internal sealed class ProtocolLogSink(ProtocolWriter writer) : ILogEventSink
{
    public void Emit(LogEvent logEvent)
    {
        var entry = new BackendLogEntry(
            logEvent.Timestamp.ToString("O", CultureInfo.InvariantCulture),
            logEvent.Level.ToString(),
            logEvent.RenderMessage(CultureInfo.InvariantCulture),
            logEvent.Exception?.ToString());
        try
        {
            writer.WriteEventAsync("backend-log", entry, CancellationToken.None).GetAwaiter().GetResult();
        }
        catch (Exception exception) when (exception is IOException or ObjectDisposedException or InvalidOperationException)
        {
            Console.Error.WriteLine($"Serilog protocol sink failed: {exception.Message}");
        }
    }
}
