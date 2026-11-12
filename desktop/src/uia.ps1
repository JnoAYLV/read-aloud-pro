# Finds where words are on screen in another program, using Windows UI Automation (the accessibility
# system screen readers use). Runs as a long-lived helper: one JSON request per line on stdin, one JSON
# reply per line on stdout. It only READS positions; it never types, selects or changes the document,
# except that it may scroll the document so the sentence being read is visible.
#
# Requests:
#   {"op":"attach","hwnd":123}            find the text the person highlighted in that window
#   {"op":"sentence","i":4,"first":"The","last":"minutes","len":120}   locate sentence i, return its line boxes
#   {"op":"word","text":"departure"}      next occurrence of this word inside the current sentence, return its box
#   {"op":"detach"}
# Every reply: {"ok":true,...} or {"ok":false,"why":"..."}. Boxes are screen pixels [x,y,w,h].
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class RapDpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }
"@
[void][RapDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))     # real pixel positions on every monitor
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$AE = [System.Windows.Automation.AutomationElement]; $TP = [System.Windows.Automation.TextPattern]
$EP = [System.Windows.Automation.Text.TextPatternRangeEndpoint]; $TU = [System.Windows.Automation.Text.TextUnit]

$state = @{ tp = $null; el = $null; sel = $null; cursor = $null; sent = $null; word = $null; wcur = $null; cache = @{}; hwnd = $null; lastSent = $null; terms = $null }
function Reply($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
# The visible part of the document. Boxes outside it are dropped and boxes across its edge are clipped,
# so nothing is ever drawn over toolbars or other parts of the window after scrolling.
function View { try { $v = $state.el.Current.BoundingRectangle; if ($v.Width -gt 0) { return $v } } catch {}; $null }
function Boxes($range, $view = (View)) {
  $out = @(); $r = $range.GetBoundingRectangles()
  foreach ($b in $r) {
    if ($b.Width -le 2 -or $b.Height -le 0) { continue }
    $x1 = $b.X; $y1 = $b.Y; $x2 = $b.X + $b.Width; $y2 = $b.Y + $b.Height
    if ($view) { $x1 = [Math]::Max($x1, $view.X); $y1 = [Math]::Max($y1, $view.Y); $x2 = [Math]::Min($x2, $view.X + $view.Width); $y2 = [Math]::Min($y2, $view.Y + $view.Height) }
    if ($x2 - $x1 -gt 2 -and $y2 - $y1 -gt 2) { $out += ,@([int]$x1, [int]$y1, [int]($x2 - $x1), [int]($y2 - $y1)) }
  }
  ,$out
}
# Chrome and Edge sometimes return a found word shifted by a character after hidden formatting
# ("afety " for "Safety"). Check the text and slide the range back into place.
function Fit($r, $needle) {
  if (-not $r) { return $r }
  $want = $needle.ToLowerInvariant()
  if ($r.GetText(400).ToLowerInvariant() -eq $want) { return $r }
  foreach ($shift in -1, -2, 1, 2) {
    $c = $r.Clone()
    [void]$c.MoveEndpointByUnit($EP::Start, $TU::Character, $shift); [void]$c.MoveEndpointByUnit($EP::End, $TU::Character, $shift)
    if ($c.GetText(400).ToLowerInvariant() -eq $want) { return $c }
  }
  $r
}
function FindFit($range, $needle, $ignoreCase) { Fit ($range.FindText($needle, $false, $ignoreCase)) $needle }
# A range from the start of $a to the end of $b.
function Span($a, $b) { $r = $a.Clone(); $r.MoveEndpointByRange($EP::End, $b, $EP::End); $r }
# Range covering [from, end of the highlighted text].
function Rest($from) { $r = $state.sel.Clone(); $r.MoveEndpointByRange($EP::Start, $from, $EP::Start); $r }
function Clean($w) { ($w -replace '^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$', '') }

function Attach($hwnd) {
  $state.hwnd = $hwnd
  $root = $AE::FromHandle([IntPtr][long]$hwnd)
  $cands = New-Object System.Collections.ArrayList
  try { $f = $AE::FocusedElement; if ($f) { [void]$cands.Add($f) } } catch {}
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::IsTextPatternAvailableProperty, $true)
  try { foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) { [void]$cands.Add($e) } } catch {}
  foreach ($e in $cands) {
    $p = $null
    if (-not $e.TryGetCurrentPattern($TP::Pattern, [ref]$p)) { continue }
    $sels = $null; try { $sels = $p.GetSelection() } catch { continue }
    if (-not $sels -or $sels.Length -eq 0) { continue }
    $s = $sels[0]; $txt = $s.GetText(200000)
    if ($txt.Trim().Length -lt 1) { continue }
    $state.tp = $p; $state.el = $e; $state.sel = $s; $state.cursor = $s.Clone(); $state.cursor.MoveEndpointByRange($EP::End, $s, $EP::Start)
    $state.cache = @{}; $state.sent = $null; $state.anchors = $null
    $fw = ''; try { $fw = [string]$e.Current.FrameworkId } catch {}
    return @{ ok = $true; chars = $txt.Length; framework = $fw; control = $e.Current.ControlType.ProgrammaticName -replace 'ControlType\.', '' }
  }
  @{ ok = $false; why = 'This program does not share word positions, or nothing is highlighted in it.' }
}

