@echo off
set "comp-dir=%~dp0..\component"
set java-opts=--enable-native-access=org.graalvm.truffle --sun-misc-unsafe-memory-access=allow --add-opens=java.base/java.nio=ALL-UNNAMED
rem A bundle (e.g. the IDE's) places the engine at <root>\dist\<version> and its
rem JDK at <root>\runtime\graalvm-*. Prefer that JDK, so the engine still starts
rem when java is not on PATH.
set java-exe=java
for /d %%d in ("%~dp0..\..\..\runtime\graalvm-*") do if exist "%%d\bin\java.exe" set "java-exe=%%d\bin\java.exe"
rem The package's jvm.options (engine\runner JvmOptions.java): one JVM option per
rem line, blank lines and # comments skipped. Each is quoted, so an option may
rem contain spaces, but not a double quote (the quoted -Xlog file form is only
rem for the native launcher).
set jvm-file-opts=
if exist "%~dp0..\jvm.options" for /f "usebackq eol=# delims=" %%o in ("%~dp0..\jvm.options") do call :addopt "%%o"
"%java-exe%" --module-path "%comp-dir%" %java-opts% %jvm-file-opts% -m org.enso.runner/org.enso.runner.Main %*
exit /B %errorlevel%

:addopt
set jvm-file-opts=%jvm-file-opts% "%~1"
exit /B 0
