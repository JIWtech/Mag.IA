$ErrorActionPreference = "Continue"

Write-Host "Mag.IA - checagem local" -ForegroundColor Cyan
Write-Host ""

Write-Host "Docker containers:" -ForegroundColor Yellow
docker ps --filter "name=n8n" --filter "name=evolution" --filter "name=redis" --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

Write-Host ""
Write-Host "n8n health:" -ForegroundColor Yellow
try {
  Invoke-WebRequest -Uri "http://localhost:5678/healthz" -UseBasicParsing -TimeoutSec 8 |
    Select-Object StatusCode, Content |
    Format-List
} catch {
  Write-Host "n8n indisponivel: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Interface:" -ForegroundColor Yellow
try {
  Invoke-WebRequest -Uri "http://localhost:5174" -UseBasicParsing -TimeoutSec 8 |
    Select-Object StatusCode |
    Format-List
} catch {
  Write-Host "Interface indisponivel: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Workflows ativos no n8n local:" -ForegroundColor Yellow
try {
  @'
select id, active, name
from workflow_entity
where id in ('jiwTelegramReal01','magiaCommandRouter01','jiwTelegramMock01','jiwInstagramReal01')
order by id;
'@ | docker exec -i n8n_postgres psql -U n8n -d n8n
} catch {
  Write-Host "Nao foi possivel consultar workflows: $($_.Exception.Message)" -ForegroundColor Red
}
