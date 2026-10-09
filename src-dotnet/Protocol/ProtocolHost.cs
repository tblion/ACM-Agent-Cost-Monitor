// Runs the backend request loop and publishes asynchronous events.
using System.Text.Json;

namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed class ProtocolHost(OperationDispatcher dispatcher, ProtocolWriter writer)
{
    public const int CurrentProtocolVersion = 1;
    private const int MaximumMessageCharacterCount = 8 * 1024 * 1024;
    private readonly ProtocolWriter _writer = writer;
    private readonly ProtocolLineReader _lineReader = new(Console.In, MaximumMessageCharacterCount);

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var input = await _lineReader.ReadLineAsync(cancellationToken);
            if (input is null)
            {
                return;
            }

            if (input.Value.ExceedsMaximumLength)
            {
                await _writer.WriteFailureAsync(
                    string.Empty,
                    new ProtocolError("invalid_input", "Protocol message exceeds the maximum character count."),
                    cancellationToken);
                continue;
            }

            var line = input.Value.Value!;
            ProtocolRequest request;
            try
            {
                request = JsonSerializer.Deserialize<ProtocolRequest>(line, ProtocolJson.Options)
                    ?? throw new JsonException("Protocol request is null.");
            }
            catch (JsonException exception)
            {
                await Console.Error.WriteLineAsync($"Invalid protocol request: {exception.Message}");
                await _writer.WriteFailureAsync(
                    string.Empty,
                    new ProtocolError("invalid_input", "Protocol request is not valid JSON."),
                    cancellationToken);
                continue;
            }

            if (string.IsNullOrWhiteSpace(request.Id))
            {
                await _writer.WriteFailureAsync(
                    string.Empty,
                    new ProtocolError("invalid_input", "Protocol request id is required."),
                    cancellationToken);
                continue;
            }

            if (request.ProtocolVersion != CurrentProtocolVersion)
            {
                await _writer.WriteFailureAsync(
                    request.Id,
                    new ProtocolError("invalid_input", $"Unsupported protocol version: {request.ProtocolVersion}."),
                    cancellationToken);
                continue;
            }

            if (string.IsNullOrWhiteSpace(request.Operation) || request.Arguments.ValueKind != JsonValueKind.Object)
            {
                await _writer.WriteFailureAsync(
                    request.Id,
                    new ProtocolError("invalid_input", "Protocol operation and object arguments are required."),
                    cancellationToken);
                continue;
            }

            try
            {
                var result = await dispatcher.DispatchAsync(
                    request.Operation,
                    request.Arguments,
                    cancellationToken);
                await _writer.WriteSuccessAsync(request.Id, result, cancellationToken);
            }
            catch (ProtocolException exception)
            {
                await _writer.WriteFailureAsync(
                    request.Id,
                    new ProtocolError(exception.Code, exception.Message),
                    cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                await Console.Error.WriteLineAsync($"Operation {request.Operation} failed: {exception}");
                await _writer.WriteFailureAsync(
                    request.Id,
                    new ProtocolError("invalid_input", "The requested operation failed."),
                    cancellationToken);
            }
        }
    }
}
