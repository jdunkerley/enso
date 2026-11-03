<#
.SYNOPSIS
  Installs the IDE silently, checks it is registered and starts, then uninstalls it.
  This is the check that would have caught the installer that exited on launch (#251).
  It refuses to run where an Enso is already installed, so it is safe on a developer machine.
#>
param([Parameter(Mandatory)] [string] $Installer)
$ErrorActionPreference = 'Stop'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'

# The installer is per-user (#255): it must write nothing machine-wide. A regression to a per-machine
# install would write here instead of HKCU, so compare the machine-wide keys before and after.
$machineRoots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

function Get-MachineEnsoEntries {
  @($machineRoots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ } |
    ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'Enso*' } |
    ForEach-Object { $_.PSPath })
}

function Assert-NoMachineInstallChange($before) {
  $after = Get-MachineEnsoEntries
  # Compared as sorted text: `Compare-Object` refuses an empty list, and a runner normally has none.
  if ((@($before | Sort-Object) -join "`n") -ne (@($after | Sort-Object) -join "`n")) {
    throw "The machine-wide (HKLM) Enso uninstall entries changed: before [$($before -join ', ')], after [$($after -join ', ')]."
  }
}

function Get-EnsoUninstallEntries {
  # A fresh CI runner has no per-user Uninstall key until something installs per-user.
  if (-not (Test-Path $uninstallRoot)) { return @() }
  @(Get-ChildItem $uninstallRoot | ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Enso*' })
}

if ((Get-EnsoUninstallEntries).Count -gt 0) {
  throw 'Refusing to run: an Enso install is already present.'
}

$machineBefore = Get-MachineEnsoEntries
$installer = (Resolve-Path $Installer).Path
Write-Host "Installing $installer"
$process = Start-Process $installer -ArgumentList '/S' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "The installer exited with $($process.ExitCode)." }

Assert-NoMachineInstallChange $machineBefore
$entries = Get-EnsoUninstallEntries
if ($entries.Count -ne 1) { throw "Expected exactly one Enso uninstall entry, found $($entries.Count)." }
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
$uninstall = Start-Process cmd.exe -ArgumentList '/c', $entry.QuietUninstallString -Wait -PassThru
# This is the NSIS stub's exit code: it copies the real uninstaller to %TEMP%, starts it and returns
# before it finishes, so 0 says only that the stub ran. The checks below are what prove the
# uninstall: the files and the key are gone, and nothing was left machine-wide.
if ($uninstall.ExitCode -ne 0) { throw "The uninstaller exited with $($uninstall.ExitCode)." }
# The NSIS uninstaller re-launches itself from %TEMP%, so wait for it to finish.
for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'The uninstaller left Enso.exe behind.' }
for ($i = 0; $i -lt 60 -and (Get-EnsoUninstallEntries).Count -gt 0; $i++) { Start-Sleep -Seconds 1 }
if ((Get-EnsoUninstallEntries).Count -gt 0) { throw 'The uninstaller left its uninstall entry behind.' }
Assert-NoMachineInstallChange $machineBefore
Write-Host 'Installer smoke test passed.'
