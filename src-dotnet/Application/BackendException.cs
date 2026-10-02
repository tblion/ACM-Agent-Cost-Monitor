namespace OpencodeCostsViewer.Backend.Application;

internal sealed class BackendException(string code, string message, Exception? innerException = null)
    : Exception(message, innerException)
{
    public string Code { get; } = code;
}
