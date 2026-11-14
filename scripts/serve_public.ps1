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
  if ($status -match '(https://[a-z0-9.-]+\.ts\.net)[^\n]*\(Funnel on\)') { $script:funnelOn = $true; return $Matches[1] }
  return $null
}

function Start-Cloudflare {
  if (-not $cloudflared) { throw 'cloudflared not found: winget install Cloudflare.cloudflared' }
  $log = Join-Path $logDir "cloudflared-$(Get-Date -Format yyyyMMdd-HHmmss).log"
  $proc = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', "http://localhost:$Port" `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    # Not api.trycloudflare.com: with no internet cloudflared logs "failed to request quick Tunnel: Post
    # https://api.trycloudflare.com/tunnel", and taking that for the tunnel address once got it published.
    $m = Select-String -Path $log -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { return @{ Url = $m.Matches[0].Value; Process = $proc } }
    if ($proc.HasExited) { throw "cloudflared exited; see $log" }
    Start-Sleep 1
  }
  Stop-Process -Id $proc.Id -Force; throw "no tunnel URL after 60 s; see $log"
}

function Test-Resolves([string]$url) {
  try { [void][System.Net.Dns]::GetHostAddresses(([Uri]$url).Host); return $true } catch { return $false }
}

function Wait-Public([string]$url) {
  for ($i = 0; $i -lt 45; $i++) { if (Test-Health $url) { return $true }; Start-Sleep 2 }
  return $false
}

function Publish-ApiUrl([string]$url) {
  $headers = @{ 'Cache-Control' = 'no-cache'; 'Pragma' = 'no-cache' }
  try { $current = (Invoke-RestMethod -Uri "$Hosting/api-config.json?cb=$([DateTime]::UtcNow.Ticks)" -TimeoutSec 10 -Headers $headers).api_base_url } catch { $current = $null }
  if ($current -eq $url) { Write-Host "Web config already points at $url"; return }
  Write-Host "Publishing $url to $Hosting/api-config.json ..."
  Push-Location $client
  try {
    $env:EXPO_PUBLIC_API_BASE_URL = $url
    $env:EXPO_PUBLIC_API_CONFIG_URL = "$Hosting/api-config.json"
    npx expo export --platform web --output-dir dist --clear
    if ($LASTEXITCODE -ne 0) { throw 'expo export failed' }
    [IO.File]::WriteAllText((Join-Path $client 'dist\api-config.json'), (@{ api_base_url = $url } | ConvertTo-Json -Compress))
    # Pinned: a new CLI release on the morning of the demo must not change how publishing behaves.
    npx --yes eas-cli@27.9.0 deploy --prod --non-interactive
    if ($LASTEXITCODE -ne 0) { throw 'eas deploy failed' }
  } finally { Pop-Location }
  try {
    $published = (Invoke-RestMethod -Uri "$Hosting/api-config.json?cb=$([DateTime]::UtcNow.Ticks)" -TimeoutSec 10 -Headers $headers).api_base_url
    if ($published -ne $url) { Write-Warning "Published config mismatch: expected api_base_url '$url', received '$published' from $Hosting/api-config.json." }
  } catch { Write-Warning "Publish completed, but checking $Hosting/api-config.json failed: $($_.Exception.Message)" }
}

function Try-PublishApiUrl([string]$url) {
  try {
    Publish-ApiUrl $url
    $script:publishPending = $false
  } catch {
    $script:publishPending = $true
    Write-Warning "API URL PUBLISH FAILED: $($_.Exception.Message). Keeping the tunnel running; retrying in 2 minutes."
  } finally { $script:nextPublishAttempt = (Get-Date).AddMinutes(2) }
}

$lastComposeAttempt = $null
if (-not (Test-Health "http://127.0.0.1:$Port")) {
  Write-Host 'API not answering; starting docker compose ...'
  $lastComposeAttempt = Get-Date
  Push-Location $repo
  try { docker compose up -d } finally { Pop-Location }
  if (-not (Wait-Public "http://127.0.0.1:$Port")) { throw "API not reachable at http://127.0.0.1:$Port/health" }
}
try {
  Push-Location $repo
  try {
    $dbContainer = docker compose ps -q db
    if ($LASTEXITCODE -ne 0 -or -not $dbContainer) { throw 'Could not find the compose db container.' }
    $dbHealth = docker inspect --format '{{.State.Health.Status}}' $dbContainer
    if ($LASTEXITCODE -ne 0) { throw 'docker inspect failed for the db container.' }
    if ($dbHealth -ne 'healthy') { Write-Warning "Database container is not healthy (status: $dbHealth)." }
  } finally { Pop-Location }
} catch { Write-Warning "Database health check failed: $($_.Exception.Message)" }

