; Migrates an install made by the Rust installer that NSIS replaced in 2026-10
; (docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md).
;
; The Rust installer wrote its own uninstall key, `App Paths` entry and ProgIDs, which NSIS does
; not know about. Its files must go before NSIS copies the new ones: the app finds its engine by
; globbing `resources\enso\dist\*\bin`, so a leftover `dist\<old version>` could start the wrong
; engine. User data lives elsewhere (`%APPDATA%\Enso`, `%LOCALAPPDATA%\enso`).

!define RUST_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Enso"

!macro customInit
  ReadRegStr $0 HKCU "${RUST_UNINSTALL_KEY}" "InstallLocation"
  ; Only ever the folder the Rust installer used (`StrCmp` ignores case).
  ${If} $0 != ""
  ${AndIf} $0 == "$LOCALAPPDATA\Programs\Enso"
    ; A running executable cannot be deleted, which makes this the "is Enso running?" check.
    ClearErrors
    Delete "$0\Enso.exe"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Please close Enso, then run the installer again." /SD IDOK
      Quit
    ${EndIf}
    RMDir /r "$0"
    DeleteRegKey HKCU "${RUST_UNINSTALL_KEY}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Enso.exe"
    DeleteRegKey HKCU "Software\Classes\Enso.Source"
    DeleteRegKey HKCU "Software\Classes\Enso.ProjectBundle"
  ${EndIf}
!macroend
