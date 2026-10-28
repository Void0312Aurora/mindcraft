param(
    [string]$RuntimeSource = $env:MCT_RUNTIME_SOURCE,
    [string]$RuntimeProfile = $env:MCT_RUNTIME_PROFILE
)
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtime = Get-Content -Raw (Join-Path $projectDir 'config\mct-mvp\runtime.json') | ConvertFrom-Json
$profileName = if ([string]::IsNullOrWhiteSpace($RuntimeProfile)) { 'survival' } else { $RuntimeProfile }
$profile = $runtime.environments.$profileName
if ($null -eq $profile) { throw "Unknown runtime profile: $profileName" }
$serverDir = Join-Path $projectDir ('run\' + $profile.minecraft.server)
if ([string]::IsNullOrWhiteSpace($RuntimeSource)) {
    throw 'Set MCT_RUNTIME_SOURCE to a generic Fabric 1.20.1 server runtime. The old Tellus runtime path is intentionally not used by this script.'
}
if (Test-Path -LiteralPath $serverDir) { throw 'The ordinary demo server directory already exists; inspect it before preparing again.' }
foreach ($p in @((Join-Path $RuntimeSource 'server.jar'), (Join-Path $RuntimeSource 'libraries'), (Join-Path $RuntimeSource 'versions'), (Join-Path $RuntimeSource '.fabric\server'))) {
    if (!(Test-Path -LiteralPath $p)) { throw "Missing runtime input: $p" }
}
New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'server.jar') -Destination $serverDir
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'libraries'), (Join-Path $RuntimeSource 'versions') -Destination $serverDir -Recurse
New-Item -ItemType Directory -Path (Join-Path $serverDir '.fabric') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeSource '.fabric\server') -Destination (Join-Path $serverDir '.fabric') -Recurse
@"
server-ip=127.0.0.1
server-port=$($profile.minecraft.port)
online-mode=false
enforce-secure-profile=false
enable-rcon=true
rcon.port=$($profile.minecraft.rcon_port)
rcon.password=mct-observability
enable-query=false
gamemode=$($profile.gameplay.gamemode)
force-gamemode=$($profile.gameplay.force_gamemode.ToString().ToLowerInvariant())
difficulty=$($profile.gameplay.difficulty)
hardcore=false
pvp=$($profile.gameplay.pvp.ToString().ToLowerInvariant())
allow-flight=$($profile.gameplay.allow_flight.ToString().ToLowerInvariant())
max-players=8
view-distance=6
simulation-distance=4
spawn-protection=0
spawn-monsters=$($profile.gameplay.spawn_monsters.ToString().ToLowerInvariant())
spawn-animals=$($profile.gameplay.spawn_animals.ToString().ToLowerInvariant())
spawn-npcs=true
level-name=world
level-seed=$($profile.gameplay.level_seed)
level-type=minecraft:normal
generate-structures=true
motd=MCT in-game observability demo
"@ | Set-Content -LiteralPath (Join-Path $serverDir 'server.properties') -Encoding ascii
Write-Output "Prepared ordinary Minecraft server at $serverDir for profile '$profileName'. No Tellus jar or mod was copied."
