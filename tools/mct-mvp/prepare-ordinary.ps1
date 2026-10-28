param(
    [string]$RuntimeSource = 'D:\workshop\Game\mc-pilot-deployment\run\tellus-boundary-20261025'
)
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverDir = Join-Path $projectDir 'run\ordinary-mvp-1.20.1'
if (Test-Path -LiteralPath $serverDir) { throw 'The ordinary demo server directory already exists; inspect it before preparing again.' }
foreach ($p in @((Join-Path $RuntimeSource 'server.jar'), (Join-Path $RuntimeSource 'libraries'), (Join-Path $RuntimeSource 'versions'), (Join-Path $RuntimeSource '.fabric\server'))) {
    if (!(Test-Path -LiteralPath $p)) { throw "Missing runtime input: $p" }
}
New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'server.jar') -Destination $serverDir
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'libraries'), (Join-Path $RuntimeSource 'versions') -Destination $serverDir -Recurse
New-Item -ItemType Directory -Path (Join-Path $serverDir '.fabric') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeSource '.fabric\server') -Destination (Join-Path $serverDir '.fabric') -Recurse
@'
server-ip=127.0.0.1
server-port=25586
online-mode=false
enforce-secure-profile=false
enable-rcon=true
rcon.port=25575
 rcon.password=mct-observability
enable-query=false
gamemode=creative
force-gamemode=true
difficulty=peaceful
hardcore=false
pvp=false
allow-flight=true
max-players=8
view-distance=6
simulation-distance=4
spawn-protection=0
spawn-monsters=false
spawn-animals=false
spawn-npcs=true
level-name=world
level-seed=mct-observability-20261028
level-type=minecraft:normal
generate-structures=true
motd=MCT in-game observability demo
'@ | Set-Content -LiteralPath (Join-Path $serverDir 'server.properties') -Encoding ascii
Write-Output "Prepared ordinary Minecraft server at $serverDir. No Tellus jar or mod was copied."
