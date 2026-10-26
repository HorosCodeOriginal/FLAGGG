#Requires -Version 7.0
<#
.SYNOPSIS
  Optionale Agent-Skills-Erweiterungen (kein Bulk ohne explizite Namen).

.DESCRIPTION
  Packs:
    gui       — dembrandt-skills (UX/WCAG), ergänzt Core design-dna + frontend-design
    rules     — ciembor/agent-rules-books → docs/agent-rules-books/ (nicht Skills-Flood)
    catalog   — VoltAgent awesome-agent-skills nur als README-Index-Clone (kein 1000er Copy)
    ecc-sandbox — WARNUNG: nur mit -SandboxDir; nie in FLAGGG-main ohne Bestätigung
    aas       — nur Hinweis, kein Auto-Install von 2750 Skills

  Default: -DryRun

.PARAMETER Pack
  gui | rules | catalog | ecc-sandbox | aas | all-safe
  all-safe = gui + rules + catalog (kein ECC/AAS)

.EXAMPLE
  pwsh -NoProfile -File .\scripts\Install-AgentSkillsOptional.ps1 -Pack gui
.EXAMPLE
  pwsh -NoProfile -File .\scripts\Install-AgentSkillsOptional.ps1 -Pack all-safe -Proceed
#>
[CmdletBinding()]
param(
    [ValidateSet('gui', 'rules', 'catalog', 'ecc-sandbox', 'aas', 'all-safe')]
    [string]$Pack = 'all-safe',
    [switch]$Global,
    [switch]$Proceed,
    [switch]$DryRun,
    [string]$SandboxDir = '',
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Proceed) { $DryRun = $true }
if ($Proceed -and $DryRun) {
    Write-Error 'Nur eines: -Proceed oder -DryRun.'
}

