# Opens a NEW, UNSENT Outlook draft (classic Outlook) for the person to review and send themselves.
# This script never sends: there is no call to Send() anywhere in it.
# Input: path to a JSON file {subject, to, cc, html}. Output: "OK" or an error line.
param([Parameter(Mandatory)][string]$JsonPath)
$ErrorActionPreference = 'Stop'
try {
  $d = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $ol = New-Object -ComObject Outlook.Application
  $mail = $ol.CreateItem(0)                    # 0 = olMailItem
  if ($d.subject) { $mail.Subject = $d.subject }
  if ($d.to) { $mail.To = $d.to }
  if ($d.cc) { $mail.CC = $d.cc }
  $mail.Display($false)                        # show the compose window first so the default signature is added
  $sig = $mail.HTMLBody
  $mail.HTMLBody = $d.html + $sig
  'OK'
} catch {
  'ERROR ' + $_.Exception.Message
}
