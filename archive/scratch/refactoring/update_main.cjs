const fs = require('fs');

const mainPath = 'app/src/main.jsx';
const mainContent = fs.readFileSync(mainPath, 'utf8');
const lines = mainContent.split('\r\n');

// 1. Insert import after Funnel
const funnelIdx = lines.findIndex(l => l.includes("from './features/kanban/components/Funnel';"));
if (funnelIdx === -1) {
  console.error('Funnel import not found!');
  process.exit(1);
}
console.log('Funnel import found at line:', funnelIdx + 1);

lines.splice(funnelIdx + 1, 0, "import { Conversations } from './features/conversations/components/Conversations';");

// 2. Find Conversations declaration
const convStartIdx = lines.findIndex(l => l.startsWith('function Conversations('));
if (convStartIdx === -1) {
  console.error('function Conversations( not found!');
  process.exit(1);
}
console.log('Conversations start line:', convStartIdx + 1);

let convEndIdx = -1;
let depth = 0;
for (let i = convStartIdx; i < lines.length; i++) {
  const line = lines[i];
  for (const ch of line) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  if (depth === 0) {
    convEndIdx = i;
    break;
  }
}

if (convEndIdx === -1 || lines[convEndIdx] !== '}') {
  console.error('Could not find matching closing brace for Conversations! Found:', lines[convEndIdx]);
  process.exit(1);
}
console.log('Conversations end line:', convEndIdx + 1);

// Clean up: remove from convStartIdx to convEndIdx (and any empty lines directly above convStartIdx beyond 1)
let removeStart = convStartIdx;
while (removeStart > 0 && lines[removeStart - 1].trim() === '') {
  removeStart--;
}
removeStart = Math.min(removeStart + 1, convStartIdx);

console.log('Removing from line', removeStart + 1, 'to line', convEndIdx + 1);
console.log('Line before removal:', lines[removeStart - 1]);
console.log('Line after removal:', lines[convEndIdx + 1]);

const removedCount = convEndIdx - removeStart + 1;
lines.splice(removeStart, removedCount);

const updatedContent = lines.join('\r\n');
fs.writeFileSync(mainPath, updatedContent, 'utf8');

console.log('main.jsx successfully updated!');
console.log('Previous lines:', mainContent.split('\r\n').length);
console.log('New lines:', lines.length);
console.log('Lines reduced:', mainContent.split('\r\n').length - lines.length);
console.log('Has CRLF:', updatedContent.includes('\r\n'));
console.log('Has solitary LF:', /[^\r]\n/.test(updatedContent));