function Resolve-RepoRoot {
    param([string]$Hint)
    if ($Hint -and (Test-Path -LiteralPath $Hint)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $here = $PSScriptRoot
    if (-not $here) { $here = (Get-Location).Path }
    return (Split-Path -Parent $here)
}

$root = Resolve-RepoRoot -Hint $RepoRoot
$skillsTarget = if ($Global) {
    Join-Path $env:USERPROFILE '.cursor\skills'
} else {
    Join-Path $root '.cursor\skills'
}
$cache = Join-Path $root '.cursor\skills-cache'

function Write-Step([string]$Msg) { Write-Host "[skills-opt] $Msg" }

$packs = @{
    gui = [pscustomobject]@{
        Title  = 'GUI/UX (dembrandt)'
        Action = 'git clone dembrandt/dembrandt-skills → .cursor/skills/dembrandt-* (Subset)'
        Repo   = 'https://github.com/dembrandt/dembrandt-skills.git'
        Risk   = 'low'
    }
    rules = [pscustomobject]@{
        Title  = 'Architecture Rules (ciembor)'
        Action = 'Clone → docs/agent-rules-books/ (AGENTS.md-Snippets, kein Skills-Bulk)'
        Repo   = 'https://github.com/ciembor/agent-rules-books.git'
        Risk   = 'low'
    }
    catalog = [pscustomobject]@{
        Title  = 'VoltAgent Catalog (Index only)'
        Action = 'Clone awesome-agent-skills → .cursor/skills-cache/catalog (README/Index, kein Copy aller Skills)'
        Repo   = 'https://github.com/VoltAgent/awesome-agent-skills.git'
        Risk   = 'low'
    }
    'ecc-sandbox' = [pscustomobject]@{
        Title  = 'ECC Universal (Sandbox only)'
        Action = 'npx ecc-universal@2.2.1 setup — NUR in -SandboxDir, nie FLAGGG-Root'
        Repo   = 'npx'
        Risk   = 'high'
    }
    aas = [pscustomobject]@{
        Title  = 'AAS Core (2750+ Skills)'
        Action = 'KEIN Auto-Install — nur Doku-Hinweis / manuelle Skill-Namen'
        Repo   = 'https://github.com/sickn33/agentic-awesome-skills'
        Risk   = 'high'
    }
}

$selected = switch ($Pack) {
    'all-safe' { @('gui', 'rules', 'catalog') }
    default { @($Pack) }
}

Write-Step "RepoRoot: $root"
Write-Step "Ziel Skills: $skillsTarget"
Write-Step "Pack: $Pack → $($selected -join ', ')"
Write-Step "Modus: $(if ($DryRun) { 'DRY-RUN' } else { 'PROCEED' })"
Write-Host ''

foreach ($id in $selected) {
    $p = $packs[$id]
    Write-Host ("--- {0} [{1}] ---" -f $p.Title, $p.Risk)
    Write-Host ("  {0}" -f $p.Action)
    Write-Host ("  Repo: {0}" -f $p.Repo)
    if ($id -eq 'ecc-sandbox') {
        $sb = if ($SandboxDir) { $SandboxDir } else { '(fehlt — -SandboxDir Pflicht bei -Proceed)' }
        Write-Host "  SandboxDir: $sb"
        if ($Proceed -and -not $SandboxDir) {
            Write-Error 'ecc-sandbox braucht -SandboxDir (separater Ordner außerhalb von FLAGGG-main).'
        }
        if ($Proceed -and $SandboxDir) {
            $resolved = (Resolve-Path -LiteralPath $root).Path
            $sbRes = [IO.Path]::GetFullPath($SandboxDir)
            if ($sbRes.StartsWith($resolved, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Error 'SandboxDir darf nicht unter FLAGGG-Repo liegen.'
            }
        }
    }
    if ($id -eq 'aas' -and $Proceed) {
        Write-Warning 'AAS: Proceed installiert nichts. Skill-Namen manuell wählen und Core-Skript erweitern.'
    }
    Write-Host ''
}

if ($DryRun) {
    Write-Step 'DryRun fertig — nichts geschrieben.'
    Write-Host 'Beispiel echt: pwsh -NoProfile -File .\scripts\Install-AgentSkillsOptional.ps1 -Pack gui -Proceed'
    Write-Host 'ECC nur: ... -Pack ecc-sandbox -SandboxDir C:\tmp\ecc-lab -Proceed'
    exit 0
}

New-Item -ItemType Directory -Force -Path $skillsTarget | Out-Null
New-Item -ItemType Directory -Force -Path $cache | Out-Null

function Ensure-GitClone([string]$Url, [string]$Dest) {
    if (Test-Path (Join-Path $Dest '.git')) { return }
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    & git clone --depth 1 $Url $Dest
    if ($LASTEXITCODE -ne 0) { throw "clone failed: $Url" }
}

foreach ($id in $selected) {
    switch ($id) {
        'gui' {
            $d = Join-Path $cache 'dembrandt-skills'
            Ensure-GitClone 'https://github.com/dembrandt/dembrandt-skills.git' $d
            # Alle Unterordner mit SKILL.md spiegeln (best effort, max 20)
            $skillDirs = Get-ChildItem $d -Recurse -Filter 'SKILL.md' -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Directory } |
                Select-Object -First 20
            foreach ($sd in $skillDirs) {
                $name = $sd.Name
                $dest = Join-Path $skillsTarget $name
                if (-not (Test-Path $dest)) {
                    Copy-Item $sd.FullName $dest -Recurse -Force
                    Write-Step "gui: $name"
                }
            }
        }
        'rules' {
            $d = Join-Path $root 'docs\agent-rules-books'
            if (-not (Test-Path $d)) {
                Ensure-GitClone 'https://github.com/ciembor/agent-rules-books.git' $d
                Write-Step "rules → $d"
            } else {
                Write-Step "rules bereits: $d"
            }
        }
        'catalog' {
            $d = Join-Path $cache 'catalog-awesome-agent-skills'
            Ensure-GitClone 'https://github.com/VoltAgent/awesome-agent-skills.git' $d
            Write-Step "catalog Index: $d (kein Bulk-Copy)"
        }
        'ecc-sandbox' {
            New-Item -ItemType Directory -Force -Path $SandboxDir | Out-Null
            Push-Location $SandboxDir
            try {
                cmd /c 'npx --yes ecc-universal@2.2.1 setup'
            } finally {
                Pop-Location
            }
            Write-Step "ECC setup in $SandboxDir"
        }
        'aas' {
            Write-Step 'AAS: kein Auto-Install (siehe DryRun-Hinweis).'
        }
    }
}

Write-Step 'Optional-Proceed fertig.'
