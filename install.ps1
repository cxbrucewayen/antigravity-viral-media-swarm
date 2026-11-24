#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Install this Antigravity Swarm plugin globally (~/.gemini/config/plugins/<slug>)
  or scoped to a single workspace (<Workspace>/.agents/plugins/<slug>).
#>
param(
  [string]$Workspace = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginSrc = Join-Path $RepoRoot "plugin"
$Manifest = Get-Content (Join-Path $PluginSrc "plugin.json") -Raw | ConvertFrom-Json
$Slug = $Manifest.name

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js (>= 20) is required to run hooks and validation."
}

Write-Host "==> [1/3] Validating Antigravity plugin spec for '$Slug'..." -ForegroundColor Cyan
& node (Join-Path $RepoRoot "scripts\validate-plugin.mjs") --plugin $PluginSrc
if ($LASTEXITCODE -ne 0) { throw "Plugin validation failed." }

if ($Workspace) {
  $DestBase = Join-Path (Resolve-Path $Workspace) ".agents\plugins"
  $ScopeLabel = "workspace ($Workspace)"
} else {
  $HomeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $DestBase = Join-Path $HomeDir ".gemini\config\plugins"
  $ScopeLabel = "global (~/.gemini/config/plugins)"
}

$PluginDest = Join-Path $DestBase $Slug
Write-Host "==> [2/3] Deploying plugin to $PluginDest ($ScopeLabel)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $DestBase | Out-Null
if (Test-Path $PluginDest) { Remove-Item -Recurse -Force $PluginDest }
Copy-Item -Recurse -Force $PluginSrc $PluginDest

Write-Host "==> [3/3] Running automated hook & coexistence test suite..." -ForegroundColor Cyan
Push-Location $RepoRoot
try {
  & node --test tests/*.test.mjs
  if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
} finally {
  Pop-Location
}

Write-Host "`nSUCCESS! Installed Antigravity Swarm plugin '$Slug' -> $PluginDest" -ForegroundColor Green
Write-Host "Tip: Antigravity loads plugins automatically on your next turn. Launch with: /swarm 启动 $Slug ..." -ForegroundColor Yellow
