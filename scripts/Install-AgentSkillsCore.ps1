#Requires -Version 7.0
<#
.SYNOPSIS
  Installiert den kuratierten Agent-Skills-Kern in FLAGGG (.cursor/skills/).

.DESCRIPTION
  Kern (nicht Bulk):
    - mattpocock/skills: grill-with-docs, tdd, diagnosing-bugs, code-review
    - addyosmani/agent-skills: constraint-driven-development (+ VERIFY/REVIEW falls vorhanden)
    - anthropics/skills: frontend-design
    - zanwei/design-dna (UI-Tokens aus Referenz-Mockups)

  Default: -DryRun (nur Plan, kein Schreibzugriff).
  Echt: -Proceed

.PARAMETER Global
  Ziel %USERPROFILE%\.cursor\skills\ statt Projekt .cursor\skills\

.PARAMETER Proceed
  Wirklich klonen/kopieren. Ohne -Proceed nur DryRun.

.PARAMETER DryRun
  Explizit Plan-only (Default wenn weder DryRun noch Proceed).

.PARAMETER CacheDir
  Lokaler Clone-Cache (Default: .cursor/skills-cache/).

.EXAMPLE
  pwsh -NoProfile -File .\scripts\Install-AgentSkillsCore.ps1
.EXAMPLE
  pwsh -NoProfile -File .\scripts\Install-AgentSkillsCore.ps1 -Proceed
#>
[CmdletBinding()]
param(
    [switch]$Global,
    [switch]$Proceed,
    [switch]$DryRun,
    [string]$CacheDir = '',
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Proceed) { $DryRun = $true }
if ($Proceed -and $DryRun) {
    Write-Error 'Nur eines: -Proceed oder -DryRun (ohne -Proceed = DryRun).'
}

