# Finds where words are by READING THE SCREEN, for programs whose own word positions can't be trusted
# (Chrome, Edge and other browsers; PDF readers; anything without UI Automation text).
# Long-lived helper: one JSON request per line on stdin, one JSON reply per line on stdout.
#   {"op":"ocr","x":..,"y":..,"w":..,"h":..}   picture of that screen area -> words with boxes (screen pixels)
#   {"op":"hash","x":..,"y":..,"w":..,"h":..}  a quick fingerprint of that area, to notice scrolling
# The highlight layer is excluded from screen pictures by the app, so it never confuses recognition.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Runtime.WindowsRuntime
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class RapDpi2 { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }
"@
[void][RapDpi2]::SetProcessDpiAwarenessContext([IntPtr](-4))
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
function Reply($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class RapCap {
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  public struct R { public int L, T, Rt, B; }
  // The window's own contents (even where other windows cover it), cut to the given screen area.
  public static Bitmap Window(IntPtr h, int x, int y, int w, int hgt) {
    R r; if (!GetWindowRect(h, out r)) return null;
    using (var all = new Bitmap(r.Rt - r.L, r.B - r.T)) {
      using (var g = Graphics.FromImage(all)) { var dc = g.GetHdc(); bool ok = PrintWindow(h, dc, 2); g.ReleaseHdc(dc); if (!ok) return null; }
      var cut = new Bitmap(w, hgt);
      using (var g = Graphics.FromImage(cut)) g.DrawImage(all, new Rectangle(0, 0, w, hgt), new Rectangle(x - r.L, y - r.T, w, hgt), GraphicsUnit.Pixel);
      return cut;
    }
  }
}
"@
# True when a picture is (nearly) one colour, e.g. a window that draws with the graphics card came back empty.
function Blank($b) { $c0 = $b.GetPixel(0, 0); $diff = 0; for ($i = 1; $i -lt 400; $i++) { $c = $b.GetPixel(($i * 7919) % $b.Width, ($i * 104729) % $b.Height); if ([Math]::Abs($c.R - $c0.R) + [Math]::Abs($c.G - $c0.G) + [Math]::Abs($c.B - $c0.B) -gt 30) { $diff++ } }; $diff -lt 4 }
# A picture of the area: from the program's own window when we know it (not affected by windows on top
# of it or by our highlight), otherwise straight from the screen.
function Grab($m) {
  if ([int]$m.w -lt 20 -or [int]$m.h -lt 20) { throw 'empty area' }
  if ($m.hwnd) { $b = [RapCap]::Window([IntPtr][long]$m.hwnd, [int]$m.x, [int]$m.y, [int]$m.w, [int]$m.h); if ($b -and -not (Blank $b)) { return $b }; if ($b) { $b.Dispose() } }
  $bmp = New-Object Drawing.Bitmap ([int]$m.w), ([int]$m.h)
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([int]$m.x, [int]$m.y, 0, 0, $bmp.Size); $g.Dispose()
  $bmp
}

function Ocr($m) {
  if (-not $engine) { return @{ ok = $false; why = 'Windows text recognition is not available' } }
  $src = Grab $m
  # Small screen text is read far more accurately at double size (capped by the recogniser's limit).
  $k = [Math]::Min(2.0, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension / [Math]::Max($src.Width, $src.Height))
  $big = New-Object Drawing.Bitmap ([int]($src.Width * $k)), ([int]($src.Height * $k))
  # Stretch the contrast (faded, greyed-out or dim pages read badly): darkest 2% -> black, lightest 2% -> white.
  $lum = New-Object System.Collections.Generic.List[int]
  $step = [Math]::Max(1, [int][Math]::Sqrt($src.Width * $src.Height / 6000))
  for ($y = 0; $y -lt $src.Height; $y += $step) { for ($x = 0; $x -lt $src.Width; $x += $step) { $c = $src.GetPixel($x, $y); $lum.Add([int](0.3 * $c.R + 0.59 * $c.G + 0.11 * $c.B)) } }
  $lum.Sort(); $lo = $lum[[int]($lum.Count * 0.02)]; $hi = $lum[[int]($lum.Count * 0.98) - 1]
  $ia = New-Object Drawing.Imaging.ImageAttributes
  if ($hi - $lo -gt 20 -and ($lo -gt 10 -or $hi -lt 245)) {
    $s = 255.0 / ($hi - $lo); $o0 = -$lo / ($hi - $lo)
    $cm = New-Object Drawing.Imaging.ColorMatrix (,[single[][]]@(@([single]$s,0,0,0,0), @(0,[single]$s,0,0,0), @(0,0,[single]$s,0,0), @(0,0,0,1,0), @([single]$o0,[single]$o0,[single]$o0,0,1)))
    $ia.SetColorMatrix($cm)
  }
  $g = [Drawing.Graphics]::FromImage($big); $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($src, (New-Object Drawing.Rectangle 0, 0, $big.Width, $big.Height), 0, 0, $src.Width, $src.Height, [Drawing.GraphicsUnit]::Pixel, $ia); $g.Dispose(); $src.Dispose()
  $ms = New-Object IO.MemoryStream; $big.Save($ms, [Drawing.Imaging.ImageFormat]::Bmp); $big.Dispose()
  $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $os = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForWrite($ras); $ms.Position = 0; $ms.CopyTo($os); $os.Flush(); $ras.Seek(0)
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $words = New-Object System.Collections.ArrayList; $li = 0
  foreach ($line in $res.Lines) {
    foreach ($w in $line.Words) {
      $r = $w.BoundingRect
      [void]$words.Add(@{ t = $w.Text; l = $li; b = @([int]($m.x + $r.X / $k), [int]($m.y + $r.Y / $k), [int][Math]::Ceiling($r.Width / $k), [int][Math]::Ceiling($r.Height / $k)) })
    }
    $li++
  }
  $sb.Dispose(); $ras.Dispose(); $ms.Dispose()
  @{ ok = $true; words = $words }
}

# Fingerprint: a coarse grid of pixel samples. Changes when the content moves.
function Hash($m) {
  $bmp = Grab $m; $sb = New-Object Text.StringBuilder
  $sx = [Math]::Max(1, [int]($bmp.Width / 48)); $sy = [Math]::Max(1, [int]($bmp.Height / 48))
  for ($y = 0; $y -lt $bmp.Height; $y += $sy) { $acc = 0; for ($x = 0; $x -lt $bmp.Width; $x += $sx) { $c = $bmp.GetPixel($x, $y); $acc = ($acc * 31 + $c.R + $c.G * 3 + $c.B * 7) % 1000003 }; [void]$sb.Append($acc).Append(',') }
  $bmp.Dispose(); @{ ok = $true; h = $sb.ToString() }
}

Reply @{ ok = $true; ready = $true }
while ($true) {
  $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }
  try {
    $m = $line | ConvertFrom-Json
    switch ($m.op) { 'ocr' { Reply (Ocr $m) } 'hash' { Reply (Hash $m) } default { Reply @{ ok = $false; why = 'unknown op' } } }
  } catch { Reply @{ ok = $false; why = ($_.Exception.Message -split "`n")[0] } }
}
