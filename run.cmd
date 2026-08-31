@pushd %~dp0
@rem CI can point ENSO_BUILD_CLI_BIN at a prebuilt binary to skip the cargo compile.
@if exist "%ENSO_BUILD_CLI_BIN%" (
@  "%ENSO_BUILD_CLI_BIN%" %*
@) else (
@  cargo run -p enso-build-cli -- %*
@)
@set EXITCODE=%ERRORLEVEL%
@popd
@exit /b %EXITCODE%
