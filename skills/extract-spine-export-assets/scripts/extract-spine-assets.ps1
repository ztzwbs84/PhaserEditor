#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $ExportRoot,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]] $NamePattern,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $OutputRoot,

    [string] $TextureRoot,

    [string] $TextAssetRoot,

    [string[]] $ExcludePattern = @('*Low*', '*_placeholder*'),

    [switch] $DryRun,

    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ExistingDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label directory does not exist: $Path"
    }

    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
}

function Get-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Candidate,

        [Parameter(Mandatory = $true)]
        [string] $Parent
    )

    if ($Candidate.Equals($Parent, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    $parentPrefix = $Parent + [System.IO.Path]::DirectorySeparatorChar
    return $Candidate.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-WildcardMatch {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name,

        [string[]] $Patterns
    )

    foreach ($pattern in @($Patterns)) {
        if (-not [string]::IsNullOrWhiteSpace($pattern) -and $Name -like $pattern) {
            return $true
        }
    }

    return $false
}

function Add-IndexedFile {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable] $Index,

        [Parameter(Mandatory = $true)]
        [System.IO.FileInfo] $File
    )

    if ($Index.ContainsKey($File.Name)) {
        $Index[$File.Name] = @($Index[$File.Name]) + $File
    }
    else {
        $Index[$File.Name] = @($File)
    }
}

function Get-SingleIndexedFile {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable] $Index,

        [Parameter(Mandatory = $true)]
        [string] $Name,

        [Parameter(Mandatory = $true)]
        [string] $Kind,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]] $Issues
    )

    if (-not $Index.ContainsKey($Name)) {
        $Issues.Add("Missing $Kind source: $Name")
        return $null
    }

    $matches = @($Index[$Name])
    if ($matches.Count -ne 1) {
        $paths = ($matches.FullName -join ' | ')
        $Issues.Add("Duplicate $Kind source for $Name`: $paths")
        return $null
    }

    return $matches[0]
}

foreach ($pattern in $NamePattern) {
    if ([string]::IsNullOrWhiteSpace($pattern)) {
        throw 'NamePattern cannot contain an empty value.'
    }
}

$exportRootPath = Resolve-ExistingDirectory -Path $ExportRoot -Label 'Export root'

if ([string]::IsNullOrWhiteSpace($TextureRoot)) {
    $TextureRoot = Join-Path $exportRootPath 'Texture2D'
}
if ([string]::IsNullOrWhiteSpace($TextAssetRoot)) {
    $TextAssetRoot = Join-Path $exportRootPath 'TextAsset'
}

$textureRootPath = Resolve-ExistingDirectory -Path $TextureRoot -Label 'Texture'
$textAssetRootPath = Resolve-ExistingDirectory -Path $TextAssetRoot -Label 'TextAsset'
$outputRootPath = Get-NormalizedPath -Path $OutputRoot

if ((Test-PathWithin -Candidate $outputRootPath -Parent $textureRootPath) -or
    (Test-PathWithin -Candidate $outputRootPath -Parent $textAssetRootPath)) {
    throw "Output root cannot be inside a source tree: $outputRootPath"
}

$selectedPngs = @(
    Get-ChildItem -LiteralPath $textureRootPath -Recurse -File -Filter '*.png' |
        Where-Object {
            (Test-WildcardMatch -Name $_.BaseName -Patterns $NamePattern) -and
            -not (Test-WildcardMatch -Name $_.Name -Patterns $ExcludePattern)
        } |
        Sort-Object FullName
)

if ($selectedPngs.Count -eq 0) {
    throw "No PNG files matched patterns '$($NamePattern -join ', ')' after exclusions '$($ExcludePattern -join ', ')'."
}

$issues = [System.Collections.Generic.List[string]]::new()
$duplicatePngGroups = @($selectedPngs | Group-Object BaseName | Where-Object Count -gt 1)
foreach ($group in $duplicatePngGroups) {
    $issues.Add("Duplicate PNG stem $($group.Name): $($group.Group.FullName -join ' | ')")
}

$textIndex = @{}
Get-ChildItem -LiteralPath $textAssetRootPath -Recurse -File -Filter '*.asset' |
    ForEach-Object { Add-IndexedFile -Index $textIndex -File $_ }

$resourcePlans = [System.Collections.Generic.List[object]]::new()

