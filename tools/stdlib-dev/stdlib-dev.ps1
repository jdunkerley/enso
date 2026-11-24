<#
.SYNOPSIS
  Try standard library changes (docs, front matter, widgets) in the installed IDE without
  building an installer.

.DESCRIPTION
  link    Makes %USERPROFILE%\enso\libraries\<Lib> for each library: the installed IDE's
          package.yaml, manifest.yaml and Java jars, with src and docs linked (junctions) to
          the checkout's distribution\lib\Standard\<Lib>\0.0.0-dev. A project whose
          package.yaml has `prefer-local-libraries: true` then loads those sources.
  compile Runs the installed engine's `enso --compile` on each linked library (Base first),
          writing its IR and suggestion caches. Without it the library runs but the
          component browser and help panel do not list it.
  unlink  Removes the local libraries again (only the folders this script made).

  After `compile`, close and reopen the project. See tools/stdlib-dev/CLAUDE.md.

.EXAMPLE
  .\tools\stdlib-dev\stdlib-dev.ps1 link Base Table -Checkout C:\Repos\Enso\ide-stdlib-dev
  .\tools\stdlib-dev\stdlib-dev.ps1 compile Base Table
#>
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('link', 'compile', 'unlink')][string]$Command,
  [Parameter(Position = 1, ValueFromRemainingArguments)][string[]]$Libraries = @('Base', 'Table'),
  # The checkout whose sources are linked. It should be at the commit the installed nightly
  # was built from (`gh release view <version> --json targetCommitish`).
  [string]$Checkout = (Resolve-Path "$PSScriptRoot\..\..").Path,
  # The installed IDE's engine distribution; the newest one when not given.
  [string]$Dist
)
$ErrorActionPreference = 'Stop'

if (-not $Dist) {
  $Dist = Get-ChildItem "$env:LOCALAPPDATA\Programs\enso\resources\enso\dist" -Directory |
    Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
$version = Split-Path $Dist -Leaf
$root = Join-Path ($env:ENSO_HOME ?? "$env:USERPROFILE\enso") 'libraries'
# Marks a folder this script made, so `unlink` never removes anything else.
$marker = '.stdlib-dev'

# Base first: every other library's caches depend on Base's sources.
$ordered = @($Libraries | Where-Object { $_ -eq 'Base' }) + @($Libraries | Where-Object { $_ -ne 'Base' })

switch ($Command) {
  'link' {
    New-Item -ItemType Directory -Force $root | Out-Null
    foreach ($lib in $ordered) {
      $installed = Join-Path $Dist "lib\Standard\$lib\$version"
      $sources = Join-Path $Checkout "distribution\lib\Standard\$lib\0.0.0-dev"
      if (-not (Test-Path $installed)) { throw "The installed IDE has no $lib at $installed." }
      if (-not (Test-Path $sources)) { throw "The checkout has no $lib at $sources." }
      $dst = Join-Path $root $lib
      if ((Test-Path $dst) -and -not (Test-Path (Join-Path $dst $marker))) {
        throw "$dst exists and was not made by this script; move it away first."
      }
      if (Test-Path $dst) { cmd /c rmdir /s /q "$dst" }
      New-Item -ItemType Directory $dst | Out-Null
      New-Item -ItemType File (Join-Path $dst $marker) | Out-Null
      Copy-Item (Join-Path $installed 'package.yaml'), (Join-Path $installed 'manifest.yaml') $dst
      # Not every library has Java helpers (Visualization has none).
      if (Test-Path (Join-Path $installed 'polyglot')) {
        New-Item -ItemType Junction -Path (Join-Path $dst 'polyglot') -Target (Join-Path $installed 'polyglot') | Out-Null
      }
      New-Item -ItemType Junction -Path (Join-Path $dst 'src') -Target (Join-Path $sources 'src') | Out-Null
      New-Item -ItemType Junction -Path (Join-Path $dst 'docs') -Target (Join-Path $sources 'docs') | Out-Null
      Write-Host "Linked $lib -> $sources (engine $version)"
    }
    Write-Host "Set 'prefer-local-libraries: true' in the test project's package.yaml (keep it in a folder of its own), then run 'compile'."
  }
  'compile' {
    $enso = Join-Path $Dist 'bin\enso.bat'
    foreach ($lib in $ordered) {
      $dst = Join-Path $root $lib
      if (-not (Test-Path (Join-Path $dst $marker))) { throw "$lib is not linked; run 'link $lib' first." }
      $log = Join-Path $env:TEMP "stdlib-dev-compile-$lib.log"
      $watch = [Diagnostics.Stopwatch]::StartNew()
      # `enso` must start in the library's parent (Note [The Launcher Starts In The Project's Parent]).
      Push-Location $root
      try { & $enso --compile $dst *> $log } finally { Pop-Location }
      $code = $LASTEXITCODE
      $problems = Select-String -Path $log -Pattern '\[(ERROR|WARN)\]' | Select-Object -First 10
      Write-Host ("{0}: exit {1} in {2:N0} s" -f $lib, $code, $watch.Elapsed.TotalSeconds)
      $problems | ForEach-Object { Write-Host "  $($_.Line)" }
      if ($code -ne 0) { throw "Compiling $lib failed; see $log." }
    }
    Write-Host 'Now close and reopen the project.'
  }
  'unlink' {
    foreach ($lib in $ordered) {
      $dst = Join-Path $root $lib
      if (Test-Path (Join-Path $dst $marker)) {
        # rmdir removes the junctions without following them into the checkout.
        cmd /c rmdir /s /q "$dst"
        Write-Host "Unlinked $lib"
      }
    }
  }
}
