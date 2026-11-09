param(
    [Parameter(Mandatory)] [string] $AppDirectory,
    [Parameter(Mandatory)] [string] $Installer
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    (Get-Process -Name stremio -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stremio')) {
    throw 'Run this install/uninstall test only on a clean GitHub-hosted Windows runner.'
}

$appData = [Environment]::GetFolderPath('LocalApplicationData')
if (-not $appData) { throw 'Local app data is unavailable.' }
$dataRoot = Join-Path $appData 'EzrasStremio'
if (Test-Path -LiteralPath $dataRoot) { throw 'Existing Library storage found on the runner.' }

function Run-TestProcess([string] $Path, [string] $Arguments = '') {
    $options = @{ FilePath = $Path; WorkingDirectory = Split-Path -Parent $Path; WindowStyle = 'Hidden'; PassThru = $true }
    if ($Arguments) { $options.ArgumentList = $Arguments }
    $process = Start-Process @options
    if (-not $process.WaitForExit(120000)) {
        $process.Kill()
        throw "Timed out waiting for $Path"
    }
    if ($process.ExitCode -ne 0) { throw "$Path exited with code $($process.ExitCode)." }
}

$probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('ezras-stremio-test-' + [guid]::NewGuid().ToString('N'))
$probeApp = Join-Path $probeRoot 'second-launch'
$configDir = Join-Path $probeApp 'portable_config'
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$app = (Resolve-Path -LiteralPath $AppDirectory).Path
Copy-Item -LiteralPath @('stremio.exe', 'libmpv-2.dll', 'vulkan-1.dll').ForEach({ Join-Path $app $_ }) -Destination $probeApp
$config = Join-Path $configDir 'stremio-settings.ini'
@('[General]', 'CloseOnExit=1', 'UseDarkTheme=0', 'PauseOnMinimize=0', 'DiscordRPC=0') |
    Set-Content -LiteralPath $config -Encoding ascii
$before = (Get-FileHash -LiteralPath $config).Hash
$created = $false
$mutex = [Threading.Mutex]::new($false, 'SingleInstanceMtx_StremioWebShell', [ref]$created)
try {
    if (-not $created) { throw 'The single-instance mutex is already in use.' }
    Run-TestProcess (Join-Path $probeApp 'stremio.exe')
    if ((Get-FileHash -LiteralPath $config).Hash -ne $before) { throw 'A second launch overwrote saved settings.' }
} finally {
    $mutex.Dispose()
}

$library = Join-Path $dataRoot 'Library'
New-Item -ItemType Directory -Path $library -Force | Out-Null
$record = Join-Path $library (('a' * 64) + '.json')
$temporaryRecord = "$record.tmp"
$neighbor = Join-Path $dataRoot 'unrelated.txt'
Set-Content -LiteralPath $record -Value '{"version":1,"revision":1,"lists":[],"migrated":[]}'
Set-Content -LiteralPath $temporaryRecord -Value 'test interrupted write'
Set-Content -LiteralPath $neighbor -Value 'test unrelated data'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$install = Join-Path $probeRoot 'installation'
$uninstaller = Join-Path $install 'Uninstall.exe'
Run-TestProcess $installerPath "/S /nodesktopicon /D=$install"
Run-TestProcess $uninstaller "/S /keepdata _?=$install"
if (-not (Test-Path -LiteralPath $record) -or -not (Test-Path -LiteralPath $temporaryRecord)) {
    throw 'The keep-data uninstall removed saved Library data.'
}
Run-TestProcess $installerPath "/S /nodesktopicon /D=$install"
Run-TestProcess $uninstaller "/S _?=$install"
if ((Test-Path -LiteralPath $library) -or -not (Test-Path -LiteralPath $neighbor)) {
    throw 'The remove-data uninstall did not clear just the Library store.'
}

Write-Host 'PASS: a second launch preserves settings, and both uninstall choices honor Library data.'
