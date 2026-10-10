const fs = require('fs');
const readline = require('readline');
const path = 'C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\60c782f3-af67-4557-a0ea-d92f85dceb73\\.system_generated\\logs\\transcript_full.jsonl';
const rl = readline.createInterface({ input: fs.createReadStream(path) });
let lastFile = '';

rl.on('line', (line) => {
  const o = JSON.parse(line);
  const c = o.content || '';
  if (c.includes('test_whatsapp_sales.cjs')) lastFile = 'sales';
  else if (c.includes('test_whatsapp_core.cjs')) lastFile = 'core';
  else if (c.includes('test_whatsapp_media.cjs')) lastFile = 'media';
  else if (c.includes('app/src/')) lastFile = 'frontend';

  const m = c.match(/ℹ tests (\d+)/);
  if (m) {
    console.log(`Step ${o.step_index} [${lastFile}]: tests ${m[1]}`);
  }
});
