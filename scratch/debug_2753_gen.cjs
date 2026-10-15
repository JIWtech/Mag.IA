const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');

const modifiedCode = code.replace(
  'const auctionOp = executeCommercialOperationSync(',
  'console.log("DEBUG 2753:", { text: latestTurnText, targetAuctionState, prodCandidate: auctionProductCandidate?.model, invCount: inventory?.length }); const auctionOp = executeCommercialOperationSync('
).replace(
  'catch (inventoryError) {',
  'catch (inventoryError) { console.log("INVENTORY ERROR CAUGHT:", inventoryError.message, inventoryError.stack);'
);

const testSource = fs.readFileSync(path.join(__dirname, '../scripts/tests/test_whatsapp_sales.cjs'), 'utf8');
const runIdx = testSource.indexOf('async function run({');
const test2734Idx = testSource.indexOf("test('Genesis classifica leilao");
const test2734End = testSource.indexOf("});\n", test2734Idx) + 4;

const prelude = testSource.slice(0, runIdx).replace(
  "const root=path.resolve(__dirname,'../..');",
  "const root=path.resolve(__dirname,'..');"
).replace(
  "const code=fs.readFileSync(path.join(root,'n8n/code/whatsapp_conversation_core.generated.js'),'utf8');",
  'const code = ' + JSON.stringify(modifiedCode) + ';'
);
const runFunc = testSource.slice(runIdx, testSource.indexOf("test('lead vazio sem historico", runIdx));
const targetTest = testSource.slice(test2734Idx, test2734End);

const fullScript = `
${prelude}
${runFunc}
${targetTest}
`;

fs.writeFileSync(path.join(__dirname, 'run_debug.cjs'), fullScript);
