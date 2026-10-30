# cursor-provider.ps1 — schaltet den OpenAI-kompatiblen Cursor-Provider um.
# Cursor unterstuetzt jeweils EINEN aktiven OpenAI-BaseURL/Key-Satz (settings.json).
# Dieser Helper stellt zwischen den drei lokalen Welten um:
#
#   -pool     -> Mercury-Pool (alle 11 Inception-APIs, Port 20199, Modell mercury-3)
#   -astra    -> Astra 1 Gateway (Port 20129, Modell gpt-6-astra)
#   -opus     -> Opus 1 Gateway (Port 20152, Modell claude-opus-5.5)
#   -gateway  -> fr-gateway-Container (Port 20129): ALLE Modelle waehlbar
#                (gpt-6-astra, claude-opus-5.5, mercury-3)
#   -list     -> aktuell gesetzten Provider zeigen
#
# Nutzung:  powershell -File scripts/cursor-provider.ps1 -Set pool
#            powershell -File scripts/cursor-provider.ps1 -Set astra
#            powershell -File scripts/cursor-provider.ps1 -List
# Danach in Cursor: "Reload Window" (Strg+Shift+P -> Reload Window) oder Cursor neu starten.

param(
  [ValidateSet('pool','astra','opus','gateway','list')]
  [string]$Set = 'list'
)

$settingsPath = Join-Path $env:APPDATA 'Cursor\User\settings.json'
if (-not (Test-Path $settingsPath)) {
  Write-Error "Cursor settings.json nicht gefunden: $settingsPath"
  exit 1
}

$json = Get-Content $settingsPath -Raw | ConvertFrom-Json

$providers = @{
  pool  = @{ url = 'http://127.0.0.1:20199/v1'; key = 'local-pool'; model = 'mercury-3' }
  astra = @{ url = 'http://127.0.0.1:20129/v1'; key = 'vkd-in7DlNCMnr-bgceNK615zpdWT-Sj2FSOlz5aayUIbZ8'; model = 'gpt-6-astra' }
  opus  = @{ url = 'http://127.0.0.1:20152/v1'; key = 'vkd-vq8Q-D6_UhuOC4iu6PYpGpuSw7SYtknlNMRg-Xn7G2E'; model = 'claude-opus-5.5' }
  gateway = @{ url = 'http://127.0.0.1:20129/v1'; key = 'vkd-in7DlNCMnr-bgceNK615zpdWT-Sj2FSOlz5aayUIbZ8'; model = 'gpt-6-astra / claude-opus-5.5 / mercury-3' }
}

if ($Set -eq 'list') {
  $cur = $json.'openai.baseURL'
  Write-Output "Aktiver Cursor-Provider: $cur"
  Write-Output "Verfügbare Welten:"
  foreach ($name in $providers.Keys | Sort-Object) {
    Write-Output ("  {0,-5} -> {1}  (Modell {2})" -f $name, $providers[$name].url, $providers[$name].model)
  }
  exit 0
}

$p = $providers[$Set]

# Neues settings.json-Objekt bauen (bestehende Keys erhalten)
$new = @{}
$json.PSObject.Properties | ForEach-Object { $new[$_.Name] = $_.Value }
$new['openai.baseURL'] = $p.url
$new['openai.apiKey'] = $p.key

$new | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding utf8
Write-Output "Cursor-Provider gesetzt: $Set -> $($p.url) (Modell $($p.model))"
Write-Output "Bitte Cursor neu laden (Strg+Shift+P -> Reload Window) bzw. neu starten."
