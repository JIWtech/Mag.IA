const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../app/src');
const tests = fs.readdirSync(srcDir).filter(f => f.endsWith('.test.js')).sort();

const results = [];

for (const t of tests) {
  const filePath = path.join(srcDir, t);
  const content = fs.readFileSync(filePath, 'utf8');
  
  const hasDirname = content.includes('__dirname');
  const hasImportMeta = content.includes('import.meta');
  const hasFsRead = content.includes('readFileSync') || content.includes('readFile(');
  
  // Collect fs file reads
  const fsPaths = [];
  const lines = content.split('\n');
  lines.forEach(l => {
    if (l.includes('path.join') || l.includes('readFileSync') || l.includes('new URL(')) {
      fsPaths.push(l.trim());
    }
  });

  // Collect imports
  const relImports = [];
  const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    relImports.push(m[1]);
  }

  const isAstOrStatic = hasFsRead;

  results.push({
    file: t,
    isExtraction6b: t.startsWith('serviceExtraction6b'),
    isAstOrStatic,
    hasFsRead,
    hasDirname,
    fsPathsCount: fsPaths.length,
    fsPaths,
    relImports
  });
}

console.log('Total tests:', results.length);
console.log('Extraction 6B tests:', results.filter(r => r.isExtraction6b).length);
console.log('Tests reading files or AST:', results.filter(r => r.isAstOrStatic).length);
console.log('Pure functional/unit tests:', results.filter(r => !r.isAstOrStatic).length);

console.log('\n--- Tests reading source files directly via fs (AST/Regex/Inspection) ---');
results.filter(r => r.hasFsRead).forEach(r => {
  console.log(`${r.file} (${r.fsPaths.length} fs/path occurrences):`);
  r.fsPaths.forEach(p => console.log('   ' + p));
});

console.log('\n--- Relative imports that would be broken if moved to app/tests/ ---');
const allRelImports = new Set();
results.forEach(r => {
  r.relImports.forEach(imp => allRelImports.add(imp));
});
console.log('Distinct relative import prefixes in tests:');
Array.from(allRelImports).sort().forEach(imp => console.log('   ' + imp));
