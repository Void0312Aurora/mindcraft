$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$cliPath = 'D:\workshop\Game\mc-pilot-deployment\mc-pilot\cli\bin\mct'
if (!(Test-Path -LiteralPath $cliPath)) { throw "MC Pilot CLI missing: $cliPath" }
& node $cliPath --project $projectDir @args
exit $LASTEXITCODE
