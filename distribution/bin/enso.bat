@echo off
set "comp-dir=%~dp0..\component"
rem A bundle (e.g. the IDE's) places the engine at <root>\dist\<version> and its
rem JDK at <root>\runtime\graalvm-*. Prefer that JDK, so the engine still starts
rem when java is not on PATH.
set java-exe=java
for /d %%d in ("%~dp0..\..\..\runtime\graalvm-*") do if exist "%%d\bin\java.exe" set "java-exe=%%d\bin\java.exe"
rem The package's jvm.options (engine\runner JvmOptions.java): one JVM option per
rem line. Blank lines, whitespace-only lines and # comments (also indented) are
rem skipped, leading and trailing spaces trimmed. Each option is quoted, so it may
rem contain spaces, but not a double quote or a single quote (the quoted -Xlog
rem file form is only for the native launcher). ^ % ! & | < > survive literally:
rem the value is moved around with delayed expansion, never re-parsed with call.
set "jvm-file-opts="
if exist "%~dp0..\jvm.options" for /f "usebackq eol=# tokens=*" %%o in ("%~dp0..\jvm.options") do (
  set "opt=%%o"
  call :trim
  if defined opt call :append
)
"%java-exe%" --module-path "%comp-dir%" %jvm-file-opts% -m org.enso.runner/org.enso.runner.Main %*
exit /B %errorlevel%

:trim
setlocal EnableDelayedExpansion
:trimloop
if not defined opt (
  endlocal
  set "opt="
  exit /B 0
)
if "!opt:~-1!"==" " (
  set "opt=!opt:~0,-1!"
  goto :trimloop
)
for /f "usebackq eol=; delims=" %%a in ('!opt!') do endlocal & set "opt=%%a"
exit /B 0

:append
setlocal EnableDelayedExpansion
set "new=!jvm-file-opts! "!opt!""
for /f "usebackq eol=; delims=" %%a in ('!new!') do endlocal & set "jvm-file-opts=%%a"
exit /B 0