function Sentence($m) {
  $state.lastSent = $m
  if (-not $state.sel) { return @{ ok = $false; why = 'not attached' } }
  $key = [string]$m.i
  if ($state.cache.ContainsKey($key)) { $sr = $state.cache[$key] }
  else {
    $first = Clean $m.first; $last = Clean $m.last
    if (-not $first) { return @{ ok = $false; why = 'no first word' } }
    $a = FindFit (Rest $state.cursor) $first $false
    if (-not $a) { return @{ ok = $false; why = 'first word not found' } }
    $sr = $a
    if ($last -and $m.len -gt $first.Length + 2) {
      # The last word may also occur earlier in the sentence: take the first occurrence that makes the
      # span about as long as the sentence.
      $from = $a
      for ($k = 0; $k -lt 12; $k++) {
        $b = FindFit (Rest $from) $last $false; if (-not $b) { break }
        $cand = Span $a $b; $len = $cand.GetText(5000).Length
        $sr = $cand; if ($len -ge [int]($m.len * 0.8)) { break }
        $from = $b.Clone(); $from.MoveEndpointByRange($EP::Start, $b, $EP::End)
      }
    }
    $state.cache[$key] = $sr
    $state.cursor = $sr.Clone(); $state.cursor.MoveEndpointByRange($EP::Start, $sr, $EP::End)
  }
  $state.sent = $sr; $state.word = $null; $state.wcur = $sr.Clone(); $state.wcur.MoveEndpointByRange($EP::End, $sr, $EP::Start)
  $bx = Boxes $sr
  if ($bx.Count -eq 0 -and $m.scroll) { try { $sr.ScrollIntoView($false); Start-Sleep -Milliseconds 60; $bx = Boxes $sr } catch {} }
  @{ ok = $true; boxes = $bx }
}

function Word($m) {
  if (-not $state.sent) { return @{ ok = $false; why = 'no sentence' } }
  $w = Clean $m.text; if (-not $w) { return @{ ok = $false; why = 'empty' } }
  $rest = $state.wcur.Clone(); $rest.MoveEndpointByRange($EP::End, $state.sent, $EP::End)
  $f = FindFit $rest $w $false
  if (-not $f) { return @{ ok = $false; why = 'word not found' } }
  $state.word = $f; $state.wcur = $f.Clone(); $state.wcur.MoveEndpointByRange($EP::Start, $f, $EP::End)
  @{ ok = $true; boxes = (Boxes $f); sent = (Boxes $state.sent) }
}

