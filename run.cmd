@pushd %~dp0
@cargo run -p enso-build-cli -- %*
@set EXITCODE=%ERRORLEVEL%
@popd
@exit /b %EXITCODE%
