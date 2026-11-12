@echo off
rem The engine's launcher: runs the runner on a JVM (engine\runner CLAUDE.md, "Launchers").
rem setlocal keeps every variable below, and the directory change, out of the caller's console.
setlocal DisableDelayedExpansion
for %%r in ("%~dp0..") do set "engine-root=%%~fr"
set "comp-dir=%engine-root%\component"
rem A bundle (e.g. the IDE's) places the engine at <root>\dist\<version> and its
rem JDK at <root>\runtime\graalvm-*. Prefer that JDK, so the engine still starts
rem when java is not on PATH. Without one, JAVA_HOME's, then the PATH's. It must be
rem a GraalVM JDK: jvm.options has options other JDKs refuse (-XX:-UseJVMCICompiler).
set "java-exe=java"
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set "java-exe=%JAVA_HOME%\bin\java.exe"
for /d %%d in ("%engine-root%\..\..\runtime\graalvm-*") do if exist "%%d\bin\java.exe" set "java-exe=%%d\bin\java.exe"

rem Note [The Launcher Starts In The Project's Parent] in bin/enso: for --run and
rem --in-project (which wins), start the JVM in the parent of the project root (the
rem nearest directory at or above the path with a package.yaml) and pass the
rem directory the launcher was started in as -Denso.user.dir. cmd splits its
rem arguments at , ; and = as well as at spaces, so --run=path works, but a path
rem holding one of those must be quoted (as one holding a space must anyway);
rem a quoted "--run=path" is read whole.
set "run-path="
set "in-project-path="
:scan
if "%~1"=="" goto :scan_done
if "%~1"=="--run" if not defined run-path set "run-path=%~2"
if "%~1"=="--in-project" if not defined in-project-path set "in-project-path=%~2"
rem A quoted "--run=path" reaches here whole.
set "scan-arg=%~1"
if "%scan-arg:~0,6%"=="--run=" if not defined run-path set "run-path=%scan-arg:~6%"
if "%scan-arg:~0,13%"=="--in-project=" if not defined in-project-path set "in-project-path=%scan-arg:~13%"
shift
goto :scan
:scan_done
set "project-path=%run-path%"
if defined in-project-path set "project-path=%in-project-path%"
set "cwd-opt="
if not defined project-path goto :cwd_done
for %%p in ("%project-path%") do set "probe=%%~fp"
if not exist "%probe%" goto :cwd_done
:root_loop
if exist "%probe%\package.yaml" goto :root_found
for %%p in ("%probe%\..") do set "parent=%%~fp"
if "%parent%"=="%probe%" goto :cwd_done
set "probe=%parent%"
goto :root_loop
:root_found
for %%p in ("%probe%\..") do set "target=%%~fp"
set "user-dir=%CD%"
rem A trailing backslash would escape the closing quote for java.exe: double it.
if "%user-dir:~-1%"=="\" set "user-dir=%user-dir%\"
cd /d "%target%" || exit /B 1
set cwd-opt="-Denso.user.dir=%user-dir%"
:cwd_done

rem The JVM options, each quoted, so that it may hold spaces and ^ % ! & | < >
rem literally. A double quote inside an option (the quoted -Xlog file form,
rem -Xlog:...:file="C:\Users\John Smith\use.log") is passed on escaped; between
rem such quotes & | < > ^ are not supported. Values move between setlocal scopes
rem with delayed expansion, never re-parsed with call.
rem
rem First the package's jvm.options (engine\runner JvmOptions.java): one JVM option
rem per line; blank lines and # comments (also indented) are skipped, each line is
rem trimmed, and a UTF-8 byte order mark is dropped (bom below holds its bytes, which
rem cmd decodes in the console's code page exactly as it decodes the file's).
set "bom=﻿"
set "jvm-opts="
set "skip-comments=1"
if exist "%engine-root%\jvm.options" for /f "usebackq eol=# tokens=*" %%o in ("%engine-root%\jvm.options") do (
  set "opt=%%o"
  call :add_option
)

rem Then ENSO_JVM_OPTIONS (Note [JVM Options Of The Engine] in JvmOptions.java): a
rem value with a newline is one option per line, so that an option may contain
rem spaces; any other value is split on spaces and tabs.
set "skip-comments="
if not defined ENSO_JVM_OPTIONS goto :env_done
(set lf=^
%=empty=%
)
set "env-multiline="
setlocal EnableDelayedExpansion
for %%l in ("!lf!") do if not "!ENSO_JVM_OPTIONS:%%~l=!"=="!ENSO_JVM_OPTIONS!" (
  endlocal
  set "env-multiline=1"
  goto :env_mode_known
)
endlocal
:env_mode_known
if defined env-multiline goto :env_lines
rem One word at a time: the first from the variable, the rest from what is left.
set "env-source=ENSO_JVM_OPTIONS"
:env_word
setlocal EnableDelayedExpansion
for /f "tokens=1*" %%a in ("!%env-source%!") do (
  endlocal
  set "opt=%%a"
  set "rest=%%b"
  goto :env_got_word
)
endlocal
goto :env_done
:env_got_word
set "env-source=rest"
call :add_option
if defined rest goto :env_word
goto :env_done
rem One line at a time, by number. for /f skips empty lines but counts them in
rem skip=, so every line gets a "." in front (dropped by :add_option).
:env_lines
set "env-skip="
set "envline=0"
set "strip-first=1"
:env_line
setlocal EnableDelayedExpansion
for %%l in ("!lf!") do for /f "%env-skip%delims=" %%a in (".!ENSO_JVM_OPTIONS:%%~l=%%~l.!") do (
  endlocal
  set "opt=%%a"
  goto :env_got_line
)
endlocal
goto :env_done
:env_got_line
set /a envline+=1
set "env-skip=skip=%envline% "
call :add_option
goto :env_line
:env_done
set "strip-first="

"%java-exe%" --module-path "%comp-dir%" %cwd-opt% %jvm-opts% -m org.enso.runner/org.enso.runner.Main %*
exit /B %errorlevel%

rem Appends opt (cleaned, escaped and quoted) to jvm-opts, unless it is empty or, in
rem jvm.options, a comment.
:add_option
setlocal EnableDelayedExpansion
if defined strip-first set "opt=!opt:~1!"
if not defined opt goto :add_option_skip
if defined bom set "opt=!opt:%bom%=!"
:add_option_ltrim
if not defined opt goto :add_option_skip
if "!opt:~0,1!"==" " set "opt=!opt:~1!" & goto :add_option_ltrim
if "!opt:~0,1!"=="	" set "opt=!opt:~1!" & goto :add_option_ltrim
:add_option_rtrim
if not defined opt goto :add_option_skip
if "!opt:~-1!"==" " set "opt=!opt:~0,-1!" & goto :add_option_rtrim
if "!opt:~-1!"=="	" set "opt=!opt:~0,-1!" & goto :add_option_rtrim
if defined skip-comments if "!opt:~0,1!"=="#" goto :add_option_skip
rem java.exe's rules: \" is a literal quote, and backslashes before the closing
rem quote are doubled.
set "opt=!opt:\"=\\"!"
set "opt=!opt:"=\"!"
set "tail="
:add_option_backslash
if "!opt:~-1!"=="\" set "opt=!opt:~0,-1!" & set "tail=!tail!\\" & goto :add_option_backslash
set "new=!jvm-opts! "!opt!!tail!""
for /f "usebackq eol=; delims=" %%a in ('!new!') do endlocal & set "jvm-opts=%%a"
exit /B 0
:add_option_skip
endlocal
exit /B 0
