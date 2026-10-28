param(
    [string]$RuntimeSource = 'D:\workshop\Game\mc-pilot-deployment\run\tellus-boundary-20261025',
    [string]$TellusJar = 'D:\workshop\Game\Tellus-Optimized-rfc\mc1201\build\libs\Tellus-fabric-1.20.1-0.8.3.jar'
)
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverDir = Join-Path $projectDir 'run\tellus-mvp-1.20.1'
if (Test-Path -LiteralPath $serverDir) { throw 'The dedicated server directory already exists; preserve its world and inspect it before preparing again.' }
foreach ($p in @((Join-Path $RuntimeSource 'server.jar'), (Join-Path $RuntimeSource 'libraries'), (Join-Path $RuntimeSource 'versions'), (Join-Path $RuntimeSource '.fabric\server'), $TellusJar)) {
    if (!(Test-Path -LiteralPath $p)) { throw "Missing runtime input: $p" }
}
$fabricApi = Get-ChildItem -LiteralPath (Join-Path $RuntimeSource 'mods') -Filter 'fabric-api-*.jar' | Select-Object -First 1
if (!$fabricApi) { throw 'Fabric API is missing from the runtime source.' }
New-Item -ItemType Directory -Path (Join-Path $serverDir 'mods'), (Join-Path $serverDir 'world\datapacks') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'server.jar') -Destination $serverDir
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'libraries'), (Join-Path $RuntimeSource 'versions') -Destination $serverDir -Recurse
New-Item -ItemType Directory -Path (Join-Path $serverDir '.fabric') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeSource '.fabric\server') -Destination (Join-Path $serverDir '.fabric') -Recurse
Copy-Item -LiteralPath $fabricApi.FullName, $TellusJar -Destination (Join-Path $serverDir 'mods')
Copy-Item -LiteralPath (Join-Path $projectDir 'config\mct-mvp\datapack') -Destination (Join-Path $serverDir 'world\datapacks\mct-mvp') -Recurse
@'
server-ip=127.0.0.1
server-port=25585
online-mode=false
enforce-secure-profile=false
enable-rcon=false
enable-query=false
gamemode=survival
force-gamemode=true
difficulty=normal
hardcore=false
pvp=false
allow-flight=false
max-players=8
view-distance=4
simulation-distance=4
spawn-protection=0
spawn-monsters=true
spawn-animals=true
spawn-npcs=true
level-name=world
level-seed=mct-journey-mvp-20261027
level-type=mct:journey
initial-enabled-packs=vanilla,fabric,file/mct-mvp
generate-structures=true
motd=MCT three-agent survival journey MVP
'@ | Set-Content -LiteralPath (Join-Path $serverDir 'server.properties') -Encoding ascii
$artifacts = @((Join-Path $serverDir 'server.jar')) + @(Get-ChildItem -LiteralPath (Join-Path $serverDir 'mods') -File | Select-Object -ExpandProperty FullName)
$manifest = [ordered]@{
    preparedAt = (Get-Date).ToUniversalTime().ToString('o')
    runtimeSource = $RuntimeSource
    tellusSource = $TellusJar
    tellusSourceCommit = (& git -C 'D:\workshop\Game\Tellus-Optimized-rfc' rev-parse HEAD)
    scope = 'Regional Earth generator; no cube-net seam validation.'
    files = @($artifacts | ForEach-Object { Get-FileHash -LiteralPath $_ -Algorithm SHA256 | Select-Object Path, Hash })
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $serverDir 'artifacts.json') -Encoding utf8
Write-Output "Prepared $serverDir. EULA is not copied; start with the normal MC Pilot EULA option."
