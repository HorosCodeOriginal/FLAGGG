#!/usr/bin/env pwsh
# cursor-config.ps1 — zeigt die Cursor-relevanten Werte aus der fr-gateway-Registry.
#
# Beispiele:
#   .\cursor-config.ps1                     # Key nr 1 (Port 20129)
#   .\cursor-config.ps1 -Nr 2 -CopyKey      # Key nr 2 in die Zwischenablage
#   .\cursor-config.ps1 -Family opus        # erster freier opus-Key
#   .\cursor-config.ps1 -Nr 2 -Check        # /v1/models gegen den Container testen
#
# Cursor: Settings -> Models -> OpenAI API Key + Override OpenAI Base URL.

[CmdletBinding()]
param(
  [int]$Nr = 1,
  [ValidateSet('astra', 'opus', '')]
  [string]$Family = '',
  [string]$Registry = (Join-Path $PSScriptRoot '..\secrets\registry.json'),
  [switch]$CopyKey,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Registry)) {
  throw "Registry nicht gefunden: $Registry"
}

$entries = @(Get-Content $Registry -Raw | ConvertFrom-Json)
if (-not $entries.Count) {
  throw "Registry ist leer: $Registry"
}

$entry = $null
if ($Family) {
  $entry = $entries |
    Where-Object { $_.model_family -eq $Family -and $_.state -eq 'running' } |
    Sort-Object nr |
    Select-Object -First 1
} else {
  $entry = $entries | Where-Object { [int]$_.nr -eq $Nr } | Select-Object -First 1
}

if (-not $entry) {
  throw "Kein Registry-Eintrag gefunden (Nr=$Nr, Family=$Family). Verfuegbar: nr 1..$($entries.Count)"
}

$baseUrl = "http://127.0.0.1:$($entry.port)/v1"
$model = if ($entry.model_family -eq 'opus') { 'claude-opus-5.5' } else { 'gpt-6-astra' }

Write-Output "CURSOR BASE_URL : $baseUrl"
Write-Output "CURSOR API_KEY  : $($entry.unique_key)"
Write-Output "CURSOR MODEL    : $model"
Write-Output "KEY NR / PORT   : $($entry.nr) / $($entry.port)"
Write-Output "CONTAINER       : $($entry.container)"

if ($Check) {
  try {
    $resp = Invoke-WebRequest -Uri "$baseUrl/models" `
      -Headers @{ Authorization = "Bearer $($entry.unique_key)" } `
      -TimeoutSec 10 -UseBasicParsing
    $ids = @(($resp.Content | ConvertFrom-Json).data | Select-Object -ExpandProperty id)
    $hasModel = $ids -contains $model
    Write-Output "CHECK           : HTTP $($resp.StatusCode), $($ids.Count) Modelle, '$model' enthalten=$hasModel"
  } catch {
    Write-Output "CHECK           : FEHLER - $($_.Exception.Message)"
    exit 1
  }
}

if ($CopyKey) {
  try {
    Set-Clipboard -Value $entry.unique_key
    Write-Output "ZWISCHENABLAGE  : unique_key kopiert"
  } catch {
    Write-Output "ZWISCHENABLAGE  : FEHLER - $($_.Exception.Message)"
  }
}
