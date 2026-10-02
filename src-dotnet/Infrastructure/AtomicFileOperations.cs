using System.ComponentModel;
using System.Runtime.InteropServices;

namespace OpencodeCostsViewer.Backend.Infrastructure;

internal static partial class AtomicFileOperations
{
    private const uint MoveFileReplaceExisting = 0x1;
    private const uint MoveFileWriteThrough = 0x8;

    public static void Replace(string temporaryPath, string targetPath)
    {
        if (OperatingSystem.IsWindows())
        {
            if (!MoveFileExW(
                temporaryPath,
                targetPath,
                MoveFileReplaceExisting | MoveFileWriteThrough))
            {
                throw new Win32Exception(Marshal.GetLastPInvokeError());
            }
        }
        else
        {
            File.Move(temporaryPath, targetPath, overwrite: true);
        }
    }

    public static void SyncDirectory(string directoryPath)
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        var descriptor = Open(directoryPath, 0);
        if (descriptor < 0)
        {
            throw new Win32Exception(Marshal.GetLastPInvokeError());
        }

        try
        {
            if (Fsync(descriptor) != 0)
            {
                throw new Win32Exception(Marshal.GetLastPInvokeError());
            }
        }
        finally
        {
            _ = Close(descriptor);
        }
    }

    [LibraryImport("kernel32.dll", EntryPoint = "MoveFileExW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool MoveFileExW(string existingFileName, string newFileName, uint flags);

    [LibraryImport("libc", EntryPoint = "open", StringMarshalling = StringMarshalling.Utf8, SetLastError = true)]
    private static partial int Open(string pathname, int flags);

    [LibraryImport("libc", EntryPoint = "fsync", SetLastError = true)]
    private static partial int Fsync(int fileDescriptor);

    [LibraryImport("libc", EntryPoint = "close", SetLastError = true)]
    private static partial int Close(int fileDescriptor);
}
