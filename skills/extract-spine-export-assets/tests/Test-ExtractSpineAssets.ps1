#Requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool] $Condition,

        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

$skillRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $skillRoot 'scripts\extract-spine-assets.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('extract-spine-assets-' + [guid]::NewGuid().ToString('N'))
$exportRoot = Join-Path $testRoot 'Export'
$textureRoot = Join-Path $exportRoot 'Texture2D'
$textAssetRoot = Join-Path $exportRoot 'TextAsset'
$nestedTextureRoot = Join-Path $textureRoot 'nested'
$nestedTextRoot = Join-Path $textAssetRoot 'nested'
$outputRoot = Join-Path $testRoot 'output'
$dryRunOutputRoot = Join-Path $testRoot 'dry-run-output'

try {
    New-Item -ItemType Directory -Path $nestedTextureRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $nestedTextRoot -Force | Out-Null

    Set-Content -LiteralPath (Join-Path $textureRoot 'hero_100.png') -Value 'png-100' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $textureRoot 'hero_100Low.png') -Value 'png-low' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $textureRoot 'hero_100_placeholder.png') -Value 'png-placeholder' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $nestedTextureRoot 'hero_200.png') -Value 'png-200' -Encoding UTF8

    Set-Content -LiteralPath (Join-Path $textAssetRoot 'hero_100.skel.asset') -Value 'skel-100' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $textAssetRoot 'hero_100.atlas.asset') -Value "hero_100.png`nsize: 1,1" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $nestedTextRoot 'hero_200.skel.asset') -Value 'skel-200' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $nestedTextRoot 'hero_200.atlas.asset') -Value "hero_200.png`nsize: 1,1" -Encoding UTF8

    $dryRunResult = @(& $scriptPath -ExportRoot $exportRoot -NamePattern 'hero_*' -OutputRoot $dryRunOutputRoot -DryRun)
    Assert-True -Condition ($dryRunResult.Count -eq 2) -Message 'Dry run should select two standard resources.'
    Assert-True -Condition (-not (Test-Path -LiteralPath $dryRunOutputRoot)) -Message 'Dry run must not create the output root.'
    Assert-True -Condition (@($dryRunResult | Where-Object Status -ne 'WouldCopy').Count -eq 0) -Message 'New resources should be reported as WouldCopy.'

    $copyResult = @(& $scriptPath -ExportRoot $exportRoot -NamePattern 'hero_*' -OutputRoot $outputRoot)
    Assert-True -Condition ($copyResult.Count -eq 2) -Message 'Copy should return two resource results.'
    Assert-True -Condition ((Get-ChildItem -LiteralPath $outputRoot -Recurse -File).Count -eq 6) -Message 'Two resources should produce six files.'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $outputRoot 'hero_100Low'))) -Message 'Low resource must be excluded.'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $outputRoot 'hero_100_placeholder'))) -Message 'Placeholder resource must be excluded.'

    $secondResult = @(& $scriptPath -ExportRoot $exportRoot -NamePattern 'hero_*' -OutputRoot $outputRoot)
    Assert-True -Condition (@($secondResult | Where-Object Status -ne 'Unchanged').Count -eq 0) -Message 'Identical destinations should be unchanged.'

    $missingPng = Join-Path $textureRoot 'hero_missing.png'
    Set-Content -LiteralPath $missingPng -Value 'missing-pair' -Encoding UTF8
    $missingFailed = $false
    try {
        & $scriptPath -ExportRoot $exportRoot -NamePattern 'hero_*' -OutputRoot $outputRoot | Out-Null
    }
    catch {
        $missingFailed = $_.Exception.Message -like '*Missing skeleton*'
    }
    Assert-True -Condition $missingFailed -Message 'A missing source pair must fail preflight.'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $outputRoot 'hero_missing'))) -Message 'Failed preflight must not create a partial resource.'
    Remove-Item -LiteralPath $missingPng -Force

    $targetSkel = Join-Path $outputRoot 'hero_100\hero_100.skel'
    Set-Content -LiteralPath $targetSkel -Value 'conflicting-target' -Encoding UTF8
    $conflictFailed = $false
    try {
        & $scriptPath -ExportRoot $exportRoot -NamePattern 'hero_*' -OutputRoot $outputRoot | Out-Null
    }
    catch {
        $conflictFailed = $_.Exception.Message -like '*Destination differs*'
    }
    Assert-True -Condition $conflictFailed -Message 'Different destination content must require Force.'

    $forceResult = @(& $scriptPath -ExportRoot $exportRoot -NamePattern 'hero_*' -OutputRoot $outputRoot -Force)
    Assert-True -Condition (@($forceResult | Where-Object { $_.Name -eq 'hero_100' -and $_.Status -eq 'Updated' }).Count -eq 1) -Message 'Force should update the conflicting resource.'
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $textAssetRoot 'hero_100.skel.asset')).Hash
    $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetSkel).Hash
    Assert-True -Condition ($sourceHash -eq $targetHash) -Message 'Forced copy must pass hash verification.'

    Write-Output 'All extract-spine-assets tests passed.'
}
finally {
    if (Test-Path -LiteralPath $testRoot -PathType Container) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
