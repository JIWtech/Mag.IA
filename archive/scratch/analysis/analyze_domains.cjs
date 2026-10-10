const fs = require('fs');
const path = require('path');

const exportsList = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'export_details.json'), 'utf8'));

console.log('=== LIST OF ALL 106 EXPORTS (LINE-ORDERED) ===');
exportsList.forEach((exp, idx) => {
  const sig = exp.kind === 'function' ? `${exp.isAsync ? 'async ' : ''}function ${exp.name}(${exp.params})` : `const ${exp.name}`;
  console.log(`${idx + 1}. [L${exp.line}-L${exp.endLine || exp.line}] ${sig} (Consumers: ${exp.consumers.length})`);
});
