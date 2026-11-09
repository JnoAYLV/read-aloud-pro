# Publishes a new version of Read Aloud Pro to GitHub, where every installed copy picks it up automatically.
#   cd "C:\Users\offic\Documents\Read Aloud Pro\desktop"
#   powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Notes "What changed, in one or two lines"
# Optional: -Bump minor (1.1.x -> 1.2.0) or -Bump major. Default is patch (1.1.0 -> 1.1.1).
# Needs: GitHub CLI signed in as JnoAYLV (gh auth status). Success looks like "Released vX.Y.Z" and a link.
param([string]$Notes = "Improvements and fixes.", [ValidateSet('patch','minor','major')][string]$Bump = 'patch')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$login = (gh api user --jq .login) 2>$null
if ($login -ne 'JnoAYLV') { throw "GitHub CLI is not signed in as JnoAYLV (got '$login'). Run: gh auth login" }

# 1. New version number
npm version $Bump --no-git-tag-version | Out-Null
$v = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "Building version $v..."

# 2. Rebuild generated pages, then the installer and the update manifest (latest.yml)
node tools\make-settings.js | Out-Null
node tools\make-manual.js | Out-Null
npx electron-builder --win nsis --publish never
$exe = "dist\Read-Aloud-Pro-Setup-$v.exe"
foreach ($f in @($exe, "$exe.blockmap", 'dist\latest.yml')) { if (-not (Test-Path $f)) { throw "Build output missing: $f" } }

# 3. Save the code to GitHub
Set-Location ..
git add -A
git commit -m "Release v$v`n`n$Notes" | Out-Null
git push origin main

# 4. Publish the release. Installed copies check for it within 4 hours (or on their next start).
Set-Location desktop
gh release create "v$v" $exe "$exe.blockmap" 'dist\latest.yml' --title "Read Aloud Pro $v" --notes $Notes
Write-Host "Released v$v"
