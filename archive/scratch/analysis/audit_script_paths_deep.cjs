const fs = require('fs');
const path = require('path');

const scriptsDir = path.resolve(__dirname, '../scripts');

for (const f of fs.readdirSync(scriptsDir).sort()) {
  const full = path.join(scriptsDir, f);
  if (fs.statSync(full).isDirectory()) continue;
  const content = fs.readFileSync(full, 'utf8');
  const lines = content.split('\n');
  const matches = [];
  lines.forEach((l, i) => {
    if (l.includes('__dirname') || l.includes('require(') || l.includes('import(') || l.includes('path.join') || l.includes('path.resolve')) {
      matches.push(`L${i+1}: ${l.trim()}`);
    }
  });
  console.log(`=== ${f} (${matches.length} path lines) ===`);
  matches.forEach(m => console.log('   ' + m));
}
