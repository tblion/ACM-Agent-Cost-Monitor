$ErrorActionPreference = "Stop"

function Find-AppExecutable([string]$installDirectory, [switch]$Optional) {
    if (-not (Test-Path $installDirectory)) {
        if ($Optional) { return $null }
        throw "Application install directory not found: $installDirectory"
    }
    $application = Get-ChildItem -Path $installDirectory -Filter "*.exe" -File |
        Where-Object { $_.Name -notmatch "(?i)uninstall|crashpad|elevate|update" } |
        Select-Object -First 1
    if ($null -eq $application -and -not $Optional) { throw "Application executable not found in $installDirectory." }
    return $application.FullName
}

function Invoke-InstallerProcess([string]$filePath, [string]$arguments, [string]$operation, [string]$logPath = $null) {
    Write-Host "${operation}: $filePath $arguments"
    $process = Start-Process -FilePath $filePath -ArgumentList $arguments -PassThru
    if (-not $process.WaitForExit(600000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$operation timed out after 10 minutes."
    }
    $process.Refresh()
    if ($process.ExitCode -notin @(0, 3010)) {
        $details = if ($logPath -and (Test-Path $logPath)) {
            (Get-Content -Path $logPath -Tail 60) -join [Environment]::NewLine
        } else { "No installer log available." }
        throw "$operation failed with exit code $($process.ExitCode).`n$details"
    }
    return $process
}

function Get-ProductShortcuts {
    $startMenus = @(
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
    ) | Where-Object { Test-Path $_ }
    return @($startMenus | ForEach-Object {
        Get-ChildItem -Path $_ -Filter "*.lnk" -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -eq "ACM Agent Cost Monitor" }
    })
}

function Assert-ShortcutState([int]$expectedStartMenuCount) {
    $actual = (Get-ProductShortcuts).Count
    if ($actual -ne $expectedStartMenuCount) {
        throw "Expected $expectedStartMenuCount Start Menu shortcut(s), found $actual."
    }
    $desktopRoots = @((Join-Path $env:USERPROFILE "Desktop"), (Join-Path $env:PUBLIC "Desktop")) |
        Where-Object { Test-Path $_ }
    $desktopShortcuts = @($desktopRoots | ForEach-Object {
        Get-ChildItem -Path $_ -Filter "*.lnk" -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -eq "ACM Agent Cost Monitor" }
    })
    if ($desktopShortcuts.Count -ne 0) { throw "Installer created an unexpected desktop shortcut." }
}

function Invoke-PackagedE2e([string]$executablePath) {
    $previousPath = $env:ELECTRON_EXECUTABLE_PATH
    $applicationRoot = Split-Path $executablePath -Parent
    try {
        $env:ELECTRON_EXECUTABLE_PATH = $executablePath
        $env:E2E_ELECTRON = "true"
        node node_modules/@playwright/test/cli.js test --config=playwright.electron.config.ts
        if ($LASTEXITCODE -ne 0) { throw "Packaged Electron E2E failed for $executablePath." }
    }
    finally {
        $applicationProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ExecutablePath -and $_.ExecutablePath.StartsWith($applicationRoot, [StringComparison]::OrdinalIgnoreCase)
            }
        foreach ($applicationProcess in $applicationProcesses) {
            taskkill.exe /PID $applicationProcess.ProcessId /T /F 2>$null | Out-Null
        }
        $env:ELECTRON_EXECUTABLE_PATH = $previousPath
    }
}

$releaseDirectory = Join-Path $PSScriptRoot "..\release"
$nsisInstaller = Get-ChildItem -Path $releaseDirectory -Filter "*.exe" -File | Select-Object -First 1
$msiInstaller = Get-ChildItem -Path $releaseDirectory -Filter "*.msi" -File | Select-Object -First 1
if ($null -eq $nsisInstaller) { throw "NSIS installer was not generated." }
if ($null -eq $msiInstaller) { throw "MSI installer was not generated." }

$nsisInstallDirectory = Join-Path $env:LOCALAPPDATA "Programs\acm-agent-cost-monitor"
$msiInstallDirectory = Join-Path $env:RUNNER_TEMP "acm-agent-cost-monitor-msi-install"
$settingsDirectory = Join-Path $env:APPDATA "com.fcpb6403.opencode-costs-viewer"
New-Item -ItemType Directory -Path $settingsDirectory -Force | Out-Null
$settingsMarker = Join-Path $settingsDirectory "installer-upgrade-marker.txt"
Set-Content -Path $settingsMarker -Value "preserve across install and uninstall" -NoNewline
Remove-Item -Path $nsisInstallDirectory, $msiInstallDirectory -Recurse -Force -ErrorAction SilentlyContinue

