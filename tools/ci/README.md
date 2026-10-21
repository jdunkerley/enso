# CI Tools

Scripts that the GitHub workflows run:

- `windows-installer-smoke.ps1` — installs the Windows installer silently,
  checks it is registered and starts, then uninstalls it (IDE packaging, #251).
  It refuses to run where an Enso is already installed.
