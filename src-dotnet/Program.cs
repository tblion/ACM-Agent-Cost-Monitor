using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Protocol;

try
{
    SqliteProvider.Initialize();
    var writer = new ProtocolWriter();
    using var dispatcher = new OperationDispatcher(writer);
    var host = new ProtocolHost(dispatcher, writer);
    await host.RunAsync();
    return 0;
}
catch (OperationCanceledException)
{
    return 0;
}
catch (Exception exception)
{
    await Console.Error.WriteLineAsync($"Backend terminated: {exception.Message}");
    return 1;
}