function Resolve-RepoRoot {
    param([string]$Hint)
    if ($Hint -and (Test-Path -LiteralPath $Hint)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $here = $PSScriptRoot
    if (-not $here) { $here = (Get-Location).Path }
    $candidate = Split-Path -Parent $here
    if (Test-Path -LiteralPath (Join-Path $candidate 'harness-pro')) {
        return $candidate
    }
    return $candidate
}

$root = Resolve-RepoRoot -Hint $RepoRoot
$skillsTarget = if ($Global) {
    Join-Path $env:USERPROFILE '.cursor\skills'
} else {
    Join-Path $root '.cursor\skills'
}
$cache = if ($CacheDir) {
    $CacheDir
} else {
    Join-Path $root '.cursor\skills-cache'
}

# Kuratierter Kern — bewusst schmal (Token-Budget / keine ECC-Monolithen)
$CorePack = @(
    @{
        Id          = 'mattpocock'
        Repo        = 'https://github.com/mattpocock/skills.git'
        Kind        = 'npx-or-clone'
        Npx         = 'npx --yes skills@latest add mattpocock/skills --yes'
        SkillNames  = @('grill-with-docs', 'tdd', 'diagnosing-bugs', 'code-review')
        Note        = 'Engineering: Interview/ADR, TDD, Bugs, Review'
    }
    @{
        Id          = 'addyosmani'
        Repo        = 'https://github.com/addyosmani/agent-skills.git'
        Kind        = 'npx-or-clone'
        Npx         = 'npx --yes skills add addyosmani/agent-skills --yes'
        SkillNames  = @('constraint-driven-development')
        Note        = 'Quality Gates DEFINE→SHIP (Subset)'
    }
    @{
        Id          = 'anthropics-frontend-design'
        Repo        = 'https://github.com/anthropics/skills.git'
        Kind        = 'sparse-skill'
        SkillPath   = 'skills/frontend-design'
        SkillNames  = @('frontend-design')
        Note        = 'Offizielle produktionsnahe UI-Komponenten'
    }
    @{
        Id          = 'design-dna'
        Repo        = 'https://github.com/zanwei/design-dna.git'
        Kind        = 'clone-skill-root'
        SkillNames  = @('design-dna')
        Note        = 'Design-Tokens aus Mockup/Screenshot/URL → JSON'
    }
)

function Write-Step([string]$Msg) {
    Write-Host "[skills-core] $Msg"
}

function Test-SkillPresent([string]$Name) {
    $dir = Join-Path $skillsTarget $Name
    return (Test-Path -LiteralPath (Join-Path $dir 'SKILL.md')) -or (Test-Path -LiteralPath $dir)
}

Write-Step "RepoRoot:  $root"
Write-Step "Ziel:      $skillsTarget$(if ($Global) { ' (global)' } else { ' (projekt)' })"
Write-Step "Cache:     $cache"
Write-Step "Modus:     $(if ($DryRun) { 'DRY-RUN (kein Schreibzugriff)' } else { 'PROCEED' })"
Write-Host ''

$plan = [System.Collections.Generic.List[object]]::new()
foreach ($pack in $CorePack) {
    $missing = @()
    foreach ($n in $pack.SkillNames) {
        if (-not (Test-SkillPresent $n)) { $missing += $n }
    }
    $plan.Add([pscustomobject]@{
            Id       = $pack.Id
            Note     = $pack.Note
            Repo     = $pack.Repo
            Kind     = $pack.Kind
            Skills   = ($pack.SkillNames -join ', ')
            Missing  = if ($missing.Count) { ($missing -join ', ') } else { '(alle vorhanden)' }
            Action   = if ($missing.Count -eq 0) { 'SKIP' } else { 'INSTALL' }
            Npx      = $pack.Npx
            PathHint = $pack.SkillPath
        })
}

$plan | Format-Table Id, Action, Missing, Note -AutoSize | Out-String | Write-Host

Write-Step 'Geplante Befehle (bei -Proceed):'
foreach ($row in $plan) {
    if ($row.Action -eq 'SKIP') {
        Write-Host "  # SKIP $($row.Id)"
        continue
    }
    switch ($row.Kind) {
        'npx-or-clone' {
            Write-Host "  $($row.Npx)"
            Write-Host "  # Fallback: git clone $($row.Repo) → passende SKILL.md nach $skillsTarget"
        }
        'sparse-skill' {
            Write-Host "  git clone --depth 1 $($row.Repo) $cache\$($row.Id)"
            Write-Host "  Copy-Item $cache\$($row.Id)\$($row.PathHint) → $skillsTarget\frontend-design"
        }
        'clone-skill-root' {
            Write-Host "  git clone --depth 1 $($row.Repo) $cache\$($row.Id)"
            Write-Host "  Copy/Link Skill-Root → $skillsTarget\design-dna"
        }
    }
}

Write-Host ''
Write-Step 'Nicht im Kern (bewusst): ECC 292, AAS 2750+, VoltAgent-Bulk, Superpowers-als-Plugin (Claude-only).'
Write-Step 'Optional-Skript: .\scripts\Install-AgentSkillsOptional.ps1 -DryRun'

if ($DryRun) {
    Write-Step 'DryRun fertig — nichts geschrieben.'
    Write-Host 'Echt installieren: pwsh -NoProfile -File .\scripts\Install-AgentSkillsCore.ps1 -Proceed'
    exit 0
}

# --- Proceed ---
New-Item -ItemType Directory -Force -Path $skillsTarget | Out-Null
New-Item -ItemType Directory -Force -Path $cache | Out-Null

function Ensure-GitClone {
    param([string]$Url, [string]$Dest)
    if (Test-Path -LiteralPath (Join-Path $Dest '.git')) {
        Write-Step "Cache ok: $Dest"
        return
    }
    if (Test-Path -LiteralPath $Dest) {
        Remove-Item -LiteralPath $Dest -Recurse -Force
    }
    Write-Step "git clone --depth 1 $Url"
    & git clone --depth 1 $Url $Dest
    if ($LASTEXITCODE -ne 0) { throw "git clone fehlgeschlagen: $Url" }
}

function Copy-SkillDir {
    param([string]$Source, [string]$Name)
    $dest = Join-Path $skillsTarget $Name
    if (Test-Path -LiteralPath $dest) {
        Write-Step "bereits da, skip: $Name"
        return
    }
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Skill-Quelle fehlt: $Source"
    }
    Copy-Item -LiteralPath $Source -Destination $dest -Recurse -Force
    Write-Step "installiert: $Name ← $Source"
}

