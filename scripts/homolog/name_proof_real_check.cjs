// Verificação pequena e controlada da prova semântica do nome com Gemini REAL (4 cenários, um turno cada).
// Isolamento: Supabase e Evolution são simulados em memória (nenhum lead/evento real, nenhum WhatsApp, nenhum handoff); o único host alcançável é
// generativelanguage.googleapis.com. Só roda com HOMOLOG_NAME_PROOF_AUTHORIZED=1 e uma chave em HOMOLOG_GEMINI_KEY ou, por autorização explícita
// do responsável, GEMINI_API_KEY do .env (lida em memória, nunca impressa). O prompt usado é o v14.20 aplicado ao tenant.
// Rodar: HOMOLOG_NAME_PROOF_AUTHORIZED=1 node scripts/homolog/name_proof_real_check.cjs
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./genesis_executor.cjs');

const root = path.join(__dirname, '../..');
if (process.env.HOMOLOG_NAME_PROOF_AUTHORIZED !== '1') throw new Error('NAME_PROOF_REAL_NOT_AUTHORIZED: set HOMOLOG_NAME_PROOF_AUTHORIZED=1');
let key = process.env.HOMOLOG_GEMINI_KEY || '';
if (!key) key = ((fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^GEMINI_API_KEY=(.*)$/m) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('NAME_PROOF_REAL_NO_KEY');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/genesis_scenarios.json'), 'utf8'));
const settings = ex.loadSettings();
const promptFile = process.env.HOMOLOG_PROMPT_FILE;
if (promptFile) settings.system_prompt = fs.readFileSync(promptFile, 'utf8');
settings.ai_model = process.env.HOMOLOG_MODEL || settings.ai_model;
const NAME = 'Carlos Eduardo Lima';

const seedQuestion = world => {
  const base = { tenant_id: world.tables.tenants[0].id, tenant_slug: world.tables.tenants[0].slug, channel_type: 'whatsapp', external_conversation_id: '5500000000001' };
  world.tables.channel_events.push(
    { id: 'old-in-1', ...base, direction: 'inbound', sender_type: 'customer', message_text: 'Quero financiar uma moto', created_at: new Date(Date.now() - 600000).toISOString(), raw_payload: {}, service: 'sales_qualification' },
    { id: 'old-out-1', ...base, direction: 'outbound', sender_type: 'ai', ai_provider: 'sales_core', message_text: 'Só para confirmar, seu nome completo é ' + NAME + '?',
      created_at: new Date(Date.now() - 300000).toISOString(), raw_payload: {}, service: 'sales_qualification', delivery_status: 'sent' });
};

const scenarios = [
  { name: '1 declaração própria', text: 'Meu nome é ' + NAME, expect: { kind: ['self_declared', 'answered_name_question'], verified: true } },
  { name: '2 nome de terceiro', text: 'Meu irmão ' + NAME + ' vai aí amanhã olhar a moto', expect: { verified: false } },
  { name: '3 confirmação contextual', text: 'Sim', seed: seedQuestion, expect: { kind: ['confirmed_presented_name'], verified: true } },
  { name: '4 mensagem sem nome', text: 'Vendem Celta? Camaro?', expect: { verified: false } },
];

(async () => {
  let total = 0;
  for (const item of scenarios) {
    const scenario = { name: item.name, turns: [{ text: item.text, gemini: {} }], auditor_responses: [] };
    let result, error = null;
    try { result = await ex.runScenario(scenario, { mode: 'real', geminiKey: key, settings, inventory: fixtures.inventory, seed: item.seed || null }); }
    catch (e) { error = String(e.message || e).replace(key, '<key>').slice(0, 200); }
    if (error) { console.log(JSON.stringify({ scenario: item.name, error })); continue; }
    const world = result.world;
    total += world.log.gemini.length;
    const primary = world.log.gemini_responses.find(r => r.primary);
    let raw = {};
    try { raw = JSON.parse(primary.parsed.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join('')).state || {}; } catch { raw = {}; }
    const outbound = world.tables.channel_events.filter(r => r.direction === 'outbound' && r.id !== 'old-out-1').at(-1);
    const lead = world.tables.sales_leads[0];
    const audit = outbound?.raw_payload?.name_proof_audit || null;
    const row = {
      scenario: item.name, gemini_calls: world.log.gemini.length,
      model_classification: raw.name_proof_kind ?? null, model_customer_name_set: Boolean(raw.customer_name), model_evidence: raw.name_evidence || '',
      audit_verdict: audit?.verdict ?? 'not_run', persisted_verified: lead?.state?.name_verified ?? false, persisted_name_set: Boolean(lead?.state?.customer_name),
      proof_audit: lead?.state?.name_proof?.audit ?? null, ai_error: outbound?.ai_error || null,
      whatsapp_sends_simulated: world.log.simulated_sends.length, real_writes: 0,
    };
    row.as_expected = (item.expect.verified === row.persisted_verified) && (!item.expect.kind || item.expect.kind.includes(row.model_classification));
    console.log(JSON.stringify(row));
  }
  console.log(JSON.stringify({ total_gemini_calls: total }));
})().catch(e => { console.error('FAILED', String(e.message || e).slice(0, 300)); process.exitCode = 1; });
