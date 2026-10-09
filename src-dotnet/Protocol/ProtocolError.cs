// Defines structured errors returned through the JSON Lines protocol.
namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed record ProtocolError(string Code, string Message);

internal sealed class ProtocolException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
