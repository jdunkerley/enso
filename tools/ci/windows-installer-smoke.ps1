<#
.SYNOPSIS
  Installs the IDE silently, checks it is registered, trained the JDK AOT cache (#668) and starts,
  then uninstalls it.
  This is the check that would have caught the installer that exited on launch (#251).
  It refuses to run where an Enso is already installed, so it is safe on a developer machine.
#>
param([Parameter(Mandatory)] [string] $Installer)
$ErrorActionPreference = 'Stop'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'

# The installer is per-user (#255): it must write nothing machine-wide. A regression to a per-machine
# install would write its uninstall key under HKLM instead of HKCU, so any Enso key there is a failure.
$machineRoots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

function Get-MachineEnsoEntries {
  @($machineRoots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ } |
    ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'Enso*' } |
    ForEach-Object { $_.PSPath })
}

function Assert-NoMachineInstall {
  $found = @(Get-MachineEnsoEntries)
  if ($found.Count -gt 0) {
    throw "The install is per-machine: Enso uninstall entries exist under HKLM: $($found -join ', ')."
  }
}

function Get-EnsoUninstallEntries {
  # A fresh CI runner has no per-user Uninstall key until something installs per-user.
  if (-not (Test-Path $uninstallRoot)) { return @() }
  @(Get-ChildItem $uninstallRoot | ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Enso*' })
}

if ((Get-EnsoUninstallEntries).Count -gt 0 -or @(Get-MachineEnsoEntries).Count -gt 0) {
  throw 'Refusing to run: an Enso install is already present.'
}

# The installer trains the JDK AOT cache (#668) in the local cache directory (#682), not the roaming
# userData. Only the key directories this install makes are checked and removed: a developer machine may have its own.
$aotRoot = Join-Path $env:LOCALAPPDATA 'Enso\jvm-aot'
function Get-AotKeys { if (Test-Path $aotRoot) { @(Get-ChildItem $aotRoot -Directory | ForEach-Object Name) } else { @() } }
$aotKeysBefore = Get-AotKeys

$installer = (Resolve-Path $Installer).Path
Write-Host "Installing $installer"
$installStarted = Get-Date
$process = Start-Process $installer -ArgumentList '/S' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "The installer exited with $($process.ExitCode)." }
Write-Host "Installed in $([int]((Get-Date) - $installStarted).TotalSeconds) s."

$newAotKeys = @(Get-AotKeys | Where-Object { $aotKeysBefore -notcontains $_ })
$trained = @($newAotKeys | Where-Object { Test-Path (Join-Path $aotRoot "$_\enso.aot") })
if ($trained.Count -ne 1) {
  $log = Get-ChildItem (Join-Path $env:APPDATA 'Enso\logs') -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime | Select-Object -Last 1
  if ($log) { Write-Host "The newest IDE log, $($log.FullName):"; Get-Content $log.FullName -Tail 60 }
  throw "Expected the installer to train one JDK AOT cache, found $($trained.Count) (new key directories: $($newAotKeys -join ', '))."
}
Write-Host "The installer trained the JDK AOT cache $(Join-Path $aotRoot $trained[0])."

Assert-NoMachineInstall
# HKCU is where a per-user install registers: exactly one entry must be there.
$entries = Get-EnsoUninstallEntries
if ($entries.Count -ne 1) { throw "Expected exactly one Enso uninstall entry in HKCU, found $($entries.Count)." }
$entry = $entries[0]
# NSIS writes no InstallLocation to the uninstall key; DisplayIcon is `<dir>\Enso.exe,0`.
if ([string]::IsNullOrWhiteSpace($entry.DisplayIcon)) { throw 'The uninstall entry has no DisplayIcon.' }
$exe = ($entry.DisplayIcon -replace ',-?\d+$', '').Trim('"')
if (-not (Test-Path $exe)) { throw "Enso.exe is missing: $exe" }
$dir = Split-Path $exe

Write-Host "Starting $exe"
$app = Start-Process $exe -PassThru
Start-Sleep -Seconds 20
if ($app.HasExited) { throw "Enso exited during start-up with $($app.ExitCode)." }
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$dir\*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Uninstalling: $($entry.QuietUninstallString)"
# The NSIS uninstaller copies itself to %TEMP% and starts that copy, so the process started here
# returns at once with 0 whatever the copy goes on to do (#261). `_?=<install dir>` makes it run in
# place and synchronously, so its exit code is the real one. It must be the last argument and
# unquoted. The cost: NSIS cannot delete the running uninstaller or its folder, so they are removed
# below.
$command = $entry.QuietUninstallString
if ($command -notmatch '^\s*"([^"]+)"\s*(.*)$' -and $command -notmatch '^\s*(\S+)\s*(.*)$') {
  throw "Cannot parse the QuietUninstallString: $command"
}
$uninstaller = $Matches[1]
$uninstallArgs = $Matches[2]
if (-not (Test-Path $uninstaller)) { throw "The uninstaller is missing: $uninstaller" }
$uninstall = Start-Process $uninstaller -ArgumentList "$uninstallArgs _?=$dir" -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "The uninstaller exited with $($uninstall.ExitCode)." }
if (Test-Path $exe) { throw 'The uninstaller left Enso.exe behind.' }
if ((Get-EnsoUninstallEntries).Count -gt 0) { throw 'The uninstaller left its uninstall entry behind.' }
Assert-NoMachineInstall
Remove-Item $uninstaller -Force -ErrorAction SilentlyContinue
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
foreach ($key in $newAotKeys) { Remove-Item (Join-Path $aotRoot $key) -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'Installer smoke test passed.'
