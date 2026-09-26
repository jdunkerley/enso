@pushd %~dp0
@rem CI can point ENSO_BUILD_CLI_BIN at a prebuilt binary to skip the cargo compile.
@rem No parenthesised if/else here: cmd rejects `@)` inside a block, which broke
@rem this script for every command. Labels and `goto` avoid the block entirely.
@if not defined ENSO_BUILD_CLI_BIN goto :cargo
@if not exist "%ENSO_BUILD_CLI_BIN%" goto :cargo
@"%ENSO_BUILD_CLI_BIN%" %*
@goto :done
:cargo
@cargo run -p enso-build-cli -- %*
:done
@set EXITCODE=%ERRORLEVEL%
@popd
@exit /b %EXITCODE%
