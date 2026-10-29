# language: PowerShell, file: gateway_api_test.ps1, target: Windows
# Testet 5 fr-gateway-APIs (registry nr 1..5): TCP-Probe -> GET /v1/models -> POST chat "ping" (pong).
$ErrorActionPreference = 'Stop'
$Registry = Join-Path $PSScriptRoot 'fr-gateway\secrets\registry.json'
$Entries = @(Get-Content -Raw $Registry | ConvertFrom-Json | Select-Object -First 5)

function Test-TcpPort {
    param([int]$Port, [int]$TimeoutMs = 3000)
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $t = $c.ConnectAsync('127.0.0.1', $Port)
        if ($t.Wait($TimeoutMs) -and $c.Connected) { $c.Close(); return $true }
        $c.Close(); return $false
    } catch { return $false }
}

$results = @()
foreach ($e in $Entries) {
    $base = "http://127.0.0.1:$($e.port)"
    $hdr = @{ Authorization = "Bearer $($e.unique_key)" }
    $row = [pscustomobject]@{
        Nr = $e.nr
        Port = $e.port
        Family = $e.model_family
        Container = $e.container
        Tcp = $false
        Models = $null
        ModelsMs = $null
        Chat = $null
        ChatMs = $null
        Pong = $null
    }
    $row.Tcp = Test-TcpPort -Port $e.port
    if (-not $row.Tcp) { $results += $row; continue }

    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $models = Invoke-RestMethod -Uri "$base/v1/models" -Headers $hdr -TimeoutSec 10
        $sw.Stop()
        $row.Models = '200'
        $row.ModelsMs = $sw.ElapsedMilliseconds
        $row.Models = ($models.data | ForEach-Object { $_.id }) -join ','
    } catch {
        $row.Models = $_.Exception.Message
    }

    try {
        $body = @{ model = $e.model_family; messages = @(@{ role = 'user'; content = 'ping' }); max_tokens = 64 } | ConvertTo-Json -Depth 5 -Compress
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $resp = Invoke-WebRequest -Uri "$base/v1/chat/completions" -Method Post -Headers $hdr -ContentType 'application/json' -Body $body -TimeoutSec 60 -UseBasicParsing
        $sw.Stop()
        # extract the first complete JSON object; SSE trailers ("data: [DONE]") follow on later lines
        $m = [regex]::Match($resp.Content, '(?s)^(\{.*\})')
        if (-not $m.Success) { throw 'no JSON object in chat response' }
        $parsed = $m.Groups[1].Value | ConvertFrom-Json
        $row.Chat = '200'
        $row.ChatMs = $sw.ElapsedMilliseconds
        $row.Pong = $parsed.choices[0].message.content
    } catch {
        $row.Chat = $_.Exception.Message
    }
    $results += $row
}

$results | ConvertTo-Json -Depth 4
Write-Output ("RESULT " + (($results | Where-Object { $_.Chat -eq '200' }).Count) + "/5 chat-ping OK")
