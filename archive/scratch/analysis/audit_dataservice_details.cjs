const fs = require('fs');
const path = require('path');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const srcDir = path.resolve(__dirname, '../app/src');
const dataServicePath = path.resolve(srcDir, 'dataService.js');
const dsCode = fs.readFileSync(dataServicePath, 'utf8');

const summary = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'dataservice_ast_summary.json'), 'utf8'));

// 1. Inspect imports in dataService.js
console.log('=== IMPORTS IN dataService.js ===');
summary.imports.forEach(imp => {
  const specStr = imp.specifiers.map(s => s.type === 'default' ? s.local : (s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`)).join(', ');
  console.log(`Line ${imp.line}: import { ${specStr} } from '${imp.source}'`);
});

// 2. Find module-level Map/Set/Cache/Timers
console.log('\n=== MODULE-LEVEL CACHES / MUTABLE OBJECTS ===');
const dsAst = parser.parse(dsCode, { sourceType: 'module', plugins: ['jsx'] });
dsAst.program.body.forEach(node => {
  if (node.type === 'VariableDeclaration') {
    node.declarations.forEach(d => {
      const name = d.id.name;
      if (d.init) {
        const initStr = dsCode.slice(d.init.start, d.init.end);
        if (initStr.includes('new Map') || initStr.includes('new Set') || initStr.includes('{}') || initStr.includes('[]')) {
          if (!d.init.type.includes('Function')) {
            console.log(`Line ${node.loc.start.line}: ${node.kind} ${name} = ${initStr.slice(0, 60)}`);
          }
        }
      }
    });
  }
});

// 3. Find consumers of all 106 exports across app/src
console.log('\n=== SCANNING CONSUMERS OF EXPORTS ===');
function getAllFiles(dir) {
  let res = [];
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== 'dist') res = res.concat(getAllFiles(full));
    } else if (f.endsWith('.js') || f.endsWith('.jsx')) {
      res.push(full);
    }
  });
  return res;
}

const allFiles = getAllFiles(srcDir);
const exportConsumers = {};
summary.exports.forEach(exp => {
  exportConsumers[exp.name] = {
    exportInfo: exp,
    consumers: []
  };
});

allFiles.forEach(file => {
  if (file === dataServicePath) return;
  const relPath = path.relative(srcDir, file).replace(/\\/g, '/');
  const fileContent = fs.readFileSync(file, 'utf8');

  // Check if file imports from dataService
  if (!fileContent.includes('dataService')) return;

  try {
    const fileAst = parser.parse(fileContent, { sourceType: 'module', plugins: ['jsx'] });
    traverse(fileAst, {
      ImportDeclaration(p) {
        if (p.node.source.value.includes('dataService')) {
          p.node.specifiers.forEach(s => {
            const importedName = s.imported ? s.imported.name : (s.type === 'ImportDefaultSpecifier' ? 'default' : null);
            if (importedName && exportConsumers[importedName]) {
              if (!exportConsumers[importedName].consumers.includes(relPath)) {
                exportConsumers[importedName].consumers.push(relPath);
              }
            }
          });
        }
      }
    });
  } catch (e) {
    // Regex fallback if syntax error
    summary.exports.forEach(exp => {
      const regex = new RegExp(`\\b${exp.name}\\b`);
      if (regex.test(fileContent)) {
        if (!exportConsumers[exp.name].consumers.includes(relPath)) {
          exportConsumers[exp.name].consumers.push(relPath);
        }
      }
    });
  }
});

fs.writeFileSync(path.resolve(__dirname, 'export_consumers.json'), JSON.stringify(exportConsumers, null, 2), 'utf8');
console.log('Saved export consumers to scratch/export_consumers.json');

// Categorize export usage counts
let zeroConsumerCount = 0;
let usedCount = 0;
for (const [name, data] of Object.entries(exportConsumers)) {
  if (data.consumers.length === 0) zeroConsumerCount++;
  else usedCount++;
}
console.log(`Exports with active external consumers: ${usedCount}`);
console.log(`Exports with 0 external consumers (only used internally or in tests/untested): ${zeroConsumerCount}`);
