<#
.SYNOPSIS
  Installs the IDE silently, checks it is registered and starts, then uninstalls it.
  This is the check that would have caught the installer that exited on launch (#251).
#>
param([Parameter(Mandatory)] [string] $Installer)
$ErrorActionPreference = 'Stop'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'

function Get-EnsoUninstallEntry {
  Get-ChildItem $uninstallRoot | ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Enso*' } | Select-Object -First 1
}

$installer = (Resolve-Path $Installer).Path
Write-Host "Installing $installer"
$process = Start-Process $installer -ArgumentList '/S' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "The installer exited with $($process.ExitCode)." }

$entry = Get-EnsoUninstallEntry
if ($null -eq $entry) { throw 'The installer wrote no uninstall entry.' }
$exe = Join-Path $entry.InstallLocation 'Enso.exe'
if (-not (Test-Path $exe)) { throw "Enso.exe is missing: $exe" }

Write-Host "Starting $exe"
$app = Start-Process $exe -PassThru
Start-Sleep -Seconds 20
if ($app.HasExited) { throw "Enso exited during start-up with $($app.ExitCode)." }
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$($entry.InstallLocation)*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Uninstalling: $($entry.QuietUninstallString)"
Start-Process cmd.exe -ArgumentList '/c', $entry.QuietUninstallString -Wait
# The NSIS uninstaller re-launches itself from %TEMP%, so wait for it to finish.
for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'The uninstaller left Enso.exe behind.' }
if ($null -ne (Get-EnsoUninstallEntry)) { throw 'The uninstaller left its uninstall entry behind.' }
Write-Host 'Installer smoke test passed.'
