// Represents an application error with a protocol-safe error code.
namespace OpencodeCostsViewer.Backend.Application;

internal sealed class BackendException(string code, string message, Exception? innerException = null)
    : Exception(message, innerException)
{
    public string Code { get; } = code;
}
