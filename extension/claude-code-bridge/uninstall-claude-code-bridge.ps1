# Removes the Read Aloud Pro helper registration from Chrome and Edge (your user only).
$name = 'com.readaloudpro.claude'
foreach ($key in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$name")) {
  Remove-Item -Path $key -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "$name.json") -Force -ErrorAction SilentlyContinue
Write-Host 'Read Aloud Pro helper removed. Restart Chrome.' -ForegroundColor Green
Read-Host 'Press Enter to close'
