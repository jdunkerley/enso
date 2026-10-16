@echo off
set "comp-dir=%~dp0..\component"
set java-opts=--enable-native-access=org.graalvm.truffle --sun-misc-unsafe-memory-access=allow --add-opens=java.base/java.nio=ALL-UNNAMED
rem A bundle (e.g. the IDE's) places the engine at <root>\dist\<version> and its
rem JDK at <root>\runtime\graalvm-*. Prefer that JDK, so the engine still starts
rem when java is not on PATH.
set java-exe=java
for /d %%d in ("%~dp0..\..\..\runtime\graalvm-*") do if exist "%%d\bin\java.exe" set "java-exe=%%d\bin\java.exe"
"%java-exe%" --module-path "%comp-dir%" %java-opts% -m org.enso.runner/org.enso.runner.Main %*
exit /B %errorlevel%
