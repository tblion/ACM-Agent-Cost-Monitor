// Configures and starts the backend JSON Lines protocol host.
using OpencodeCostsViewer.Backend.Infrastructure;
using OpencodeCostsViewer.Backend.Protocol;
using Serilog;

if (args.Length > 0)
{
    if (args.Length != 2 || args[0] != "--validate-pricing")
    {
        await Console.Error.WriteLineAsync("usage: OpencodeCostsViewer.Backend --validate-pricing <catalog-path>");
        return 2;
    }

    var catalogPath = args[1];
    string catalogJson;
    try
    {
        catalogJson = await File.ReadAllTextAsync(catalogPath);
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
        await Console.Error.WriteLineAsync($"cannot read pricing catalog '{catalogPath}': {exception.Message}");
        return 1;
    }

    try
    {
        PricingCatalogLoader.Validate(catalogJson);
    }
    catch (InvalidDataException exception)
    {
        await Console.Error.WriteLineAsync($"invalid pricing catalog '{catalogPath}': {exception.Message}");
        return 1;
    }

    await Console.Out.WriteLineAsync($"pricing catalog is valid: {catalogPath}");
    return 0;
}

try
{
    SqliteProvider.Initialize();
    var writer = new ProtocolWriter();
    Log.Logger = new LoggerConfiguration()
        .MinimumLevel.Information()
        .WriteTo.Sink(new ProtocolLogSink(writer))
        .CreateLogger();
    Log.Information("Backend host started");
    using var dispatcher = new OperationDispatcher(writer);
    var host = new ProtocolHost(dispatcher, writer);
    await host.RunAsync();
    await Log.CloseAndFlushAsync();
    return 0;
}
catch (OperationCanceledException)
{
    return 0;
}
catch (Exception exception)
{
    Log.Fatal(exception, "Backend terminated unexpectedly");
    await Log.CloseAndFlushAsync();
    return 1;
}
