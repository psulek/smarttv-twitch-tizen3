<#
.SYNOPSIS
    Builds, signs, installs and launches the app on a Samsung TV, without opening Tizen Studio.

.DESCRIPTION
    1. Writes app/build_info.js (build PC/user/date shown in the About dialog)
    2. Connects to the TV with sdb
    3. tizen build-web  -> app/.buildResult, switched to release mode (Main_isReleased = true) unless -TestMode
    4. tizen package    -> signs the .wgt with your Tizen Studio certificate profile
    5. tizen install    -> installs the .wgt on the TV
    6. tizen run        -> launches the app (skip with -NoRun)

    The TV must be in Developer Mode with this PC IP set as "Host PC IP".

.EXAMPLE
    .\release\deploy_tv.ps1
.EXAMPLE
    .\release\deploy_tv.ps1 -TvIp 192.168.1.50 -CertProfile MyProfile -NoRun
#>
param(
    [string]$TvIp = '192.168.1.50',
    [int]$TvPort = 26101,
    # Tizen Studio certificate profile, empty = the active profile
    [string]$CertProfile = '',
    [string]$TizenStudio = 'C:\tizen-studio',
    [switch]$NoRun,
    # keep Main_isReleased = false: shows the red "TEST ONLY" warning, enables the green key reload and extra logs
    [switch]$TestMode
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repo 'app'
$buildDir = Join-Path $appDir '.buildResult'
$tizen = Join-Path $TizenStudio 'tools\ide\bin\tizen.bat'
$sdb = Join-Path $TizenStudio 'tools\sdb.exe'
$target = "${TvIp}:${TvPort}"

function Step($text) {
    Write-Host ''
    Write-Host "== $text" -ForegroundColor Cyan
}

# tizen.bat doesn't always return a error exit code, so also check its output
function Invoke-Tizen([string[]]$arguments, [string]$failPattern) {
    $output = & $tizen @arguments 2>&1 | Out-String
    # skip empty lines and the install/build progress lines
    Write-Host (($output -split "`r?`n" | Where-Object { $_.Trim() -and $_ -notmatch 'installing\[\d+\]|Build Web Application:' }) -join "`n")
    if ($LASTEXITCODE -ne 0 -or ($failPattern -and $output -match $failPattern)) {
        throw "tizen $($arguments[0]) failed"
    }
    return $output
}

foreach ($tool in @($tizen, $sdb)) {
    if (-not (Test-Path $tool)) { throw "Not found: $tool (set -TizenStudio to your Tizen Studio folder)" }
}

# app id and package name come from config.xml
[xml]$config = Get-Content (Join-Path $appDir 'config.xml')
$appId = $config.widget.application.id
$appName = $config.widget.name
Write-Host "App: $appName ($appId)  TV: $target"

Step 'Build info'
& node (Join-Path $PSScriptRoot 'stamp_build.js')
if ($LASTEXITCODE -ne 0) { throw 'node release/stamp_build.js failed (is Node.js installed?)' }

Step "Connect to TV $target"
& $sdb connect $target | Write-Host
$devices = & $sdb devices | Out-String
if ($devices -notmatch [regex]::Escape($target) + '\s+device') {
    Write-Host $devices
    throw "TV $target is not connected. Check the TV is on, Developer Mode is on and Host PC IP is this PC."
}

Step 'Build'
if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
Invoke-Tizen @('build-web', '-out', '.buildResult', '--', $appDir) 'error|fail' | Out-Null

if (-not $TestMode) {
    # release mode only in the build copy, app/specific/Main.js stays in test mode for browser testing
    $mainJs = Join-Path $buildDir 'specific\Main.js'
    $source = [IO.File]::ReadAllText($mainJs)
    $released = $source.Replace('var Main_isReleased = false;', 'var Main_isReleased = true;')
    if ($released -eq $source) { throw "Couldn't set Main_isReleased = true in $mainJs" }
    [IO.File]::WriteAllText($mainJs, $released)
    Write-Host 'Release mode: Main_isReleased = true'
} else {
    Write-Host 'Test mode: Main_isReleased = false'
}

Step 'Package and sign'
$packageArgs = @('package', '-t', 'wgt')
if ($CertProfile) { $packageArgs += @('-s', $CertProfile) }
$packageArgs += @('--', $buildDir)
Invoke-Tizen $packageArgs 'error|fail' | Out-Null

$wgt = Get-ChildItem $buildDir -Filter *.wgt | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $wgt) { throw "No .wgt found in $buildDir" }

# the package is named after <name> in config.xml, tizen install fails without a reason when the name has spaces
$wgt = Move-Item $wgt.FullName (Join-Path $buildDir "$appId.wgt") -Force -PassThru
Write-Host "Package: $($wgt.FullName)"

Step 'Install on TV'
$installOutput = Invoke-Tizen @('install', '-n', $wgt.Name, '-s', $target, '--', $buildDir) 'Failed to install'
if ($installOutput -notmatch 'successfully installed') { throw 'tizen install failed' }

if (-not $NoRun) {
    Step 'Launch'
    Invoke-Tizen @('run', '-p', $appId, '-s', $target) 'error|fail' | Out-Null
}

Write-Host ''
Write-Host "Done: $appName deployed to $target" -ForegroundColor Green
