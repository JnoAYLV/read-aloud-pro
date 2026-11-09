# Read Aloud Pro - Claude Code helper (Chrome "native messaging" host).
# Chrome starts this script when the extension asks for Claude Code or saves to a folder.
# It only talks to the Read Aloud Pro extension (see allowed_origins in the manifest the installer writes).
#   ping : is Claude Code installed?
#   run  : run one headless Claude Code request with your existing login; no tools except Read for PDFs,
#          confined to a temporary folder; customizations (CLAUDE.md, hooks, plugins) are skipped.
#   save : write a file into the folder chosen in Settings and optionally open it.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-Message {
  $len = New-Object byte[] 4; $got = 0
  while ($got -lt 4) { $n = $stdin.Read($len, $got, 4 - $got); if ($n -le 0) { return $null }; $got += $n }
  $size = [BitConverter]::ToInt32($len, 0); $buf = New-Object byte[] $size; $got = 0
  while ($got -lt $size) { $n = $stdin.Read($buf, $got, $size - $got); if ($n -le 0) { break }; $got += $n }
  return $json.DeserializeObject([Text.Encoding]::UTF8.GetString($buf, 0, $got))
}
function Send-Message($obj) {
  $b = [Text.Encoding]::UTF8.GetBytes($json.Serialize($obj))
  $stdout.Write([BitConverter]::GetBytes([int]$b.Length), 0, 4); $stdout.Write($b, 0, $b.Length); $stdout.Flush()
}
function Find-Claude {
  $c = @("$env:USERPROFILE\.local\bin\claude.exe")
  $cmd = Get-Command claude -ErrorAction SilentlyContinue; if ($cmd) { $c += $cmd.Source }
  $c += "$env:APPDATA\npm\claude.cmd"
  foreach ($p in $c) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}
function Quote($s) { '"' + ($s -replace '"', '\"') + '"' }

function Invoke-Claude($m) {
  $exe = Find-Claude
  if (-not $exe) { return @{ error = 'Claude Code is not installed on this computer (claude.exe not found).' } }
  $dir = Join-Path $env:TEMP ('rap-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $sys = Join-Path $dir '_system.txt'
    [IO.File]::WriteAllText($sys, [string]$m['system'], $utf8)
    $files = @($m['files'])
    foreach ($f in $files) { if ($f) { [IO.File]::WriteAllBytes((Join-Path $dir ([string]$f['name'])), [Convert]::FromBase64String([string]$f['base64'])) } }
    $model = if ($m['model']) { [string]$m['model'] } else { 'sonnet' }
    $tools = if ($files.Count -gt 0 -and $files[0]) { 'Read' } else { '""' }
    $args = "-p --safe-mode --no-session-persistence --output-format json --model $(Quote $model) --tools $tools --system-prompt-file $(Quote $sys)"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($exe -like '*.cmd') { $psi.FileName = $env:ComSpec; $psi.Arguments = "/c $(Quote $exe) $args" } else { $psi.FileName = $exe; $psi.Arguments = $args }
    $psi.WorkingDirectory = $dir
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    $p = [Diagnostics.Process]::Start($psi)
    $outTask = $p.StandardOutput.ReadToEndAsync(); $errTask = $p.StandardError.ReadToEndAsync()
    $bytes = $utf8.GetBytes([string]$m['prompt'])
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.Close()
    if (-not $p.WaitForExit(360000)) { try { $p.Kill() } catch {}; return @{ error = 'Claude Code took longer than 6 minutes and was stopped.' } }
    $out = $outTask.Result; $err = $errTask.Result
    $r = $null; try { $r = $json.DeserializeObject($out) } catch {}
    if (-not $r) { return @{ error = ('Claude Code gave no answer. ' + ($err + $out).Trim()).Substring(0, [Math]::Min(400, ('Claude Code gave no answer. ' + ($err + $out).Trim()).Length)) } }
    $text = [string]$r['result']
    if ($r['is_error']) {
      if ($text -match 'authenticat|log ?in|OAuth|expired') { return @{ error = 'Claude Code is not signed in, or the login expired. Open a terminal, type  claude  and press Enter, then type  /login  and follow the steps. Then try again.' } }
      return @{ error = 'Claude Code error: ' + $text }
    }
    return @{ text = $text }
  } finally { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}

function Save-File($m) {
  $dir = [Environment]::ExpandEnvironmentVariables([string]$m['dir'])
  if (-not [IO.Path]::IsPathRooted($dir)) { return @{ error = 'The save folder must be a full path, e.g. C:\Users\you\My Drive\Read Aloud' } }
  $name = ([string]$m['name']) -replace '[\\/:*?"<>|]', ' '
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $path = Join-Path $dir $name
  $i = 1; $base = [IO.Path]::GetFileNameWithoutExtension($name); $ext = [IO.Path]::GetExtension($name)
  while (Test-Path $path) { $path = Join-Path $dir "$base ($i)$ext"; $i++ }
  [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String([string]$m['base64']))
  if ($m['open']) { Start-Process -FilePath $path }
  return @{ path = [string]$path }
}

try {
  $msg = Read-Message
  if ($null -eq $msg) { exit 0 }
  switch ([string]$msg['type']) {
    'ping' { $exe = Find-Claude; if ($exe) { Send-Message @{ ok = $true; claude = $exe } } else { Send-Message @{ error = 'Claude Code is not installed on this computer.' } } }
    'run'  { Send-Message (Invoke-Claude $msg) }
    'save' { Send-Message (Save-File $msg) }
    default { Send-Message @{ error = 'Unknown request' } }
  }
} catch { Send-Message @{ error = 'Helper error: ' + $_.Exception.Message } }
