# ============================================================================
#  check-app-health.ps1 — READ-ONLY Gesundheitscheck der Harness-Kette
#  App (Electron) -> fr-gateway (Docker, pro Key) -> FlagshipRouter :20128 -> Provider
#
#  Aufruf:  .\check-app-health.ps1
#  Es wird NICHTS verändert (keine Neustarts, keine Schreibzugriffe).
# ============================================================================
$ErrorActionPreference = 'Continue'
$ROOT = $PSScriptRoot; if (-not $ROOT) { $ROOT = (Get-Location).Path }
$REG = Join-Path $ROOT 'fr-gateway\secrets\registry.json'
$UPSTREAM = 'http://127.0.0.1:20128/v1'
$PANEL = 'http://127.0.0.1:8090'

function Line($t) { Write-Host $t }
function Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Bad($t)  { Write-Host "  [FEHL] $t" -ForegroundColor Red }
function Info($t) { Write-Host "  [info] $t" -ForegroundColor DarkGray }

Line ''
Line '=== 1) Docker / Gateway-Container ==='
try {
    $running = (docker ps --filter 'name=fr-key-' --format '{{.Names}}' 2>$null | Measure-Object -Line).Lines
    $unhealthy = (docker ps --filter 'name=fr-key-' --filter 'health=unhealthy' --format '{{.Names}}' 2>$null | Measure-Object -Line).Lines
    if ($running -gt 0) { Ok "$running Key-Container laufen, $unhealthy unhealthy" } else { Bad 'keine Key-Container aktiv' }
} catch { Bad "docker nicht erreichbar: $($_.Exception.Message)" }

Line ''
Line '=== 2) Panel (fr-panel :8090) ==='
try {
    $fleet = Invoke-RestMethod -Uri "$PANEL/api/fleet" -TimeoutSec 10
    Ok "Panel antwortet, Fleet-Einträge: $($fleet.Count)"
} catch { Bad "Panel: $($_.Exception.Message)" }

Line ''
Line '=== 3) Registry / Key-Auth (Stichprobe 3) ==='
$entries = @()
try {
    $entries = Get-Content $REG -Raw | ConvertFrom-Json
    Ok "Registry lesbar, $($entries.Count) Einträge"
} catch { Bad "Registry nicht lesbar: $($_.Exception.Message)" }
$authOk = 0; $authBad = 0
foreach ($e in ($entries | Select-Object -First 3)) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($e.port)/v1/models" -Headers @{ Authorization = "Bearer $($e.unique_key)" } -UseBasicParsing -TimeoutSec 8
        if ($r.StatusCode -eq 200) { $authOk++ } else { $authBad++ }
    } catch { $authBad++ }
}
if ($authOk -gt 0 -and $authBad -eq 0) { Ok "Key-Auth + /v1/models: $authOk/3 OK" } else { Bad "Key-Auth: $authOk OK, $authBad Fehler" }

# Upstream-Key nur aus Env oder erster Zeile von secrets/keys_raw.txt (nie hardcoden)
$UPSTREAM_KEY = $env:FLAGGG_UPSTREAM_KEY
if (-not $UPSTREAM_KEY) {
    $keysFile = Join-Path $ROOT 'fr-gateway\secrets\keys_raw.txt'
    if (Test-Path $keysFile) {
        $UPSTREAM_KEY = (Get-Content $keysFile -ErrorAction SilentlyContinue |
            Where-Object { $_ -and $_ -notmatch '^\s*#' } |
            Select-Object -First 1)
    }
}

Line ''
Line '=== 4) Upstream-Router (:20128) ==='
if (-not $UPSTREAM_KEY) {
    Bad 'kein Upstream-Key (FLAGGG_UPSTREAM_KEY oder fr-gateway/secrets/keys_raw.txt)'
    $ids = @()
} else {
try {
    $models = Invoke-RestMethod -Uri "$UPSTREAM/models" -Headers @{ Authorization = "Bearer $UPSTREAM_KEY" } -TimeoutSec 15
    $ids = @($models.data | ForEach-Object { $_.id })
    Ok "Router erreichbar, $($ids.Count) Modelle"
    Info ($ids -join ', ')
} catch { Bad "Router: $($_.Exception.Message)"; $ids = @() }
}

Line ''
Line '=== 5) Chat-Probe (1 Modell, 8 Tokens) ==='
if ($ids.Count -gt 0 -and $UPSTREAM_KEY) {
    $probe = 'gpt-6-astra'
    if ($ids -notcontains $probe) { $probe = $ids[0] }
    $body = @{ model = $probe; messages = @(@{ role = 'user'; content = 'ping' }); stream = $false; max_tokens = 8 } | ConvertTo-Json -Depth 5
    try {
        $r = Invoke-WebRequest -Uri "$UPSTREAM/chat/completions" -Method Post -Body $body -ContentType 'application/json' -Headers @{ Authorization = "Bearer $UPSTREAM_KEY" } -UseBasicParsing -TimeoutSec 60
        Ok "Chat funktioniert (HTTP $($r.StatusCode), Modell $probe)"
    } catch {
        $resp = $_.Exception.Response
        $code = if ($resp) { $resp.StatusCode.value__ } else { 'ERR' }
        $msg = [string]$_.ErrorDetails.Message
        if (-not $msg) { $msg = $_.Exception.Message }
        $msg = ($msg -replace '\\u0022', '"') -replace '\s+', ' '
        Bad "Chat fehlgeschlagen: HTTP $code"
        Info $msg.Substring(0, [Math]::Min(240, $msg.Length))
        Line ''
        Line '  Einordnung:'
        if ($msg -match 'FreeUsageLimitError|Free usage limit') {
            Info '  -> Upstream-Provider (OpenCode) hat das kostenlose Kontingent aufgebraucht.'
            Info '     Ursache liegt NICHT in der App und NICHT im fr-gateway.'
        } elseif ($msg -match 'daily token limit') {
            Info '  -> fr-gateway Tageslimit (2 Mio. Tokens) erreicht.'
        } elseif ($msg -match 'ModelDeprecated|Unsupported model|Model is unavailable|not available in') {
            Info '  -> Modell/Provider beim Upstream nicht verfügbar oder abgekündigt.'
        } elseif ($msg -match 'unauthorized|invalid_api_key') {
            Info '  -> Zugangsdaten/Key ungültig.'
        }
    }
}

Line ''
Line '=== 6) Fazit ==='
Line '  App-Kette (Electron/Fenster, Panel, Gateway-Container, Key-Auth, /v1/models)'
Line '  = oben grün. Reicht die Chat-Probe Rot, liegt der Fehler beim Upstream-Provider.'
Line ''
