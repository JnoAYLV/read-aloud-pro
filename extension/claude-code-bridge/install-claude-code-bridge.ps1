# Installs the Read Aloud Pro helper so Chrome and Edge can use Claude Code on this computer
# and save files to any folder (e.g. Google Drive). Run it as yourself (no admin needed):
#   right-click this file -> Run with PowerShell
# What it changes: writes com.readaloudpro.claude.json next to this script and adds one registry
# entry per browser under HKEY_CURRENT_USER (your user only). Undo with uninstall-claude-code-bridge.ps1.
# Keep this folder where it is after installing; the registry points to it.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = 'com.readaloudpro.claude'
$extensionId = 'enkleccggcppejcojjpimfldbmcfalmn'   # fixed by the "key" in manifest.json
$manifestPath = Join-Path $here "$name.json"
$manifest = @{
  name = $name
  description = 'Read Aloud Pro helper: Claude Code and file saving'
  path = (Join-Path $here 'rap_host.bat')
  type = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))

foreach ($key in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$name")) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath
}

$claude = @("$env:USERPROFILE\.local\bin\claude.exe", (Get-Command claude -ErrorAction SilentlyContinue).Source, "$env:APPDATA\npm\claude.cmd") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Write-Host ''
Write-Host 'Read Aloud Pro helper installed for Chrome and Edge.' -ForegroundColor Green
if ($claude) { Write-Host "Claude Code found: $claude" } else { Write-Host 'Claude Code was NOT found. Install it from https://claude.com/claude-code, then sign in.' -ForegroundColor Yellow }
Write-Host 'Next: restart Chrome, open Read Aloud Pro Settings -> Claude & library -> choose "Claude Code on this computer" -> Test connection.'
Write-Host 'If the test says you are not signed in: open a terminal, type  claude  then  /login'
Write-Host ''
Read-Host 'Press Enter to close'
