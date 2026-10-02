using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpencodeCostsViewer.Backend.Protocol;

internal sealed record ProtocolRequest(
    string? Id,
    string? Operation,
    JsonElement Arguments,
    int ProtocolVersion);

internal sealed record ProtocolEvent(string Event, JsonElement Payload);

internal sealed class ProtocolResponse
{
    public required string Id { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonElement? Result { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ProtocolError? Error { get; init; }
}

internal static class ProtocolJson
{
    public static JsonSerializerOptions Options { get; } = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = false,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