try {
  $preflight = Invoke-WebRequest -UseBasicParsing -Method Options -Uri "http://127.0.0.1:$Port/auth/login" -TimeoutSec 10 -Headers @{
    'Origin' = $Hosting
    'Access-Control-Request-Method' = 'POST'
    'Access-Control-Request-Headers' = 'authorization,content-type'
  }
  if ($preflight.Headers['Access-Control-Allow-Origin'] -cne $Hosting) { throw 'Access-Control-Allow-Origin does not match the web origin.' }
} catch {
  Write-Warning "CORS preflight failed: $($_.Exception.Message) Add $Hosting to CORS_ORIGINS in .env, then run: docker compose up -d --force-recreate api (the APK still works)."
}

$tunnel = $null
$failures = 0
try {
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
  Try-PublishApiUrl $url
  Write-Host "`n========== Demo URLs ==========`nBackend URL: $url`nWeb URL:     $Hosting`nThe APK reads the same api-config.json as the web app.`nLeave this window open. Stop with Ctrl-C (closing the window skips the cleanup).`n===============================`n"

  while ($true) {
    Start-Sleep 60
    if ($publishPending -and (Get-Date) -ge $nextPublishAttempt) { Try-PublishApiUrl $url }
    if (Test-Health $url) { $failures = 0; continue }
    if (-not (Test-Health "http://127.0.0.1:$Port")) {
      $failures = 0
      Write-Warning "$(Get-Date -Format HH:mm:ss) The API itself is down or overloaded at http://127.0.0.1:$Port/health; keeping the tunnel running."
      if ($null -eq $lastComposeAttempt -or (Get-Date) -ge $lastComposeAttempt.AddMinutes(5)) {
        $lastComposeAttempt = Get-Date
        try {
          Push-Location $repo
          try {
            docker compose up -d
            if ($LASTEXITCODE -ne 0) { throw 'docker compose up -d failed' }
          } finally { Pop-Location }
        } catch { Write-Warning "API recovery failed: $($_.Exception.Message). Will retry no sooner than 5 minutes after this attempt." }
      }
      continue
    }
    # A new trycloudflare name can stay unresolvable on this PC for minutes (the router caches "not found") while
    # phones reach it fine. That is not a dead tunnel, so it counts as a failure only once cloudflared has exited.
    if ($tunnel -and -not $tunnel.Process.HasExited -and -not (Test-Resolves $url)) {
      Write-Warning "$(Get-Date -Format HH:mm:ss) This PC can't resolve $url yet (local DNS cache); not counting it as a tunnel failure."
      continue
    }
    $failures++
    Write-Warning "$(Get-Date -Format HH:mm:ss) $url/health failed ($failures)"
    if ($failures -ge 3 -and $tunnel) {
      Write-Host 'Restarting the Cloudflare tunnel ...'
      # HasExited reads the process handle, so a reused PID is never killed.
      if (-not $tunnel.Process.HasExited) { Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue }
      # A failed restart must not end the script: keep the dead tunnel object so the next round retries.
      try { $newTunnel = Start-Cloudflare } catch { Write-Warning "Cloudflare restart failed: $($_.Exception.Message). Retrying in about 3 minutes."; $failures = 0; continue }
      $tunnel = $newTunnel; $url = $tunnel.Url
      $publishPending = $true
      $nextPublishAttempt = Get-Date
      if (Wait-Public $url) { Try-PublishApiUrl $url }
      $failures = 0
    }
  }
} finally {
  if ($tunnel -and -not $tunnel.Process.HasExited) { Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue }
  # `funnel --bg` lives on in the Tailscale daemon; turn it off so the API is public only while this script runs.
  if ($script:funnelOn) { & $tailscale funnel --https=443 off 2>&1 | Out-Null; Write-Host 'Tailscale Funnel turned off.' }
}
