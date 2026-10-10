const fs = require('fs');
const path = require('path');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const dataServicePath = path.resolve(__dirname, '../app/src/dataService.js');
const code = fs.readFileSync(dataServicePath, 'utf8');

const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

// 1. Imports
const imports = [];
// 2. Exports
const exportsList = [];
// 3. Top-level private declarations
const privateDeclarations = [];
// 4. Module-level mutable state
const mutableState = [];

traverse(ast, {
  ImportDeclaration(p) {
    const source = p.node.source.value;
    const specifiers = p.node.specifiers.map(s => {
      if (s.type === 'ImportDefaultSpecifier') return { type: 'default', local: s.local.name };
      if (s.type === 'ImportNamespaceSpecifier') return { type: 'namespace', local: s.local.name };
      return { type: 'named', imported: s.imported.name, local: s.local.name };
    });
    imports.push({ source, specifiers, line: p.node.loc.start.line });
  },

  ExportNamedDeclaration(p) {
    if (p.node.declaration) {
      const decl = p.node.declaration;
      if (decl.type === 'FunctionDeclaration') {
        const name = decl.id.name;
        const params = decl.params.map(param => code.slice(param.start, param.end));
        exportsList.push({
          name,
          kind: 'function',
          isAsync: decl.async,
          params: params.join(', '),
          line: p.node.loc.start.line,
          endLine: p.node.loc.end.line
        });
      } else if (decl.type === 'VariableDeclaration') {
        decl.declarations.forEach(d => {
          const name = d.id.name;
          const isFunction = d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression');
          let params = '';
          let isAsync = false;
          if (isFunction) {
            params = d.init.params.map(param => code.slice(param.start, param.end)).join(', ');
            isAsync = d.init.async;
          }
          exportsList.push({
            name,
            kind: isFunction ? 'function' : 'const',
            isAsync,
            params,
            line: p.node.loc.start.line,
            endLine: p.node.loc.end.line
          });
        });
      }
    } else if (p.node.specifiers && p.node.specifiers.length > 0) {
      p.node.specifiers.forEach(s => {
        exportsList.push({
          name: s.exported.name,
          local: s.local.name,
          kind: 'specifier',
          line: p.node.loc.start.line
        });
      });
    }
  },

  ExportDefaultDeclaration(p) {
    exportsList.push({
      name: 'default',
      kind: 'default',
      line: p.node.loc.start.line
    });
  }
});

// Non-exported top-level declarations
ast.program.body.forEach(node => {
  if (node.type === 'FunctionDeclaration') {
    privateDeclarations.push({
      name: node.id.name,
      kind: 'function',
      isAsync: node.async,
      params: node.params.map(p => code.slice(p.start, p.end)).join(', '),
      line: node.loc.start.line,
      endLine: node.loc.end.line
    });
  } else if (node.type === 'VariableDeclaration') {
    const isLetOrVar = node.kind === 'let' || node.kind === 'var';
    node.declarations.forEach(d => {
      const name = d.id.name;
      const isFunction = d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression');
      if (isLetOrVar) {
        mutableState.push({
          name,
          kind: node.kind,
          init: d.init ? code.slice(d.init.start, Math.min(d.init.end, d.init.start + 40)) : 'none',
          line: node.loc.start.line
        });
      }
      privateDeclarations.push({
        name,
        kind: isFunction ? 'function' : node.kind,
        isAsync: isFunction ? d.init.async : false,
        params: isFunction ? d.init.params.map(p => code.slice(p.start, p.end)).join(', ') : '',
        line: node.loc.start.line,
        endLine: node.loc.end.line
      });
    });
  }
});

console.log('Total Imports:', imports.length);
console.log('Total Exports:', exportsList.length);
console.log('Total Top-level Private Declarations:', privateDeclarations.length);
console.log('Mutable State Variables:', mutableState.length);

const result = {
  imports,
  exports: exportsList,
  privateDeclarations,
  mutableState
};

fs.writeFileSync(path.resolve(__dirname, 'dataservice_ast_summary.json'), JSON.stringify(result, null, 2), 'utf8');
console.log('Summary saved to scratch/dataservice_ast_summary.json');
