# Reads the text in a PNG with the text recognition built into Windows (offline, free).
# Prints JSON lines: {"t":"text","y":top,"h":height,"x":left} so the app can rebuild paragraphs.
param([Parameter(Mandatory)][string]$Png)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Png)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows text recognition is not available for your language.' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$out = foreach ($line in $result.Lines) {
  $rects = @($line.Words | ForEach-Object { $_.BoundingRect })
  $y = ($rects | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
  $x = ($rects | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
  $h = ($rects | ForEach-Object { $_.Height } | Measure-Object -Maximum).Maximum
  [pscustomobject]@{ t = $line.Text; y = [int]$y; h = [int]$h; x = [int]$x }
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
@($out) | ConvertTo-Json -Compress