# Programs sometimes invalidate the text positions they gave out (after a redraw or an edit). When that
# happens, find the highlighted text again, re-find the current sentence, and try the request once more.
function Retry([scriptblock]$op) {
  try { & $op } catch {
    if (-not $state.hwnd) { throw }
    $a = Attach $state.hwnd
    if (-not $a.ok) { return @{ ok = $false; why = 'lost the text: ' + $a.why } }
    if ($state.lastSent) { $null = Sentence $state.lastSent }
    & $op
  }
}
# Your name and word-group hits: find every occurrence inside the highlighted text once, keep the ranges,
# and re-measure them on request (they move when the document scrolls).
function Terms($m) {
  if (-not $state.sel) { return @{ ok = $false; why = 'not attached' } }
  $state.terms = New-Object System.Collections.ArrayList
  foreach ($it in $m.items) {
    $t = [string]$it.t; if (-not $t.Trim()) { continue }
    $from = $state.sel.Clone()
    for ($k = 0; $k -lt 200 -and $state.terms.Count -lt 400; $k++) {
      $f = FindFit $from $t $true; if (-not $f) { break }
      [void]$state.terms.Add(@{ c = [string]$it.c; r = $f })
      $from.MoveEndpointByRange($EP::Start, $f, $EP::End)
    }
  }
  TermBoxes
}
function TermBoxes {
  if (-not $state.terms) { return @{ ok = $true; terms = @() } }
  $v = View; $out = @(); foreach ($x in $state.terms) { $b = Boxes $x.r $v; if ($b.Count) { $out += ,@{ c = $x.c; boxes = $b } } }
  @{ ok = $true; terms = $out; count = $state.terms.Count }
}
# A cheap "has the document moved?" check: where a few known ranges are right now (unclipped).
function Probe {
  $sig = @()
  # Anchors that only move when the document moves: first and last character of the highlighted text,
  # plus a few name/word-group hits. (Not the sentence being read: that changes as reading goes on.)
  if (-not $state.anchors) { $a = $state.sel.Clone(); [void]$a.MoveEndpointByUnit($EP::End, $TU::Character, -[Math]::Max(0, $state.sel.GetText(200000).Length - 1)); $z = $state.sel.Clone(); [void]$z.MoveEndpointByUnit($EP::Start, $TU::Character, [Math]::Max(0, $state.sel.GetText(200000).Length - 1)); $state.anchors = @($a, $z) }
  foreach ($r in @($state.anchors) + @($state.terms | Select-Object -First 4 | % { $_.r })) {
    if ($r) { try { $b = $r.GetBoundingRectangles(); if ($b.Length) { $sig += '{0},{1}' -f [int]$b[0].X, [int]$b[0].Y } else { $sig += '-' } } catch { $sig += 'x' } }
  }
  @{ ok = $true; sig = ($sig -join ';') }
}
# Everything at once, after scrolling stops.
function Refresh {
  $v = View
  $t = TermBoxes
  @{ ok = $true; sent = $(if ($state.sent) { Boxes $state.sent $v } else { @() }); word = $(if ($state.word) { Boxes $state.word $v } else { @() }); terms = $t.terms }
}
# The on-screen area of a window's main document (web page, PDF, message body), for screen reading.
function DocRect($hwnd) {
  try {
    $root = $AE::FromHandle([IntPtr][long]$hwnd)
    $d = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
    if ($d) { $r = $d.Current.BoundingRectangle; if ($r.Width -gt 50 -and $r.Height -gt 50) { return @{ ok = $true; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } } }
  } catch {}
  @{ ok = $false }
}
# ---------------------------------------------------------------- Microsoft Word: its own automation
# Word does not share its text through UI Automation, but Word itself can say exactly where any range of
# text is on screen (Window.GetPoint) and scroll to it. Read-only: it finds and measures, never edits.
function WBox($r) {
  $l = 0; $t = 0; $w = 0; $h = 0
  try { $state.wwin.GetPoint([ref]$l, [ref]$t, [ref]$w, [ref]$h, $r) } catch { return $null }
  if ($w -le 0 -or $h -le 0) { return $null }
  @([int]$l, [int]$t, [int]$w, [int]$h)
}
function WLines($r) {                      # one box per line of a sentence: measure each word, merge by line
  $lines = [ordered]@{}
  foreach ($wd in $r.Words) { $b = WBox $wd; if (-not $b) { continue }; $k = [string]$b[1]
    if ($lines.Contains($k)) { $o = $lines[$k]; $x2 = [Math]::Max($o[0] + $o[2], $b[0] + $b[2]); $o[0] = [Math]::Min($o[0], $b[0]); $o[2] = $x2 - $o[0]; $o[3] = [Math]::Max($o[3], $b[3]) } else { $lines[$k] = @($b[0], $b[1], $b[2], $b[3]) } }
  ,@($lines.Values)
}
function WFind($from, $to, $needle) {      # first occurrence of $needle in the document between two positions
  $r = $state.wdoc.Range($from, $to); $f = $r.Find; $f.ClearFormatting(); $f.MatchCase = $false; $f.MatchWholeWord = $false; $f.Forward = $true; $f.Wrap = 0
  if ($f.Execute($needle)) { return $r }; $null
}
function WordAttach($hwnd) {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  $win = $null; foreach ($w in $app.Windows) { try { if ([long]$w.Hwnd -eq [long]$hwnd) { $win = $w } } catch {} }
  if (-not $win) { $win = $app.ActiveWindow }
  $sel = $win.Selection.Range
  if ($sel.End - $sel.Start -lt 1) { return @{ ok = $false; why = 'Nothing is highlighted in Word.' } }
  $state.kind = 'word'; $state.wapp = $app; $state.wwin = $win; $state.wdoc = $win.Document
  $state.ws = $sel.Start; $state.we = $sel.End; $state.wcursor = $sel.Start; $state.wcache = @{}; $state.wsent = $null; $state.wword = $null; $state.wterms = @()
  @{ ok = $true; framework = 'Word'; chars = $sel.End - $sel.Start }
}
function WordSentence($m) {
  $key = [string]$m.i
  if ($state.wcache.ContainsKey($key)) { $sr = $state.wcache[$key] }
  else {
    $first = Clean $m.first; $last = Clean $m.last
    $a = WFind $state.wcursor $state.we $first; if (-not $a) { return @{ ok = $false; why = 'first word not found' } }
    $end = $a.End
    if ($last -and $m.len -gt $first.Length + 2) {
      $from = $a.End
      for ($k = 0; $k -lt 12; $k++) { $b = WFind $from $state.we $last; if (-not $b) { break }; $end = $b.End; if ($end - $a.Start -ge [int]($m.len * 0.8)) { break }; $from = $b.End }
    }
    $sr = $state.wdoc.Range($a.Start, $end); $state.wcache[$key] = $sr; $state.wcursor = $end
  }
  $state.wsent = $sr; $state.wword = $null; $state.wwcur = $sr.Start
  $bx = WLines $sr
  if ($bx.Count -eq 0 -and $m.scroll) { try { $state.wwin.ScrollIntoView($sr, $true); Start-Sleep -Milliseconds 80; $bx = WLines $sr } catch {} }
  @{ ok = $true; boxes = $bx }
}
function WordWord($m) {
  if (-not $state.wsent) { return @{ ok = $false; why = 'no sentence' } }
  $w = Clean $m.text; if (-not $w) { return @{ ok = $false; why = 'empty' } }
  $f = WFind $state.wwcur $state.wsent.End $w; if (-not $f) { return @{ ok = $false; why = 'word not found' } }
  $state.wword = $f; $state.wwcur = $f.End
  $b = WBox $f
  @{ ok = $true; boxes = $(if ($b) { ,@(,$b) } else { @() }); sent = (WLines $state.wsent) }
}
function WordTerms($m) {
  $state.wterms = New-Object System.Collections.ArrayList
  foreach ($it in $m.items) { $t = [string]$it.t; if (-not $t.Trim()) { continue }; $from = $state.ws
    for ($k = 0; $k -lt 200 -and $state.wterms.Count -lt 400; $k++) { $f = WFind $from $state.we $t; if (-not $f) { break }; [void]$state.wterms.Add(@{ c = [string]$it.c; r = $f }); $from = $f.End } }
  WordTermBoxes
}
function WordTermBoxes { $out = @(); foreach ($x in $state.wterms) { $b = WBox $x.r; if ($b) { $out += ,@{ c = $x.c; boxes = ,@(,$b) } } }; @{ ok = $true; terms = $out; count = $state.wterms.Count } }
function WordProbe {                       # moves when Word scrolls, zooms or the window moves
  $b = WBox ($state.wdoc.Range($state.ws, [Math]::Min($state.ws + 1, $state.we)))
  $p = ''; try { $p = [string]$state.wwin.ActivePane.VerticalPercentScrolled } catch {}
  @{ ok = $true; sig = (($b -join ',') + '|' + $p) }
}
function WordRefresh {
  $t = WordTermBoxes
  $wb = if ($state.wword) { WBox $state.wword } else { $null }
  @{ ok = $true; sent = $(if ($state.wsent) { WLines $state.wsent } else { @() }); word = $(if ($wb) { ,@(,$wb) } else { @() }); terms = $t.terms }
}
# ---------------------------------------------------------------- Claude Watch: the Claude desktop app
# Reads (never changes) the Claude app's page text, the text in its message box, and, where the chat marks
# Claude's replies, the latest marked reply. The app decides what is new; this only reports what is there.
$cw = @{ hwnd = 0; doc = $null; tp = $null; composer = $null; markersAt = 0; marker = $null }
function ClaudeFind {
  $p = Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -notmatch '\\\.local\\bin\\' } | Select-Object -First 1
  if (-not $p) { $cw.hwnd = 0; $cw.doc = $null; return $false }
  if ($cw.doc -and $cw.hwnd -eq [long]$p.MainWindowHandle) { return $true }
  $root = $AE::FromHandle($p.MainWindowHandle)
  $docs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
  if ($docs.Count -eq 0) { return $false }                       # the app switches its accessibility on lazily: try again next time
  $best = $null; $bestN = -1
  foreach ($d in $docs) { $n = $d.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition).Count; if ($n -gt $bestN) { $bestN = $n; $best = $d } }
  $pat = $null; if (-not $best.TryGetCurrentPattern($TP::Pattern, [ref]$pat)) { return $false }
  $cw.hwnd = [long]$p.MainWindowHandle; $cw.doc = $best; $cw.tp = $pat; $cw.composer = $null; $cw.markersAt = 0
  $true
}
function ClaudeRead {
  try {
    if (-not (ClaudeFind)) { return @{ ok = $false; why = 'Claude window not found' } }
    $text = $cw.tp.DocumentRange.GetText(-1)
    # The message box (where the person types or dictates), found once and re-found if it goes away.
    $comp = ''
    if (-not $cw.composer) { foreach ($e in $cw.doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { if ($e.Current.ClassName -match '(^|\s)ProseMirror(\s|$)') { $cw.composer = $e; break } } }
    $compAt = -1
    if ($cw.composer) {
      try {
        $cr = $cw.tp.RangeFromChild($cw.composer); $comp = $cr.GetText(20000)
        # Where the message box starts in the page text: replies appear before it; menus and pop-ups after it.
        $pre = $cw.tp.DocumentRange.Clone(); $pre.MoveEndpointByRange($EP::End, $cr, $EP::Start); $compAt = $pre.GetText(-1).Length
      } catch { $cw.composer = $null }
    }
    # Claude chat marks replies (font-claude-response / font-claude-message). Look for them every 10 s.
    $last = $null
    if ([Environment]::TickCount - $cw.markersAt -gt 10000) {
      $cw.markersAt = [Environment]::TickCount; $cw.marker = $null
      foreach ($e in $cw.doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { if ($e.Current.ClassName -match '(^|\s)font-claude-(response|message)(\s|$)') { $cw.marker = $true; break } }
    }
    if ($cw.marker) {
      $els = $cw.doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.ClassName -match '(^|\s)font-claude-(response|message)(\s|$)' }
      $l = @($els)[-1]; if ($l) { try { $last = $cw.tp.RangeFromChild($l).GetText(200000) } catch {} }
    }
    @{ ok = $true; text = $text; composer = $comp; compAt = $compAt; last = $last }
  } catch { $cw.doc = $null; @{ ok = $false; why = ($_.Exception.Message -split "`n")[0] } }
}
# The names of the buttons in the conversation. The grey step lines in a reply ("Searched code, ran 3 commands…")
# are buttons, so the app can leave their text out. Asked only when a reply is about to be read.
function ClaudeButtons {
  try {
    if (-not (ClaudeFind)) { return @{ ok = $false; why = 'Claude window not found' } }
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $names = New-Object System.Collections.Generic.HashSet[string]
    foreach ($b in $cw.doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) { $n = $b.Current.Name; if ($n -and $n.Trim().Length -gt 0) { [void]$names.Add($n.Trim()) } }
    @{ ok = $true; names = @($names) }
  } catch { $cw.doc = $null; @{ ok = $false; why = ($_.Exception.Message -split "`n")[0] } }
}
Reply @{ ok = $true; ready = $true }
while ($true) {
  $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }
  try {
    $m = $line | ConvertFrom-Json
    switch ($m.op) {
      'attach'   { $state.kind = 'uia'; if ($m.cls -eq 'OpusApp') { try { Reply (WordAttach $m.hwnd) } catch { Reply @{ ok = $false; why = 'Word: ' + ($_.Exception.Message -split "`n")[0] } } } else { Reply (Attach $m.hwnd) } }
      'sentence' { if ($state.kind -eq 'word') { Reply (WordSentence $m) } else { Reply (Retry { Sentence $m }) } }
      'word'     { if ($state.kind -eq 'word') { Reply (WordWord $m) } else { Reply (Retry { Word $m }) } }
      'terms'    { if ($state.kind -eq 'word') { Reply (WordTerms $m) } else { Reply (Retry { Terms $m }) } }
      'termboxes' { Reply (Retry { TermBoxes }) }
      'probe'    { if ($state.kind -eq 'word') { Reply (WordProbe) } else { Reply (Retry { Probe }) } }
      'docrect'  { Reply (DocRect $m.hwnd) }
      'claude'   { Reply (ClaudeRead) }
      'claudebuttons' { Reply (ClaudeButtons) }
      'refresh'  { if ($state.kind -eq 'word') { Reply (WordRefresh) } else { Reply (Retry { Refresh }) } }
      'detach'   { $state.sel = $null; $state.sent = $null; $state.cache = @{}; $state.terms = $null; Reply @{ ok = $true } }
      default    { Reply @{ ok = $false; why = 'unknown op' } }
    }
  } catch { Reply @{ ok = $false; why = ($_.Exception.Message -split "`n")[0] } }
}
