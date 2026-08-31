# Build script driver for the PowerShell. 
#
# Having it in addition to CMD script allows better experience in some cases,
# like interrupting the build with Ctrl+C.
#
# This was developed and tested on Windows only, though there is no reason 
# why it should not work on other platforms through PowerShell Core.

$InvokeProcess = {
    param (
        [string] $FilePath,
        [string[]] $Arguments = @(),
        [string] $WorkingDirectory = $PSScriptRoot
    )

    $psi = New-Object -TypeName System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.WorkingDirectory = $WorkingDirectory
    if ($Arguments -and $Arguments.Length -gt 0) {
        $psi.Arguments = $Arguments -join " "
    }
    $psi.UseShellExecute = $false

    $process = [System.Diagnostics.Process]::Start($psi)
    $process.WaitForExit()
    return $process.ExitCode
}

# CI (and anyone who wants to) can point this at a prebuilt `enso-build-cli` binary to skip the
# `cargo` compile. See the `Build Script` job in `.github/workflows`.
if ($env:ENSO_BUILD_CLI_BIN -and (Test-Path -LiteralPath $env:ENSO_BUILD_CLI_BIN -PathType Leaf)) {
    $Exit = & $InvokeProcess $env:ENSO_BUILD_CLI_BIN $args
} else {
    $CargoArgs = @("run", "-p", "enso-build-cli", "--")
    if ($args.Length -gt 0) {
        $CargoArgs += $args
    }
    $Exit = & $InvokeProcess "cargo" $CargoArgs
}
Exit $Exit
