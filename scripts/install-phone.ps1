# Build the Hey Ann wall app and install it on the phone over Wi-Fi (or USB if plugged in). Settings and pairing are kept.
#
#   powershell -File scripts/install-phone.ps1            # build + install
#   powershell -File scripts/install-phone.ps1 -NoBuild   # install the last build
#
# One-time setup (same Wi-Fi as this PC):
#   Phone: Developer options > Wireless debugging > on > "Pair device with pairing code".
#   PC:    adb pair <ip>:<pairing port>   (type the 6-digit code when asked)
# After that, just turn Wireless debugging on (the Quick Settings tile is easiest) and run this script.
param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $adb)) { throw "adb not found at $adb (install Android SDK platform-tools)." }

if (-not $NoBuild) {
  Write-Host 'Building...' -ForegroundColor Cyan
  Push-Location (Join-Path $root 'android')
  try { & .\gradlew.bat assembleDebug -q; if ($LASTEXITCODE) { throw 'Build failed.' } } finally { Pop-Location }
}
if (-not (Test-Path $apk)) { throw "No APK at $apk. Run without -NoBuild." }

# Only real phones: never an emulator.
function Get-Phones { & $adb devices | Select-String '^(\S+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object { $_ -notlike 'emulator-*' } }

$phones = @(Get-Phones)
if (-not $phones) {
  # A paired phone with Wireless debugging on advertises itself over mDNS on the local network.
  Write-Host 'Looking for the phone on Wi-Fi...' -ForegroundColor Cyan
  foreach ($line in (& $adb mdns services)) {
    if ($line -match '_adb-tls-connect\._tcp\S*\s+(\d+\.\d+\.\d+\.\d+:\d+)') { & $adb connect $Matches[1] | Out-Null }
  }
  Start-Sleep -Seconds 2
  $phones = @(Get-Phones)
}
if (-not $phones) { throw 'No phone found. Turn on Wireless debugging (same Wi-Fi as this PC) or plug in USB, then retry. First time? See the pairing steps at the top of this script.' }
if ($phones.Count -gt 1) { throw "More than one phone connected: $($phones -join ', '). Disconnect the extras." }

Write-Host "Installing on $($phones[0])..." -ForegroundColor Cyan
& $adb -s $phones[0] install --user 0 -r $apk
if ($LASTEXITCODE) { throw 'Install failed.' }
Write-Host 'Done. You can turn Wireless debugging off again.' -ForegroundColor Green