$nsisInstallArguments = "/S /D=$nsisInstallDirectory"
$nsisInstallResult = Invoke-InstallerProcess $nsisInstaller.FullName $nsisInstallArguments "NSIS install"
$nsisExecutable = Find-AppExecutable $nsisInstallDirectory
Invoke-PackagedE2e $nsisExecutable
Assert-ShortcutState 1

$nsisRepairResult = Invoke-InstallerProcess $nsisInstaller.FullName $nsisInstallArguments "NSIS reinstall"
$nsisExecutable = Find-AppExecutable $nsisInstallDirectory
Invoke-PackagedE2e $nsisExecutable
Assert-ShortcutState 1
if (-not (Test-Path $settingsMarker)) { throw "NSIS reinstall removed application settings." }

$nsisUninstaller = Get-ChildItem -Path $nsisInstallDirectory -Filter "*uninstall*.exe" -File -Recurse | Select-Object -First 1
if ($null -eq $nsisUninstaller) { throw "NSIS uninstaller was not installed." }
$nsisUninstallResult = Invoke-InstallerProcess $nsisUninstaller.FullName "/S" "NSIS uninstall"
$nsisExecutableAfterUninstall = Find-AppExecutable $nsisInstallDirectory -Optional
if ($nsisExecutableAfterUninstall) {
    Write-Host "Removing files left in the isolated NSIS test directory: $nsisInstallDirectory"
    Remove-Item -Path $nsisInstallDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $nsisInstallDirectory) { throw "Unable to clean the isolated NSIS test directory: $nsisInstallDirectory" }
$remainingShortcuts = @(Get-ProductShortcuts)
if ($remainingShortcuts.Count -ne 0) {
    $paths = ($remainingShortcuts | ForEach-Object { $_.FullName }) -join ", "
    Write-Host "Cleaning up Start Menu shortcut(s) left by the NSIS uninstaller: $paths"
    $remainingShortcuts | Remove-Item -Force
}
if (-not (Test-Path $settingsMarker)) { throw "NSIS uninstall removed application settings." }

$msiInstallLog = Join-Path $env:RUNNER_TEMP "acm-agent-cost-monitor-msi-install.log"
$installArguments = "/i `"$($msiInstaller.FullName)`" /qn /norestart ALLUSERS=1 APPLICATIONFOLDER=`"$msiInstallDirectory`" /L*V `"$msiInstallLog`""
$msiInstallResult = Invoke-InstallerProcess "msiexec.exe" $installArguments "MSI install" $msiInstallLog
$msiExecutable = Find-AppExecutable $msiInstallDirectory
Invoke-PackagedE2e $msiExecutable
Assert-ShortcutState 1

$repairLog = Join-Path $env:RUNNER_TEMP "acm-agent-cost-monitor-msi-repair.log"
$repairArguments = "/fa `"$($msiInstaller.FullName)`" /qn /norestart REINSTALL=ALL REINSTALLMODE=vomus /L*V `"$repairLog`""
$msiRepairResult = Invoke-InstallerProcess "msiexec.exe" $repairArguments "MSI repair" $repairLog
$msiExecutable = Find-AppExecutable $msiInstallDirectory
Invoke-PackagedE2e $msiExecutable
Assert-ShortcutState 1
if (-not (Test-Path $settingsMarker)) { throw "MSI repair removed application settings." }

$uninstallLog = Join-Path $env:RUNNER_TEMP "acm-agent-cost-monitor-msi-uninstall.log"
$uninstallArguments = "/x `"$($msiInstaller.FullName)`" /qn /norestart /L*V `"$uninstallLog`""
$msiUninstallResult = Invoke-InstallerProcess "msiexec.exe" $uninstallArguments "MSI uninstall" $uninstallLog
if ((Get-ProductShortcuts).Count -ne 0) { throw "MSI uninstall left a Start Menu shortcut." }
if (Find-AppExecutable $msiInstallDirectory -Optional) { throw "MSI uninstall left the application executable." }
if (-not (Test-Path $settingsMarker)) { throw "MSI uninstall removed application settings." }
