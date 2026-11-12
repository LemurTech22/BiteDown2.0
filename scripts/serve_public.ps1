# Put the local API (docker compose, 127.0.0.1:5055) on the internet for phones, and publish its address to the
# web app's api-config.json on Expo Hosting. The Android APK and the web app read that file at startup, so a new
# tunnel address never needs an app rebuild.
#
# Run from the repo root in its own window and leave it open (Ctrl-C stops the tunnel):
#   powershell -ExecutionPolicy Bypass -File scripts\serve_public.ps1
#
# Tunnel: Tailscale Funnel when it is enabled for this PC (stable https://<pc>.<tailnet>.ts.net address), otherwise a
# Cloudflare quick tunnel (free, no account; a new address on every start, which this script republishes).
# Needs: Docker Desktop running, `npx eas-cli login` done once (account that owns @bitedown/bitedown).
param(
  [int]$Port = 5055,
  [string]$Hosting = $(if ($env:BITEDOWN_WEB_URL) { $env:BITEDOWN_WEB_URL } else { 'https://bitedown.expo.app' }),
  [switch]$CloudflareOnly
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$client = Join-Path $repo 'client'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$cloudflared = @('C:\Program Files (x86)\cloudflared\cloudflared.exe', 'C:\Program Files\cloudflared\cloudflared.exe') |
  Where-Object { Test-Path $_ } | Select-Object -First 1
$logDir = Join-Path $env:TEMP 'bitedown-tunnel'
New-Item -ItemType Directory -Force $logDir | Out-Null

function Test-Health([string]$base) {
  try { return (Invoke-RestMethod -Uri "$base/health" -TimeoutSec 10).status -eq 'ok' } catch { return $false }
}

function Get-FunnelUrl {
  if ($CloudflareOnly -or -not (Test-Path $tailscale)) { return $null }
  $job = Start-Job { param($ts, $p) & $ts funnel --bg $p 2>&1 } -ArgumentList $tailscale, $Port
  Wait-Job $job -Timeout 25 | Out-Null
  $out = (Receive-Job $job) -join "`n"; Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force
  if ($out -match 'not enabled') { Write-Host 'Tailscale Funnel is not enabled for this tailnet; using Cloudflare.'; return $null }
  $status = (& $tailscale funnel status 2>&1) -join "`n"
  if ($status -match '(https://[a-z0-9.-]+\.ts\.net)[^\n]*\(Funnel on\)') { return $Matches[1] }
  return $null
}

function Start-Cloudflare {
  if (-not $cloudflared) { throw 'cloudflared not found: winget install Cloudflare.cloudflared' }
  $log = Join-Path $logDir "cloudflared-$(Get-Date -Format yyyyMMdd-HHmmss).log"
  $proc = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', "http://localhost:$Port" `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { return @{ Url = $m.Matches[0].Value; Process = $proc } }
    if ($proc.HasExited) { throw "cloudflared exited; see $log" }
    Start-Sleep 1
  }
  Stop-Process -Id $proc.Id -Force; throw "no tunnel URL after 60 s; see $log"
}

function Wait-Public([string]$url) {
  for ($i = 0; $i -lt 45; $i++) { if (Test-Health $url) { return $true }; Start-Sleep 2 }
  return $false
}

function Publish-ApiUrl([string]$url) {
  try { $current = (Invoke-RestMethod -Uri "$Hosting/api-config.json" -TimeoutSec 10 -Headers @{ 'Cache-Control' = 'no-cache' }).api_base_url } catch { $current = $null }
  if ($current -eq $url) { Write-Host "Web config already points at $url"; return }
  Write-Host "Publishing $url to $Hosting/api-config.json ..."
  Push-Location $client
  try {
    $env:EXPO_PUBLIC_API_BASE_URL = $url
    $env:EXPO_PUBLIC_API_CONFIG_URL = "$Hosting/api-config.json"
    npx expo export --platform web --output-dir dist --clear
    if ($LASTEXITCODE -ne 0) { throw 'expo export failed' }
    [IO.File]::WriteAllText((Join-Path $client 'dist\api-config.json'), (@{ api_base_url = $url } | ConvertTo-Json -Compress))
    npx --yes eas-cli@latest deploy --prod --non-interactive
    if ($LASTEXITCODE -ne 0) { throw 'eas deploy failed' }
  } finally { Pop-Location }
}

if (-not (Test-Health "http://127.0.0.1:$Port")) {
  Write-Host 'API not answering; starting docker compose ...'
  Push-Location $repo; docker compose up -d; Pop-Location
  if (-not (Wait-Public "http://127.0.0.1:$Port")) { throw "API not reachable at http://127.0.0.1:$Port/health" }
}
$corsLine = Select-String -Path (Join-Path $repo '.env') -Pattern '^CORS_ORIGINS=' -ErrorAction SilentlyContinue
if (-not $corsLine -or $corsLine.Line -notmatch [regex]::Escape($Hosting)) {
  Write-Warning "Add $Hosting to CORS_ORIGINS in .env, then: docker compose up -d --force-recreate api (the web app needs it)."
}

$tunnel = $null
$url = Get-FunnelUrl
if ($url) {
  Write-Host "Tailscale Funnel: $url"
  if (-not (Wait-Public $url)) { Write-Warning 'Funnel is on but /health does not answer yet; falling back to Cloudflare.'; $url = $null }
}
if (-not $url) {
  $tunnel = Start-Cloudflare; $url = $tunnel.Url
  Write-Host "Cloudflare tunnel: $url (pid $($tunnel.Process.Id))"
  if (-not (Wait-Public $url)) { Write-Warning "$url/health did not answer within 90 s (new hostnames can take a minute)." }
}
Publish-ApiUrl $url
Write-Host "`nBackend:  $url`nWeb app:  $Hosting`nLeave this window open. Ctrl-C stops the tunnel.`n"

$failures = 0
try {
  while ($true) {
    Start-Sleep 60
    if (Test-Health $url) { $failures = 0; continue }
    $failures++
    Write-Warning "$(Get-Date -Format HH:mm:ss) $url/health failed ($failures)"
    if ($failures -ge 3 -and $tunnel) {
      Write-Host 'Restarting the Cloudflare tunnel ...'
      Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue
      $tunnel = Start-Cloudflare; $url = $tunnel.Url
      if (Wait-Public $url) { Publish-ApiUrl $url; $failures = 0 }
    }
  }
} finally {
  if ($tunnel) { Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue }
}
