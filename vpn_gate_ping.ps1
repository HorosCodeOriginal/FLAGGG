# language: PowerShell 5.1+, file: vpn_gate_ping.ps1, target: Windows
# Pulls the VPN Gate relay list, picks 5 servers, pings each (ICMP, TCP fallback),
# and swaps dead relays for live ones until 5 answer or the pool is exhausted.

$ErrorActionPreference = 'Stop'
$API = 'https://www.vpngate.net/api/iphone/'
$Want = 5
$PingCount = 2

function Get-VpnGateServers {
    $raw = (Invoke-WebRequest -Uri $API -UseBasicParsing -TimeoutSec 30).Content
    $lines = $raw -split "`r?`n" | Where-Object { $_.Trim() -ne '' }
    $hdr = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -like '#HostName*') { $hdr = $i; break }
    }
    if ($hdr -lt 0) { throw 'No header row found in VPN Gate feed.' }
    # robust parse: keep only rows that carry a valid dotted-quad IP in field 2
    $rows = @()
    for ($i = $hdr + 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match '^([^,]+),([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+),(.*)$') {
            $f = $line -split ','
            $rows += [pscustomobject]@{
                HostName    = $f[0]
                IP          = $f[1]
                Ping        = $f[3]
                CountryLong = $f[5]
            }
        }
    }
    $rows
}

function Test-Relay {
    param([string]$Ip)
    $icmp = Test-Connection -ComputerName $Ip -Count $PingCount -ErrorAction SilentlyContinue
    if ($icmp) {
        $vals = $icmp | ForEach-Object {
            if ($null -ne $_.Latency) { $_.Latency } elseif ($null -ne $_.ResponseTime) { $_.ResponseTime }
        }
        $avg = ($vals | Measure-Object -Average).Average
        return [pscustomobject]@{ Method = 'ICMP'; Latency = [math]::Round($avg, 1); Ok = $true }
    }
    foreach ($port in 443, 1194) {
        try {
            $c = New-Object System.Net.Sockets.TcpClient
            $task = $c.ConnectAsync($Ip, $port)
            if ($task.Wait(3000) -and $c.Connected) {
                $c.Close()
                return [pscustomobject]@{ Method = "TCP/$port"; Latency = $null; Ok = $true }
            }
            $c.Close()
        } catch { }
    }
    return [pscustomobject]@{ Method = 'n/a'; Latency = $null; Ok = $false }
}

$servers = Get-VpnGateServers
Write-Output ("FEED total relays: " + $servers.Count)

# pool order: prefer low ping from the feed, then take the first 5 as candidates
$pool = @($servers | Sort-Object -Property @{ Expression = {
        $v = $_.Ping; if ($v -match '^\d+$') { [int]$v } else { [int]::MaxValue }
    }; Ascending = $true })
$selected = @()
$scanned = @()
foreach ($s in $pool) {
    if ($selected.Count -ge $Want) { break }
    if ($scanned -contains $s.IP) { continue }
    $scanned += $s.IP
    $probe = Test-Relay -Ip $s.IP
    $row = [pscustomobject]@{
        Rank = $selected.Count + 1
        HostName = $s.HostName
        IP = $s.IP
        Country = $s.CountryLong
        FeedPing = $s.Ping
        TestMethod = $probe.Method
        LatencyMs = $probe.Latency
        Status = $(if ($probe.Ok) { 'UP' } else { 'DOWN' })
    }
    if ($probe.Ok) { $selected += $row }
    Write-Output ("probe " + $s.IP + " -> " + $row.Status)
}
Write-Output ''
Write-Output ("RESULT live relays: " + $selected.Count + " / " + $Want)
$selected | Format-Table -AutoSize
if ($selected.Count -lt $Want) {
    Write-Output ("WARN only " + $selected.Count + " relays answered; feed had " + $servers.Count + " candidates.")
}
