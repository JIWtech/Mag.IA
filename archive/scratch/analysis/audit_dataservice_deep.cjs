const fs = require('fs');
const path = require('path');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const dataServicePath = path.resolve(__dirname, '../app/src/dataService.js');
const dsCode = fs.readFileSync(dataServicePath, 'utf8');

const ast = parser.parse(dsCode, { sourceType: 'module', plugins: ['jsx'] });

// 1. Analyze Supabase queries, RPCs, tables, and Realtime channels
const supabaseInteractions = [];
const realtimeSubscriptions = [];

traverse(ast, {
  CallExpression(p) {
    const callee = p.node.callee;
    if (callee.type === 'MemberExpression') {
      const prop = callee.property.name;
      // .from('table_name')
      if (prop === 'from' && p.node.arguments.length > 0 && p.node.arguments[0].type === 'StringLiteral') {
        supabaseInteractions.push({
          type: 'from',
          table: p.node.arguments[0].value,
          line: p.node.loc.start.line
        });
      }
      // .rpc('function_name')
      if (prop === 'rpc' && p.node.arguments.length > 0 && p.node.arguments[0].type === 'StringLiteral') {
        supabaseInteractions.push({
          type: 'rpc',
          fn: p.node.arguments[0].value,
          line: p.node.loc.start.line
        });
      }
      // .channel('channel_name')
      if (prop === 'channel' && p.node.arguments.length > 0) {
        let name = 'dynamic';
        if (p.node.arguments[0].type === 'StringLiteral') name = p.node.arguments[0].value;
        else if (p.node.arguments[0].type === 'TemplateLiteral') {
          name = dsCode.slice(p.node.arguments[0].start, p.node.arguments[0].end);
        }
        realtimeSubscriptions.push({
          type: 'channel',
          name,
          line: p.node.loc.start.line
        });
      }
    }
  }
});

console.log('=== SUPABASE TABLES QUERIED ===');
const tables = new Set(supabaseInteractions.filter(i => i.type === 'from').map(i => i.table));
console.log(Array.from(tables).sort().join(', '));

console.log('\n=== SUPABASE RPCs CALLED ===');
const rpcs = new Set(supabaseInteractions.filter(i => i.type === 'rpc').map(i => i.fn));
console.log(Array.from(rpcs).sort().join(', '));

console.log('\n=== REALTIME CHANNELS ===');
realtimeSubscriptions.forEach(r => console.log(`Line ${r.line}: ${r.name}`));

fs.writeFileSync(
  path.resolve(__dirname, 'supabase_interactions.json'),
  JSON.stringify({ tables: Array.from(tables).sort(), rpcs: Array.from(rpcs).sort(), realtimeSubscriptions }, null, 2),
  'utf8'
);
