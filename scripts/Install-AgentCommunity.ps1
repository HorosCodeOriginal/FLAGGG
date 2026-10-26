#Requires -Version 7.0
<#
.SYNOPSIS
  Generiert Cursor-Subagents aus ampedweb/awesome-subagents (ohne Bash).

.DESCRIPTION
  Liest categories/*.md, schreibt nach .cursor/agents/ mit Praefix comm- (kein Kollision mit Horos-Roster).
  Quelle: .cursor/agents-cache/ampedweb-awesome-subagents (git clone).

.PARAMETER Proceed
  Schreibt Agent-Dateien. Ohne -Proceed nur DryRun-Zaehlung.

.EXAMPLE
  pwsh -NoProfile -File .\scripts\Install-AgentCommunity.ps1 -Proceed
#>
[CmdletBinding()]
param(
    [switch]$Proceed,
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
    param([string]$Hint)
    if ($Hint -and (Test-Path -LiteralPath $Hint)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $here = $PSScriptRoot
    if (-not $here) { $here = (Get-Location).Path }
    return (Split-Path -Parent $here)
}

function Test-ToolsContain {
    param([string]$Tool, [string]$ToolsLine)
    if ([string]::IsNullOrWhiteSpace($ToolsLine)) { return $false }
    return ($ToolsLine -split '[,\s]+' | Where-Object { $_ -eq $Tool }).Count -gt 0
}

function Convert-ToCursorAgent {
    param([string]$SourcePath)

    $raw = Get-Content -LiteralPath $SourcePath -Raw
    $raw = $raw -replace "`r`n", "`n"
    if (-not $raw.StartsWith('---')) {
        throw "Kein Frontmatter: $SourcePath"
    }
    $end = $raw.IndexOf("`n---`n", 3)
    if ($end -lt 0) { throw "Frontmatter nicht geschlossen: $SourcePath" }

    $fm = $raw.Substring(4, $end - 4)
    $body = $raw.Substring($end + 5).TrimStart()

    $name = ($fm -split "`n" | Where-Object { $_ -match '^name:\s*' } | Select-Object -First 1) -replace '^name:\s*', '' -replace '^"|"$', ''
    $desc = ($fm -split "`n" | Where-Object { $_ -match '^description:\s*' } | Select-Object -First 1) -replace '^description:\s*', '' -replace '^"|"$', ''
    $tools = ($fm -split "`n" | Where-Object { $_ -match '^tools:\s*' } | Select-Object -First 1) -replace '^tools:\s*', ''

    $hasWrite = Test-ToolsContain 'Write' $tools
    $hasEdit = Test-ToolsContain 'Edit' $tools
    $hasBash = Test-ToolsContain 'Bash' $tools
    $readonly = $tools -and (-not $hasWrite) -and (-not $hasEdit) -and (-not $hasBash)

    $outFm = @(
        '---'
        "name: $name"
        "description: $desc"
        'model: inherit'
    )
    if ($readonly) { $outFm += 'readonly: true' }
    $outFm += '---'
    $outFm += ''
    $outFm += $body

    return [pscustomobject]@{
        Name     = $name
        Content  = ($outFm -join "`n")
        ReadOnly = $readonly
    }
}

$root = Resolve-RepoRoot -Hint $RepoRoot
$sourceRoot = Join-Path $root '.cursor\agents-cache\ampedweb-awesome-subagents\categories'
$targetDir = Join-Path $root '.cursor\agents'

if (-not (Test-Path -LiteralPath $sourceRoot)) {
    Write-Error "Cache fehlt. Zuerst: git clone --depth 1 https://github.com/ampedweb/awesome-subagents.git `"$($sourceRoot | Split-Path -Parent | Join-Path -ChildPath 'ampedweb-awesome-subagents')`""
}

$files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -Filter '*.md' |
    Where-Object { $_.Name -ne 'README.md' }

Write-Host "[community-agents] Quelle: $sourceRoot"
Write-Host "[community-agents] Ziel:   $targetDir (comm-*.md)"
Write-Host "[community-agents] Gefunden: $($files.Count) Agent-Definitionen"
Write-Host "[community-agents] Modus: $(if ($Proceed) { 'PROCEED' } else { 'DRY-RUN' })"

$written = 0
foreach ($f in $files) {
    $agent = Convert-ToCursorAgent -SourcePath $f.FullName
    $outName = "comm-$($agent.Name).md"
    $outPath = Join-Path $targetDir $outName
    if ($Proceed) {
        Set-Content -LiteralPath $outPath -Value $agent.Content -Encoding utf8
        $written++
    }
}

if ($Proceed) {
    Write-Host "[community-agents] Geschrieben: $written"
} else {
    Write-Host '[community-agents] DryRun — Echt: -Proceed'
}
