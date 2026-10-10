$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$app = Join-Path $root "app"

Set-Location $app
npm run dev -- --host 0.0.0.0 --port 5174
