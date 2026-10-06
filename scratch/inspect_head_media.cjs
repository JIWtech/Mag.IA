const { execSync } = require('child_process');
const content = execSync('git show HEAD:scripts/test_whatsapp_media.cjs', { encoding: 'utf8' });
const lines = content.split('\n');
const tests = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('test(')) {
    tests.push({ line: i + 1, text: line.trim() });
  }
}
console.log('Total tests in HEAD:scripts/test_whatsapp_media.cjs:', tests.length);
tests.forEach((t, i) => console.log(`${i + 1}. [line ${t.line}] ${t.text}`));
