const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../app/src');
const tests = fs.readdirSync(srcDir).filter(f => f.endsWith('.test.js')).sort();

const summary = tests.map(f => {
  const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const usesDirname = content.includes('__dirname');
  const usesImportMeta = content.includes('import.meta');
  const usesFsRead = content.includes('readFileSync');
  const relImports = content.match(/from\s+['"][^'"]+['"]/g) || [];
  const fsPaths = content.match(/path\.join\([^)]+\)/g) || [];
  return {
    file: f,
    lines: content.split('\n').length,
    usesDirname,
    usesImportMeta,
    usesFsRead,
    relImportsCount: relImports.length,
    fsPathsCount: fsPaths.length,
    fsPathsSample: fsPaths.slice(0, 3)
  };
});

console.log('Total tests:', summary.length);
console.log('Tests with __dirname or import.meta:', summary.filter(s => s.usesDirname || s.usesImportMeta).length);
console.log('Tests with fs.readFileSync:', summary.filter(s => s.usesFsRead).length);
console.log('Detailed list:');
summary.forEach(s => {
  console.log(`${s.file}: lines=${s.lines}, dirname=${s.usesDirname}, readFileSync=${s.usesFsRead}, fsPaths=${s.fsPathsCount}`);
  if (s.fsPathsSample.length) {
    console.log('   samples:', s.fsPathsSample.join(' | '));
  }
});
