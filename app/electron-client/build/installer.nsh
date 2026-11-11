; Migrates an install made by the Rust installer that NSIS replaced in 2026-10
; (docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md).
;
; The Rust installer wrote its own uninstall key, `App Paths` entry and ProgIDs, which NSIS does
; not know about. Its files must go before NSIS copies the new ones: the app finds its engine by
; globbing `resources\enso\dist\*\bin`, so a leftover `dist\<old version>` could start the wrong
; engine. User data lives elsewhere (`%APPDATA%\Enso`, `%LOCALAPPDATA%\enso`).
;
; Two checks stop the migration before any registry key is removed: Enso still running, and the
; folder surviving `RMDir /r` (a partial delete). Both exit with code 2, silent mode included, so a
; script never reads a skipped migration as success.

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
      SetErrorLevel 2
      Quit
    ${EndIf}
    RMDir /r "$0"
    ; Something in the folder was locked: stop now, so no stale `resources\enso\dist\<old>` is left
    ; behind while the Rust installer's registry keys disappear.
    ${If} ${FileExists} "$0\*.*"
      MessageBox MB_OK|MB_ICONEXCLAMATION "Please close Enso, then run the installer again." /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    DeleteRegKey HKCU "${RUST_UNINSTALL_KEY}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Enso.exe"
    DeleteRegKey HKCU "Software\Classes\Enso.Source"
    DeleteRegKey HKCU "Software\Classes\Enso.ProjectBundle"
  ${EndIf}
!macroend

; #668: train the JDK AOT cache once the files are in place, so that the first launch already
; has it (otherwise the IDE trains it in the background, and the first opens run without it).
; `--train-jvm-aot` takes ~45 s on a desktop and exits 0 or 1; a failure only means the IDE trains
; at launch, so the exit code is not checked. An in-app update (`--updated`) does not wait: the
; relaunched IDE would be held for the whole training. It finds the training's lock held and
; waits for that cache instead.
!macro customInstall
  ${If} ${isUpdated}
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --train-jvm-aot'
  ${Else}
    DetailPrint "Preparing the engine for fast project opens (about a minute)..."
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --train-jvm-aot'
  ${EndIf}
!macroend
