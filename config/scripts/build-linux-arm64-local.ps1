<#
.SYNOPSIS
Builds an unpacked Linux arm64 Orca (Electron, `orca-ide --serve` capable) from this worktree
with rootful Podman in a WSL distro. See docs/readme/remote-browser-element-selection-implementation.md.
#>
[CmdletBinding()]
param(
  [string]$Distro = 'podman-machine-default',
  [string]$WorkRoot = '/var/lib/orca-local-build/linux-arm64',
  [string]$OutputDir,
  [ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$')]
  [string]$Version = '1.4.229-remote-picker.1',
  [ValidateSet('javascript', 'package')]
  [string[]]$Stages = @('javascript', 'package'),
  [switch]$SkipImages,
  [switch]$AdoptExistingStaging
)
$ErrorActionPreference = 'Stop'

function Invoke-Native {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program exited $LASTEXITCODE" }
}

$repo = (git -C $PSScriptRoot rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { throw 'Not inside the Orca git checkout.' }
$repoWsl = wsl.exe -d $Distro --exec wslpath -a $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the source WSL path.' }
$driver = (Get-Content (Join-Path $PSScriptRoot 'build-linux-arm64-local.sh') -Raw) -replace "`r", ''
# Reject unsafe destinations before writing a snapshot or touching either staging checkout.
Invoke-Native wsl.exe @('-d', $Distro, '--user', 'root', '--exec', 'bash', '-c', $driver,
  'build-linux-arm64-local', 'validate', $WorkRoot, $repoWsl)
if (-not $OutputDir) { $OutputDir = Join-Path $repo '.tmp/linux-arm64-build' }
New-Item -ItemType Directory -Force $OutputDir | Out-Null
$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

# A scratch index captures dirty source with LF endings without changing the user's index.
$index = Join-Path $OutputDir ([System.IO.Path]::GetRandomFileName() + '.index')
$priorIndex = $env:GIT_INDEX_FILE
$sourceIndex = git -C $repo rev-parse --git-path index
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the source Git index.' }
if (-not [System.IO.Path]::IsPathRooted($sourceIndex)) { $sourceIndex = Join-Path $repo $sourceIndex }
Copy-Item -LiteralPath $sourceIndex -Destination $index
$env:GIT_INDEX_FILE = $index
try {
  Invoke-Native git @('-C', $repo, 'add', '-A')
  $tree = git -C $repo write-tree
  if ($LASTEXITCODE -ne 0) { throw 'git write-tree failed' }
} finally {
  if ($null -eq $priorIndex) { Remove-Item Env:GIT_INDEX_FILE }
  else { $env:GIT_INDEX_FILE = $priorIndex }
  Remove-Item -LiteralPath $index
}
$base = git -C $repo rev-parse HEAD
$snapshot = git -C $repo commit-tree $tree -p $base -m 'Local Linux arm64 build snapshot'
if ($LASTEXITCODE -ne 0) { throw 'git commit-tree failed' }
Write-Host "[linux-arm64-local] base $base snapshot $snapshot"

$outputWsl = wsl.exe -d $Distro --exec wslpath -a $OutputDir
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the output WSL path.' }

# Keep the upstream HEAD for official skill pins and retain ignored dependency caches.
$adopt = if ($AdoptExistingStaging) { '1' } else { '0' }
Invoke-Native wsl.exe @('-d', $Distro, '--user', 'root', '--exec', 'bash', '-c', $driver,
  'build-linux-arm64-local', 'sync', $WorkRoot, $repoWsl, $base, $snapshot, $adopt)

$skip = if ($SkipImages) { '1' } else { '0' }
Invoke-Native wsl.exe @('-d', $Distro, '--user', 'root', '--exec', 'env',
  "ORCA_LINUX_BUILD_WORK=$WorkRoot", "ORCA_LINUX_BUILD_STAGES=$($Stages -join ' ')",
  "ORCA_LINUX_BUILD_SKIP_IMAGES=$skip", "ORCA_LOCAL_BUILD_VERSION=$Version",
  'bash', "$WorkRoot/x64/config/scripts/build-linux-arm64-local.sh", 'host')

if ($Stages -contains 'package') {
  $name = wsl.exe -d $Distro --user root --exec cat "$WorkRoot/artifacts/latest-artifact"
  if ($LASTEXITCODE -ne 0 -or $name -notmatch '^orca-linux-arm64-unpacked-[a-zA-Z0-9.-]+$') {
    throw 'Invalid artifact name from the build.'
  }
  Invoke-Native wsl.exe @('-d', $Distro, '--user', 'root', '--exec', 'sh', '-c',
    'for suffix in .tar.gz .tar.gz.sha256 .tar.gz.build.json; do cp -- "$1/artifacts/$2$suffix" "$3/"; done',
    'sh', $WorkRoot, $name, $outputWsl)
  Get-ChildItem -LiteralPath $OutputDir -Filter "$name*" | Format-Table Name, Length
}
