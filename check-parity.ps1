# ============================================================================
#  check-parity.ps1 — prüft, ob die Harness-Klone auf demselben
#  Funktionsstand sind wie fr-harness (Master).
#
#  Aufruf:
#    .\check-parity.ps1            # Prüfung + Bericht (keine Änderungen)
#    .\check-parity.ps1 -Verbose   # detaillierte Ausgabe
#
#  Exit-Code: 0 = alle Klone auf Stand; 1 = Unterschiede gefunden.
# ============================================================================
param(
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$ROOT = $PSScriptRoot
if (-not $ROOT) { $ROOT = (Get-Location).Path }

$MASTER = Join-Path $ROOT 'fr-harness'
$CLONES = @(
    (Join-Path $ROOT 'astra-harness'),
    (Join-Path $ROOT 'claude-harness'),
    (Join-Path $ROOT 'harness-pro')
)

if (-not (Test-Path $MASTER)) { Write-Error "Master fehlt: $MASTER"; exit 2 }

# ----------------------------------------------------------------------------
# Kanal-Liste aus JS-Dateien extrahieren (ohne node_modules)
# ----------------------------------------------------------------------------
function Get-IpcChannels([string]$dir) {
    $channels = @{}
    Get-ChildItem -Path $dir -Recurse -File -Filter *.js -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules|legacy' } |
        ForEach-Object {
            $f = $_
            $raw = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
            if (-not $raw) { return }
            $chanPattern = "ipcMain\.(?:handle|on)\(\s*['""]([^'""]+)['""]"
            foreach ($m in [regex]::Matches($raw, $chanPattern)) {
                $ch = $m.Groups[1].Value
                if (-not $channels.ContainsKey($ch)) {
                    $channels[$ch] = [pscustomobject]@{
                        Channel = $ch
                        File    = $f.FullName.Substring($dir.Length).TrimStart('\','/')
                    }
                }
            }
        }
    return $channels
}

# ----------------------------------------------------------------------------
# Datei-Set (ohne node_modules) mit Hash
# ----------------------------------------------------------------------------
function Get-FileSet([string]$dir) {
    $set = @{}
    Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules|legacy' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($dir.Length).TrimStart('\','/')
            $set[$rel] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        }
    return $set
}

# ----------------------------------------------------------------------------
$masterSet   = Get-FileSet $MASTER
$masterChan  = Get-IpcChannels $MASTER
$masterCount = $masterChan.Count

# Bewusst klonspezifische Dateien (Identität/Konfiguration) — zählen nicht als Rückstand.
$KLON_SPECIFIC = @('package.json', 'astra.json', 'package-lock.json')

Write-Host ""
Write-Host "== Funktionsstand-Kontrolle: fr-harness (Master) vs. Klone =="
Write-Host "Master: $MASTER"
Write-Host "Master-Funktionen (IPC-Kanäle): $masterCount"
Write-Host ""

$allOk = $true
foreach ($clone in $CLONES) {
    $name = Split-Path $clone -Leaf
    if (-not (Test-Path $clone)) {
        Write-Host "[$name] FEHLT (Verzeichnis existiert nicht)"
        $allOk = $false
        continue
    }

    $cloneChan = Get-IpcChannels $clone
    $cloneSet  = Get-FileSet $clone
    # Klone legen den neuen Code unter _new_layer/ ab (Master: Wurzel) -
    # Pfade normalisieren, damit die Paritaetspruefung nicht falsch-negativ ist.
    $norm = @{}
    foreach ($k in $cloneSet.Keys) {
        if ($k -like "_new_layer/*") { $norm[$k.Substring(11)] = $cloneSet[$k] }
        else { $norm[$k] = $cloneSet[$k] }
    }
    $cloneSet = $norm

    $missingChan = $masterChan.Keys | Where-Object { -not $cloneChan.ContainsKey($_) } | Sort-Object
    $extraChan   = $cloneChan.Keys | Where-Object { -not $masterChan.ContainsKey($_) } | Sort-Object

    $missingFiles = $masterSet.Keys | Where-Object { -not $cloneSet.ContainsKey($_) } | Sort-Object
    $diffFiles    = $masterSet.Keys | Where-Object {
        $cloneSet.ContainsKey($_) -and $cloneSet[$_] -ne $masterSet[$_]
    } | Sort-Object

    Write-Host "------------------------------------------------------------"
    Write-Host "[$name]  Funktionen: $($cloneChan.Count)/$masterCount"
    Write-Host ""

    $diffReal = $diffFiles | Where-Object { $_ -notin $KLON_SPECIFIC }
    $missingReal = $missingFiles | Where-Object { $_ -notin $KLON_SPECIFIC }
    $diffId = $diffFiles | Where-Object { $_ -in $KLON_SPECIFIC }

    if ($missingChan.Count -eq 0) {
        Write-Host "  Funktionen: ALLE auf Stand ✓"
    } else {
        $allOk = $false
        Write-Host ("  FEHLENDE Funktionen ({0}):" -f $missingChan.Count)
        foreach ($ch in $missingChan) { Write-Host "    - $ch" }
    }

    if ($extraChan.Count -gt 0) {
        Write-Host "  NUR hier (im Master nicht vorhanden):"
        foreach ($ch in $extraChan) { Write-Host "    + $ch" }
    }

    if ($diffReal.Count -gt 0) {
        $allOk = $false
        Write-Host ("  ABWEICHENDE Dateien ({0}):" -f $diffReal.Count)
        foreach ($f in $diffReal) { Write-Host "    ~ $f" }
    }

    if ($missingReal.Count -gt 0) {
        $allOk = $false
        Write-Host ("  FEHLENDE Dateien ({0}):" -f $missingReal.Count)
        foreach ($f in $missingReal) { Write-Host "    - $f" }
    }

    if ($diffId.Count -gt 0) {
        Write-Host ("  Identität/Konfiguration (erwartete Unterschiede, {0}):" -f $diffId.Count)
        foreach ($f in $diffId) { Write-Host "    i $f" }
    }

    if ($missingChan.Count -eq 0 -and $diffReal.Count -eq 0 -and $missingReal.Count -eq 0) {
        Write-Host "  Code/Dateien: ALLE auf Stand ✓"
    }
    Write-Host ""
}

if ($allOk) {
    Write-Host "ERGEBNIS: Alle Klone sind auf dem Stand von fr-harness ✓"
    exit 0
} else {
    Write-Host "ERGEBNIS: Es gibt Abweichungen (siehe oben) — Klone hinterlassen."
    exit 1
}
