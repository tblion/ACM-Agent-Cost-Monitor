using System.Diagnostics;
using OpencodeCostsViewer.Backend.Models;

namespace OpencodeCostsViewer.Backend.Application;

internal static class RuntimeMetricsService
{
    public static RuntimeMetrics Collect(string? databasePath)
    {
        ulong? databaseSize = null;
        if (databasePath is not null)
        {
            try
            {
                if (File.Exists(databasePath)) databaseSize = checked((ulong)new FileInfo(databasePath).Length);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or OverflowException)
            {
                databaseSize = null;
            }
        }

        ulong? processMemory = null;
        try
        {
            using var process = Process.GetCurrentProcess();
            processMemory = checked((ulong)process.WorkingSet64);
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception or OverflowException)
        {
            processMemory = null;
        }

        return new RuntimeMetrics(databaseSize, processMemory, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
}
