using System.Text;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class JsoncReader
{
    public static string Normalize(string text) => StripTrailingCommas(StripComments(text));

    public static string StripComments(string text)
    {
        var output = new StringBuilder(text.Length);
        var inString = false;
        var inLineComment = false;
        var inBlockComment = false;

        for (var index = 0; index < text.Length;)
        {
            var character = text[index];
            var next = index + 1 < text.Length ? text[index + 1] : '\0';

            if (inLineComment)
            {
                if (character == '\n')
                {
                    inLineComment = false;
                    output.Append(character);
                }
                index++;
            }
            else if (inBlockComment)
            {
                if (character == '*' && next == '/')
                {
                    inBlockComment = false;
                    index += 2;
                }
                else
                {
                    index++;
                }
            }
            else if (inString)
            {
                output.Append(character);
                if (character == '\\' && index + 1 < text.Length)
                {
                    output.Append(text[index + 1]);
                    index += 2;
                }
                else
                {
                    if (character == '"') inString = false;
                    index++;
                }
            }
            else if (character == '"')
            {
                inString = true;
                output.Append(character);
                index++;
            }
            else if (character == '/' && next == '/')
            {
                inLineComment = true;
                index += 2;
            }
            else if (character == '/' && next == '*')
            {
                inBlockComment = true;
                index += 2;
            }
            else
            {
                output.Append(character);
                index++;
            }
        }

        return output.ToString();
    }

    public static string StripTrailingCommas(string text)
    {
        var output = new StringBuilder(text.Length);
        var inString = false;
        for (var index = 0; index < text.Length;)
        {
            var character = text[index];
            if (inString)
            {
                output.Append(character);
                if (character == '\\' && index + 1 < text.Length)
                {
                    output.Append(text[index + 1]);
                    index += 2;
                }
                else
                {
                    if (character == '"') inString = false;
                    index++;
                }
            }
            else if (character == '"')
            {
                inString = true;
                output.Append(character);
                index++;
            }
            else if (character == ',')
            {
                var nextIndex = index + 1;
                while (nextIndex < text.Length && text[nextIndex] is ' ' or '\t' or '\n' or '\r')
                {
                    nextIndex++;
                }
                if (nextIndex < text.Length && text[nextIndex] is '}' or ']')
                {
                    index++;
                }
                else
                {
                    output.Append(character);
                    index++;
                }
            }
            else
            {
                output.Append(character);
                index++;
            }
        }

        return output.ToString();
    }
}
