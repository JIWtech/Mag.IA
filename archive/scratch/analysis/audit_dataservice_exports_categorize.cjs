const fs = require('fs');
const path = require('path');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const dataServicePath = path.resolve(__dirname, '../app/src/dataService.js');
const dsCode = fs.readFileSync(dataServicePath, 'utf8');

const ast = parser.parse(dsCode, { sourceType: 'module', plugins: ['jsx'] });
const consumers = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'export_consumers.json'), 'utf8'));

// Build internal call graph
// Find all top-level functions (both exported and private)
const topLevelFunctions = new Map();

ast.program.body.forEach(node => {
  if (node.type === 'FunctionDeclaration') {
    topLevelFunctions.set(node.id.name, {
      name: node.id.name,
      loc: node.loc,
      isExported: false,
      calls: new Set()
    });
  } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    if (node.declaration.type === 'FunctionDeclaration') {
      topLevelFunctions.set(node.declaration.id.name, {
        name: node.declaration.id.name,
        loc: node.declaration.loc,
        isExported: true,
        calls: new Set()
      });
    } else if (node.declaration.type === 'VariableDeclaration') {
      node.declaration.declarations.forEach(d => {
        const isFn = d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression');
        topLevelFunctions.set(d.id.name, {
          name: d.id.name,
          loc: node.loc,
          isExported: true,
          isConst: !isFn,
          calls: new Set()
        });
      });
    }
  } else if (node.type === 'VariableDeclaration') {
    node.declarations.forEach(d => {
      const isFn = d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression');
      topLevelFunctions.set(d.id.name, {
        name: d.id.name,
        loc: node.loc,
        isExported: false,
        isConst: !isFn,
        calls: new Set()
      });
    });
  }
});

// For each function, find which other topLevelFunctions it references
const functionScopes = new Map();

traverse(ast, {
  FunctionDeclaration(p) {
    const fnName = p.node.id ? p.node.id.name : null;
    if (fnName && topLevelFunctions.has(fnName)) {
      p.traverse({
        ReferencedIdentifier(ident) {
          const called = ident.node.name;
          if (called !== fnName && topLevelFunctions.has(called)) {
            topLevelFunctions.get(fnName).calls.add(called);
          }
        }
      });
    }
  }
});

// Export details with signatures
const exportDetails = [];
for (const [name, data] of Object.entries(consumers)) {
  const expInfo = data.exportInfo;
  const internalData = topLevelFunctions.get(name);
  const calls = internalData ? Array.from(internalData.calls) : [];

  exportDetails.push({
    name,
    kind: expInfo.kind,
    isAsync: expInfo.isAsync,
    params: expInfo.params,
    line: expInfo.line,
    endLine: expInfo.endLine,
    calls,
    consumers: data.consumers
  });
}

// Sort by line number
exportDetails.sort((a, b) => a.line - b.line);

fs.writeFileSync(
  path.resolve(__dirname, 'export_details.json'),
  JSON.stringify(exportDetails, null, 2),
  'utf8'
);
console.log('Saved export details to scratch/export_details.json');

// Print domain clusters proposal
console.log(`Total exports analyzed: ${exportDetails.length}`);
