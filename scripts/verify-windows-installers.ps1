$ErrorActionPreference = "Stop"

function Assert-InstallerExit($process, [string]$operation) {
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "$operation failed with exit code $($process.ExitCode)."
    }
}

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

function Resolve-MsiInstallDirectory([string]$requestedDirectory) {
    if (Test-Path $requestedDirectory) { return $requestedDirectory }

    $uninstallRoots = @(
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    $application = Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq "ACM Agent Cost Monitor" } |
        Select-Object -First 1
    if ($application -and $application.InstallLocation -and (Test-Path $application.InstallLocation)) {
        return $application.InstallLocation
    }

    $defaultDirectory = Join-Path $env:ProgramFiles "ACM Agent Cost Monitor"
    if (Test-Path $defaultDirectory) { return $defaultDirectory }
    throw "MSI application install directory not found; requested $requestedDirectory."
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
    try {
        $env:ELECTRON_EXECUTABLE_PATH = $executablePath
        npm run test:e2e:electron
        if ($LASTEXITCODE -ne 0) { throw "Packaged Electron E2E failed for $executablePath." }
    }
    finally {
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

$nsisInstallResult = Start-Process -FilePath $nsisInstaller.FullName -ArgumentList @("/S", "/D=$nsisInstallDirectory") -Wait -PassThru
Assert-InstallerExit $nsisInstallResult "NSIS install"
$nsisExecutable = Find-AppExecutable $nsisInstallDirectory
Invoke-PackagedE2e $nsisExecutable
Assert-ShortcutState 1

$nsisRepairResult = Start-Process -FilePath $nsisInstaller.FullName -ArgumentList @("/S", "/D=$nsisInstallDirectory") -Wait -PassThru
Assert-InstallerExit $nsisRepairResult "NSIS reinstall"
$nsisExecutable = Find-AppExecutable $nsisInstallDirectory
Invoke-PackagedE2e $nsisExecutable
Assert-ShortcutState 1
if (-not (Test-Path $settingsMarker)) { throw "NSIS reinstall removed application settings." }

$nsisUninstaller = Get-ChildItem -Path $nsisInstallDirectory -Filter "*uninstall*.exe" -File -Recurse | Select-Object -First 1
if ($null -eq $nsisUninstaller) { throw "NSIS uninstaller was not installed." }
$nsisUninstallResult = Start-Process -FilePath $nsisUninstaller.FullName -ArgumentList "/S" -Wait -PassThru
Assert-InstallerExit $nsisUninstallResult "NSIS uninstall"
if ((Get-ProductShortcuts).Count -ne 0) { throw "NSIS uninstall left a Start Menu shortcut." }
if (Find-AppExecutable $nsisInstallDirectory -Optional) { throw "NSIS uninstall left the application executable." }
if (-not (Test-Path $settingsMarker)) { throw "NSIS uninstall removed application settings." }

$installArguments = "/i `"$($msiInstaller.FullName)`" /qn /norestart ALLUSERS=1 INSTALLDIR=`"$msiInstallDirectory`""
$msiInstallResult = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArguments -Wait -PassThru
Assert-InstallerExit $msiInstallResult "MSI install"
$msiInstallDirectory = Resolve-MsiInstallDirectory $msiInstallDirectory
$msiExecutable = Find-AppExecutable $msiInstallDirectory
Invoke-PackagedE2e $msiExecutable
Assert-ShortcutState 1

$repairArguments = "/fa `"$($msiInstaller.FullName)`" /qn /norestart REINSTALL=ALL REINSTALLMODE=vomus"
$msiRepairResult = Start-Process -FilePath "msiexec.exe" -ArgumentList $repairArguments -Wait -PassThru
Assert-InstallerExit $msiRepairResult "MSI repair"
$msiExecutable = Find-AppExecutable $msiInstallDirectory
Invoke-PackagedE2e $msiExecutable
Assert-ShortcutState 1
if (-not (Test-Path $settingsMarker)) { throw "MSI repair removed application settings." }

$uninstallArguments = "/x `"$($msiInstaller.FullName)`" /qn /norestart"
$msiUninstallResult = Start-Process -FilePath "msiexec.exe" -ArgumentList $uninstallArguments -Wait -PassThru
Assert-InstallerExit $msiUninstallResult "MSI uninstall"
if ((Get-ProductShortcuts).Count -ne 0) { throw "MSI uninstall left a Start Menu shortcut." }
if (Find-AppExecutable $msiInstallDirectory -Optional) { throw "MSI uninstall left the application executable." }
if (-not (Test-Path $settingsMarker)) { throw "MSI uninstall removed application settings." }
