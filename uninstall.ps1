#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Uninstall this Antigravity Swarm plugin from global config or a specific workspace.
#>
param(
  [string]$Workspace = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Get-Content (Join-Path $RepoRoot "plugin\plugin.json") -Raw | ConvertFrom-Json
$Slug = $Manifest.name

if ($Workspace) {
  $PluginDest = Join-Path (Resolve-Path $Workspace) ".agents\plugins\$Slug"
} else {
  $HomeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $PluginDest = Join-Path $HomeDir ".gemini\config\plugins\$Slug"
}

if (Test-Path $PluginDest) {
  Remove-Item -Recurse -Force $PluginDest
  Write-Host "Removed Antigravity Swarm plugin '$Slug' from $PluginDest" -ForegroundColor Green
} else {
  Write-Host "Plugin '$Slug' not found at $PluginDest (nothing to remove)." -ForegroundColor Yellow
}
