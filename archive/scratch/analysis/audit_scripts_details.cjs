const fs = require('fs');
const path = require('path');

const scriptsDir = path.join(__dirname, '../scripts');
const files = fs.readdirSync(scriptsDir).sort();

const summary = files.map(f => {
  const full = path.join(scriptsDir, f);
  const content = fs.readFileSync(full, 'utf8');
  const firstLines = content.split('\n').slice(0, 10).join(' ').replace(/\r/g, '');
  
  let category = 'operacional';
  if (f.startsWith('build_') && f.includes('workflow')) category = 'gerador_workflow_n8n';
  else if (f.startsWith('build_') && f.includes('sql')) category = 'gerador_sql';
  else if (f.startsWith('build_')) category = 'gerador_n8n_code';
  else if (f.startsWith('test_') || f.startsWith('smoke_')) category = 'teste_externo';
  else if (f.startsWith('dry_run_') || f.startsWith('fix_') || f.startsWith('sync_') || f.startsWith('cache_')) category = 'manutencao_migracao';
  else if (f.endsWith('.ps1')) category = 'script_operacional_powershell';
  else if (f.startsWith('update_') || f.startsWith('generate_')) category = 'legado_piloto';

  return { file: f, category, preview: firstLines.slice(0, 120) };
});

console.log(JSON.stringify(summary, null, 2));
