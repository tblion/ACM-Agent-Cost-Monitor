// Selects the platform SQLite provider used by the backend.
namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static class SqliteProvider
{
    private static readonly object InitializationLock = new();
    private static bool _initialized;

    public static void Initialize()
    {
        lock (InitializationLock)
        {
            if (_initialized)
            {
                return;
            }

            if (OperatingSystem.IsWindows())
            {
                SQLitePCL.raw.SetProvider(new SQLitePCL.SQLite3Provider_winsqlite3());
            }
            else
            {
                SQLitePCL.raw.SetProvider(new SQLitePCL.SQLite3Provider_sqlite3());
            }
            SQLitePCL.raw.FreezeProvider();
            _initialized = true;
        }
    }
}
