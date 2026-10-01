/** Keep Windows interoperability guidance on the advertised tool in every mode. */
export const GIT_BASH_GUIDANCE = `This tool runs Git for Windows Bash (MSYS2); command is Bash source, not PowerShell source. The command uses Bash parsing (a fresh shell or the mode's persistent Bash terminal).
Bash expands $variables, $_, $(...) and backticks inside double quotes. In Bash, $_ is the last argument of the preceding command; it is not PowerShell's pipeline object. To invoke PowerShell, protect its source with Bash single quotes, e.g.:
MSYS2_ARG_CONV_EXCL='*' powershell.exe -NoProfile -Command 'Get-Process | Where-Object { $_.ProcessName -match "Wei" }'
For multiline PowerShell source or mixed quotes, use a single-quoted heredoc delimiter, for example:
powershell.exe -NoProfile -NonInteractive -Command - <<'PWSH'
Get-Process | Where-Object { $_.ProcessName -match "Wei" }
PWSH
For non-ASCII script text, -EncodedCommand with UTF-16LE base64 is another safe option. The payload must not be expanded by Bash first.
MSYS2 automatically converts POSIX-looking arguments when launching Windows .exe programs: tasklist /FI and cmd.exe /c can become paths. Disable that conversion only for the affected native command, e.g. MSYS2_ARG_CONV_EXCL='*' tasklist.exe /FI "PID eq 1234" /FO CSV /NH, or MSYS2_ARG_CONV_EXCL='*' cmd.exe /d /c "echo ok". Use Windows paths in these native payloads. Keep normal conversion for other Bash commands.`;
export function withGitBashGuidance(definition){return {...definition,description:definition.description+'\n\n'+GIT_BASH_GUIDANCE};}