foreach ($png in $selectedPngs) {
    $stem = $png.BaseName
    $skel = Get-SingleIndexedFile -Index $textIndex -Name ($stem + '.skel.asset') -Kind 'skeleton' -Issues $issues
    $atlas = Get-SingleIndexedFile -Index $textIndex -Name ($stem + '.atlas.asset') -Kind 'atlas' -Issues $issues

    if ($null -eq $skel -or $null -eq $atlas) {
        continue
    }

    $atlasText = [System.IO.File]::ReadAllText($atlas.FullName)
    if ($atlasText.IndexOf($png.Name, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $issues.Add("Atlas does not reference $($png.Name): $($atlas.FullName)")
        continue
    }

    $targetDirectory = Join-Path $outputRootPath $stem
    if ((Test-Path -LiteralPath $targetDirectory) -and
        -not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
        $issues.Add("Target directory path is occupied by a file: $targetDirectory")
        continue
    }

    $filePlans = @(
        [pscustomobject]@{
            Kind = 'png'
            Source = $png.FullName
            Destination = Join-Path $targetDirectory ($stem + '.png')
        },
        [pscustomobject]@{
            Kind = 'skel'
            Source = $skel.FullName
            Destination = Join-Path $targetDirectory ($stem + '.skel')
        },
        [pscustomobject]@{
            Kind = 'atlas'
            Source = $atlas.FullName
            Destination = Join-Path $targetDirectory ($stem + '.atlas.txt')
        }
    )

    foreach ($filePlan in $filePlans) {
        $filePlan | Add-Member -NotePropertyName ExistingSame -NotePropertyValue $false
        $filePlan | Add-Member -NotePropertyName ExistingDifferent -NotePropertyValue $false

        if (Test-Path -LiteralPath $filePlan.Destination) {
            if (-not (Test-Path -LiteralPath $filePlan.Destination -PathType Leaf)) {
                $issues.Add("Destination file path is occupied by a directory: $($filePlan.Destination)")
                continue
            }

            $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $filePlan.Source).Hash
            $destinationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $filePlan.Destination).Hash
            if ($sourceHash -eq $destinationHash) {
                $filePlan.ExistingSame = $true
            }
            else {
                $filePlan.ExistingDifferent = $true
                if (-not $Force) {
                    $issues.Add("Destination differs; inspect it or rerun with -Force: $($filePlan.Destination)")
                }
            }
        }
    }

    $resourcePlans.Add([pscustomobject]@{
        Name = $stem
        SourcePng = $png.FullName
        OutputDirectory = $targetDirectory
        Files = $filePlans
    })
}

if ($issues.Count -gt 0) {
    throw "Spine asset preflight failed:`n - $($issues -join "`n - ")"
}

if (-not $DryRun -and -not (Test-Path -LiteralPath $outputRootPath -PathType Container)) {
    New-Item -ItemType Directory -Path $outputRootPath -Force | Out-Null
}

foreach ($resourcePlan in $resourcePlans) {
    $hasUpdate = @($resourcePlan.Files | Where-Object ExistingDifferent).Count -gt 0
    $hasCopy = @($resourcePlan.Files | Where-Object { -not $_.ExistingSame -and -not $_.ExistingDifferent }).Count -gt 0

    if ($DryRun) {
        if ($hasUpdate) {
            $status = 'WouldUpdate'
        }
        elseif ($hasCopy) {
            $status = 'WouldCopy'
        }
        else {
            $status = 'Unchanged'
        }
    }
    else {
        if (-not (Test-Path -LiteralPath $resourcePlan.OutputDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $resourcePlan.OutputDirectory -Force | Out-Null
        }

        foreach ($filePlan in $resourcePlan.Files) {
            if (-not $filePlan.ExistingSame) {
                Copy-Item -LiteralPath $filePlan.Source -Destination $filePlan.Destination -Force
            }
        }

        foreach ($filePlan in $resourcePlan.Files) {
            $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $filePlan.Source).Hash
            $destinationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $filePlan.Destination).Hash
            if ($sourceHash -ne $destinationHash) {
                throw "Post-copy hash verification failed: $($filePlan.Destination)"
            }
        }

        if ($hasUpdate) {
            $status = 'Updated'
        }
        elseif ($hasCopy) {
            $status = 'Copied'
        }
        else {
            $status = 'Unchanged'
        }
    }

    [pscustomobject]@{
        Name = $resourcePlan.Name
        Status = $status
        FileCount = 3
        OutputDirectory = $resourcePlan.OutputDirectory
    }
}
