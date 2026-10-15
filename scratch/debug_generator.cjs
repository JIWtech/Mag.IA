const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');

const modifiedCode = code.replace(
  'function salesLoadGenesisCommercialEngine() {',
  'function salesLoadGenesisCommercialEngine() {\n  try { return require("../../clients/wesley_automoveis/genesisCommercialEngine.cjs"); } catch (e1) { console.log("CATCH 1:", e1.message); }\n  try { const p = require("node:path"); return require(p.resolve(process.cwd(), "clients/wesley_automoveis/genesisCommercialEngine.cjs")); } catch (e2) { console.log("CATCH 2:", e2.message); }\n  return null;\n}\nfunction _dummy() {'
).replace(
  'const auctionIntent = auctionOp.handoff?.required ? auctionOp.data : null;',
  'console.log("DEBUG AUCTION:", { latestTurnText, tenantSlug, opHandoff: auctionOp?.handoff, opData: auctionOp?.data, opStatus: auctionOp?.status }); const auctionIntent = auctionOp.handoff?.required ? auctionOp.data : null;'
).replace(
  '// genesis-auction-compose-guard-v1',
  'console.log("DEBUG GUARD:", { naturalPlan: !!naturalPlan, auctionIntent: !!auctionIntent, handoffReason, stage }); // genesis-auction-compose-guard-v1'
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
