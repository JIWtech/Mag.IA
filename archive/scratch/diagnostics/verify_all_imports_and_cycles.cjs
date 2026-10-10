const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../app/src');

function getAllFiles(dir) {
  let results = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (item === 'node_modules' || item === 'dist') continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(full));
    } else if (full.endsWith('.js') || full.endsWith('.jsx')) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = getAllFiles(srcDir);
console.log('Total JS/JSX files audited:', allFiles.length);

let brokenImports = [];
const graph = new Map(); // file -> [importedFiles]

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  // Match static imports: import ... from '...'
  // and dynamic imports: import('...')
  const importRegex = /(?:import\s+(?:[\w\s{},*]+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match;
  const deps = [];
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath.startsWith('.')) {
      // Resolve relative path
      const dir = path.dirname(file);
      let target = path.resolve(dir, importPath);
      // Check extensions if not specified
      if (!fs.existsSync(target)) {
        if (fs.existsSync(target + '.js')) target = target + '.js';
        else if (fs.existsSync(target + '.jsx')) target = target + '.jsx';
        else if (fs.existsSync(path.join(target, 'index.js'))) target = path.join(target, 'index.js');
        else if (fs.existsSync(path.join(target, 'index.jsx'))) target = path.join(target, 'index.jsx');
        else {
          brokenImports.push({ file: path.relative(srcDir, file), importPath, resolved: target });
        }
      }
      if (fs.existsSync(target) && (target.endsWith('.js') || target.endsWith('.jsx'))) {
        deps.push(target);
      }
    }
  }
  graph.set(file, deps);
}

console.log('Broken imports count:', brokenImports.length);
if (brokenImports.length > 0) {
  console.error('Broken imports found:', brokenImports);
}

// Check circular dependencies
function findCycles() {
  const visited = new Set();
  const stack = new Set();
  const cycles = [];

  function dfs(node, pathArr) {
    visited.add(node);
    stack.add(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...pathArr, neighbor]);
      } else if (stack.has(neighbor)) {
        const cyclePath = pathArr.slice(pathArr.indexOf(neighbor));
        cyclePath.push(neighbor);
        cycles.push(cyclePath.map(p => path.relative(srcDir, p)));
      }
    }
    stack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, [node]);
    }
  }
  return cycles;
}

const cycles = findCycles();
console.log('Circular dependencies count:', cycles.length);
if (cycles.length > 0) {
  console.log('Cycles found:', cycles);
}