function Find-SkillFolders {
    param([string]$RootPath, [string[]]$Names)
    $found = @{}
    foreach ($n in $Names) {
        $hits = Get-ChildItem -LiteralPath $RootPath -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq $n -or (Test-Path (Join-Path $_.FullName 'SKILL.md')) } |
            Where-Object {
                $_.Name -eq $n -or
                ((Test-Path (Join-Path $_.FullName 'SKILL.md')) -and $_.Name -match [regex]::Escape($n))
            }
        # Prefer exact folder name
        $exact = Get-ChildItem -LiteralPath $RootPath -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq $n } |
            Select-Object -First 1
        if ($exact) {
            $found[$n] = $exact.FullName
            continue
        }
        # SKILL.md parent whose folder looks like skill
        $skillMd = Get-ChildItem -LiteralPath $RootPath -Recurse -Filter 'SKILL.md' -ErrorAction SilentlyContinue |
            Where-Object { $_.Directory.Name -eq $n } |
            Select-Object -First 1
        if ($skillMd) { $found[$n] = $skillMd.Directory.FullName }
    }
    return $found
}

foreach ($pack in $CorePack) {
    $missing = @($pack.SkillNames | Where-Object { -not (Test-SkillPresent $_) })
    if ($missing.Count -eq 0) {
        Write-Step "SKIP $($pack.Id) — Skills vorhanden"
        continue
    }

    Write-Step "INSTALL $($pack.Id): $($missing -join ', ')"

    if ($pack.Kind -eq 'npx-or-clone' -and $pack.Npx) {
        Write-Step "versuche npx: $($pack.Npx)"
        try {
            $prev = Get-Location
            Set-Location $root
            # skills CLI schreibt oft nach .agents/skills oder .cursor/skills — danach sync
            cmd /c $pack.Npx
            $npxOk = ($LASTEXITCODE -eq 0)
            Set-Location $prev
            if ($npxOk) {
                # ggf. aus .agents/skills spiegeln
                $agentsSkills = Join-Path $root '.agents\skills'
                if (Test-Path $agentsSkills) {
                    foreach ($n in $pack.SkillNames) {
                        $src = Join-Path $agentsSkills $n
                        if ((Test-Path $src) -and -not (Test-SkillPresent $n)) {
                            Copy-SkillDir -Source $src -Name $n
                        }
                    }
                }
            }
        } catch {
            Write-Step "npx fehlgeschlagen ($($_.Exception.Message)) — Fallback Clone"
        }
        $still = @($pack.SkillNames | Where-Object { -not (Test-SkillPresent $_) })
        if ($still.Count -eq 0) { continue }
    }

    $destCache = Join-Path $cache $pack.Id
    Ensure-GitClone -Url $pack.Repo -Dest $destCache

    if ($pack.Kind -eq 'sparse-skill' -and $pack.SkillPath) {
        $src = Join-Path $destCache ($pack.SkillPath -replace '/', [IO.Path]::DirectorySeparatorChar)
        Copy-SkillDir -Source $src -Name $pack.SkillNames[0]
        continue
    }

    if ($pack.Kind -eq 'clone-skill-root') {
        # design-dna: SKILL.md im Root oder Unterordner
        $rootSkill = Join-Path $destCache 'SKILL.md'
        if (Test-Path $rootSkill) {
            Copy-SkillDir -Source $destCache -Name $pack.SkillNames[0]
        } else {
            $map = Find-SkillFolders -RootPath $destCache -Names $pack.SkillNames
            foreach ($n in $pack.SkillNames) {
                if ($map.ContainsKey($n)) { Copy-SkillDir -Source $map[$n] -Name $n }
                else { Write-Warning "Skill $n nicht im Repo gefunden ($($pack.Id))" }
            }
        }
        continue
    }

    # npx-or-clone Fallback: Ordner nach Skill-Namen suchen
    $map = Find-SkillFolders -RootPath $destCache -Names $pack.SkillNames
    foreach ($n in $pack.SkillNames) {
        if (Test-SkillPresent $n) { continue }
        if ($map.ContainsKey($n)) { Copy-SkillDir -Source $map[$n] -Name $n }
        else { Write-Warning "Skill $n nicht gefunden in $($pack.Repo) — manuell prüfen" }
    }
}

Write-Host ''
Write-Step 'Ergebnis:'
Get-ChildItem -LiteralPath $skillsTarget -Directory -ErrorAction SilentlyContinue |
    ForEach-Object {
        $has = Test-Path (Join-Path $_.FullName 'SKILL.md')
        Write-Host ("  {0}  {1}" -f $(if ($has) { '[OK]' } else { '[??]' }), $_.Name)
    }
Write-Step 'Fertig.'
