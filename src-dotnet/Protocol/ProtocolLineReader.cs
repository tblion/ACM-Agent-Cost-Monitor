using System.Text;

namespace OpencodeCostsViewer.Backend.Protocol;

internal readonly record struct ProtocolLine(string? Value, bool ExceedsMaximumLength);

internal sealed class ProtocolLineReader(TextReader reader, int maximumCharacterCount)
{
    private readonly char[] _buffer = new char[4096];
    private int _bufferOffset;
    private int _bufferLength;

    public async ValueTask<ProtocolLine?> ReadLineAsync(CancellationToken cancellationToken)
    {
        var line = new StringBuilder(Math.Min(maximumCharacterCount, _buffer.Length));
        var exceedsMaximumLength = false;
        var hasCharacters = false;

        while (true)
        {
            if (_bufferOffset == _bufferLength)
            {
                _bufferLength = await reader.ReadAsync(_buffer.AsMemory(), cancellationToken);
                _bufferOffset = 0;
                if (_bufferLength == 0)
                {
                    if (!hasCharacters)
                    {
                        return null;
                    }

                    return new ProtocolLine(
                        exceedsMaximumLength ? null : line.ToString().TrimEnd('\r'),
                        exceedsMaximumLength);
                }
            }

            var character = _buffer[_bufferOffset++];
            if (character == '\n')
            {
                return new ProtocolLine(
                    exceedsMaximumLength ? null : line.ToString().TrimEnd('\r'),
                    exceedsMaximumLength);
            }

            hasCharacters = true;
            if (!exceedsMaximumLength)
            {
                if (line.Length == maximumCharacterCount)
                {
                    exceedsMaximumLength = true;
                }
                else
                {
                    line.Append(character);
                }
            }
        }
    }
}
