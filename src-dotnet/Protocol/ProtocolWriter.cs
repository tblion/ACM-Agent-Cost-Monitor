// Serializes protocol responses and events to the output stream.
using System.Text.Json;

namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed class ProtocolWriter
{
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public Task WriteSuccessAsync(string id, object? result, CancellationToken cancellationToken) =>
        WriteAsync(new ProtocolResponse
        {
            Id = id,
            Result = JsonSerializer.SerializeToElement(result, ProtocolJson.Options),
        }, cancellationToken);

    public Task WriteFailureAsync(string id, ProtocolError error, CancellationToken cancellationToken) =>
        WriteAsync(new ProtocolResponse
        {
            Id = id,
            Error = error,
        }, cancellationToken);

    public Task WriteEventAsync(string eventName, object? payload, CancellationToken cancellationToken) =>
        WriteAsync(new ProtocolEvent(
            eventName,
            JsonSerializer.SerializeToElement(payload, ProtocolJson.Options)), cancellationToken);

    private async Task WriteAsync<T>(T message, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(message, ProtocolJson.Options);
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await Console.Out.WriteLineAsync(json);
            await Console.Out.FlushAsync(cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }
}
