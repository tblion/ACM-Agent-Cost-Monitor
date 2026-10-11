// Reads recent OpenCode V2 usage through its local background service.
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class OpencodeApi
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(15) };

    public static async Task<SourceImportSnapshot> LoadImportSnapshotAsync(
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, long>? sessionWatermarks = null,
        bool fullReimport = false)
    {
        var servicePath = PathResolver.OpenCodeServiceStatePath();
        if (!File.Exists(servicePath))
        {
            throw new IOException("Le service OpenCode local n’est pas découvert (fichier d’état absent).");
        }

        using var service = JsonDocument.Parse(await File.ReadAllTextAsync(servicePath, cancellationToken));
        var root = service.RootElement;
        var baseUrl = ReadString(root, "url");
        var password = ReadString(root, "password");
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var serviceUri))
        {
            throw new InvalidDataException("L’URL du service OpenCode local est invalide.");
        }

        var authorization = string.IsNullOrEmpty(password)
            ? null
            : new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"opencode:{password}")));
        var activeSessions = await LoadSessionsAsync(serviceUri, authorization, cancellationToken, fullReimport);
        var sessions = new List<SourceSessionRow>();
        var messages = new Dictionary<string, SourceMessageRow>(StringComparer.Ordinal);
        var importedWatermarks = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var id in activeSessions)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(id)) continue;
            using var sessionRequest = CreateRequest(serviceUri, $"/api/session/{Uri.EscapeDataString(id)}", authorization);
            using var sessionResponse = await Client.SendAsync(sessionRequest, cancellationToken);
            sessionResponse.EnsureSuccessStatusCode();
            using var sessionDocument = JsonDocument.Parse(await sessionResponse.Content.ReadAsStringAsync(cancellationToken));
            var session = TryGetObject(sessionDocument.RootElement, "data", out var sessionData) ? sessionData : sessionDocument.RootElement;
            var time = TryGetObject(session, "time", out var timeObject) ? timeObject : default;
            var location = TryGetObject(session, "location", out var locationObject) ? locationObject : default;
            sessions.Add(new SourceSessionRow(
                id,
                FirstNonEmpty(ReadString(location, "directory"), ReadString(session, "directory")),
                ReadString(session, "title"),
                NullIfEmpty(ReadString(session, "parentID")),
                ReadLong(time, "created") ?? 0));

            var previousWatermark = 0L;
            var hasPreviousWatermark = !fullReimport
                && sessionWatermarks is not null
                && sessionWatermarks.TryGetValue(id, out previousWatermark);
            long? latestTimestamp = null;
            string? cursor = null;
            var reachedWatermark = false;
            do
            {
                var query = cursor is null
                    ? "?limit=100&order=desc"
                    : $"?limit=100&cursor={Uri.EscapeDataString(cursor)}";
                using var messagesRequest = CreateRequest(serviceUri,
                    $"/api/session/{Uri.EscapeDataString(id)}/message{query}", authorization);
                using var messagesResponse = await Client.SendAsync(messagesRequest, cancellationToken);
                messagesResponse.EnsureSuccessStatusCode();
                using var messagesDocument = JsonDocument.Parse(await messagesResponse.Content.ReadAsStringAsync(cancellationToken));
                var responseData = messagesDocument.RootElement;
                if (responseData.ValueKind == JsonValueKind.Object
                    && responseData.TryGetProperty("data", out var messageData)) responseData = messageData;
                if (responseData.ValueKind != JsonValueKind.Array) break;
                foreach (var info in responseData.EnumerateArray())
                {
                    var messageId = ReadString(info, "id");
                    if (string.IsNullOrWhiteSpace(messageId)) continue;
                    var model = TryGetObject(info, "model", out var modelObject) ? modelObject : default;
                    var created = TryGetObject(info, "time", out var messageTime)
                        ? ReadLong(messageTime, "created")
                        : null;
                    if (created is { } timestamp && (latestTimestamp is null || timestamp > latestTimestamp))
                        latestTimestamp = timestamp;
                    if (hasPreviousWatermark && created is { } messageTimestamp && messageTimestamp < previousWatermark)
                    {
                        reachedWatermark = true;
                        continue;
                    }
                    var role = FirstNonEmpty(ReadString(info, "type"), ReadString(info, "role"));
                    var tokens = ReadTokens(info);
                    messages[messageId] = new SourceMessageRow(
                        messageId,
                        id,
                        role,
                        created,
                        ReadString(model, "providerID"),
                        FirstNonEmpty(ReadString(model, "id"), ReadString(info, "modelID")),
                        tokens is null ? 0 : ReadNumber(info, "cost"),
                        tokens);
                }
                cursor = TryGetObject(messagesDocument.RootElement, "cursor", out var pageCursor)
                    ? ReadString(pageCursor, "next")
                    : string.Empty;
            }
            while (!reachedWatermark && !string.IsNullOrWhiteSpace(cursor));
            if (latestTimestamp is { } importedAt) importedWatermarks[id] = importedAt;
        }

        return new SourceImportSnapshot(sessions, messages.Values.ToArray(), SessionWatermarks: importedWatermarks);
    }

    private static async Task<IReadOnlyList<string>> LoadSessionsAsync(
        Uri serviceUri,
        AuthenticationHeaderValue? authorization,
        CancellationToken cancellationToken,
        bool fullReimport)
    {
        if (!fullReimport)
        {
            using var request = CreateRequest(serviceUri, "/api/session/active", authorization);
            using var response = await Client.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            if (!TryGetObject(document.RootElement, "data", out var activeSessions))
                throw new InvalidDataException("La réponse OpenCode ne contient pas les sessions actives.");
            return activeSessions.EnumerateObject().Select(active => active.Name).ToArray();
        }

        var sessions = new HashSet<string>(StringComparer.Ordinal);
        string? cursor = null;
        do
        {
            var query = cursor is null ? "?limit=100" : $"?limit=100&cursor={Uri.EscapeDataString(cursor)}";
            using var request = CreateRequest(serviceUri, $"/api/session{query}", authorization);
            using var response = await Client.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var data = document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("data", out var wrapped)
                    ? wrapped
                    : document.RootElement;
            if (data.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("La réponse OpenCode ne contient pas une liste de sessions.");
            foreach (var session in data.EnumerateArray())
            {
                var id = ReadString(session, "id");
                if (!string.IsNullOrWhiteSpace(id)) sessions.Add(id);
            }
            cursor = TryGetObject(document.RootElement, "cursor", out var pageCursor)
                ? ReadString(pageCursor, "next")
                : string.Empty;
        }
        while (!string.IsNullOrWhiteSpace(cursor));
        return sessions.ToArray();
    }

    private static HttpRequestMessage CreateRequest(Uri serviceUri, string path, AuthenticationHeaderValue? authorization)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri(serviceUri, path));
        if (authorization is not null) request.Headers.Authorization = authorization;
        return request;
    }

    private static Tokens? ReadTokens(JsonElement value)
    {
        if (!TryGetObject(value, "tokens", out var tokens)
            || !TryGetObject(tokens, "cache", out var cache)
            || !TryGetNumber(tokens, "input", out var input)
            || !TryGetNumber(tokens, "output", out var output)
            || !TryGetNumber(tokens, "reasoning", out var reasoning)
            || !TryGetNumber(cache, "read", out var cacheRead)
            || !TryGetNumber(cache, "write", out var cacheWrite)) return null;
        return new Tokens(input, output, cacheRead, cacheWrite, reasoning);
    }

    private static string ReadString(JsonElement value, string property) =>
        value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(property, out var item)
        && item.ValueKind == JsonValueKind.String
            ? item.GetString() ?? string.Empty
            : string.Empty;

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static string FirstNonEmpty(string first, string second) => string.IsNullOrWhiteSpace(first) ? second : first;

    private static bool TryGetObject(JsonElement value, string property, out JsonElement item)
    {
        item = default;
        return value.ValueKind == JsonValueKind.Object
            && value.TryGetProperty(property, out item)
            && item.ValueKind == JsonValueKind.Object;
    }

    private static long? ReadLong(JsonElement value, string property) =>
        value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(property, out var item)
        && item.TryGetInt64(out var number) ? number : null;

    private static double ReadNumber(JsonElement value, string property) =>
        TryGetNumber(value, property, out var number) ? number : 0;

    private static bool TryGetNumber(JsonElement value, string property, out double number)
    {
        number = 0;
        return value.ValueKind == JsonValueKind.Object
            && value.TryGetProperty(property, out var item)
            && item.TryGetDouble(out number)
            && double.IsFinite(number)
            && number >= 0;
    }
}
