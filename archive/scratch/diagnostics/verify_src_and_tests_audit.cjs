const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');

function getAllFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
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

const srcFiles = getAllFiles(path.join(appDir, 'src'));
const testFiles = getAllFiles(path.join(appDir, 'tests'));
const allFiles = [...srcFiles, ...testFiles];

console.log('Total JS/JSX files audited:', allFiles.length);
console.log(' - src files:', srcFiles.length);
console.log(' - tests files:', testFiles.length);

let brokenImports = [];
const graph = new Map();

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const importRegex = /(?:import\s+(?:[\w\s{},*]+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match;
  const deps = [];
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath.startsWith('.')) {
      const dir = path.dirname(file);
      let target = path.resolve(dir, importPath);
      if (!fs.existsSync(target)) {
        if (fs.existsSync(target + '.js')) target = target + '.js';
        else if (fs.existsSync(target + '.jsx')) target = target + '.jsx';
        else if (fs.existsSync(path.join(target, 'index.js'))) target = path.join(target, 'index.js');
        else if (fs.existsSync(path.join(target, 'index.jsx'))) target = path.join(target, 'index.jsx');
        else {
          brokenImports.push({ file: path.relative(appDir, file), importPath, resolved: target });
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

// Check circular dependencies in src files
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
        cycles.push(cyclePath.map(p => path.relative(appDir, p)));
      }
    }
    stack.delete(node);
  }

  for (const node of srcFiles) {
    if (!visited.has(node)) {
      dfs(node, [node]);
    }
  }
  return cycles;
}

const cycles = findCycles();
console.log('Circular dependencies in src count:', cycles.length);
if (cycles.length > 0) {
  console.log('Cycles found:', cycles);
}
