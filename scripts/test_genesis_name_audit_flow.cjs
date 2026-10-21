// Mecânica do CORE com o executor de homologação: o auditor semântico é SIMULADO (fila auditor_responses). Isto NÃO valida o julgamento do Gemini;
// valida o que o CORE faz com cada veredito: confirmar, rejeitar e a indisponibilidade. O julgamento real é verificado à parte, com Gemini real.
// Rodar: node --test scripts/test_genesis_name_audit_flow.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./homolog/genesis_executor.cjs');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8'));
const body = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const NAME = 'Carlos Eduardo Lima';
const verdict = (over = {}) => body({ scope_key: 'x', complete: true, segments: [], name_proof_verdict: { relation: 'customer_self', belongs_to_customer: true, assistant_question_presents_name: false, customer_message_confirms_name: false, ...over } });
const clean = body({ reply: 'Entendi, obrigado. Qual é o seu nome completo?', response_contract: { fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [], availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false } });

async function run(text, kind, responses) {
  const scenario = { name: 'name-audit', turns: [{ text, gemini: { reply: 'Prazer em atender você!', state: { customer_name: NAME, name_evidence: 'in-1', name_proof_kind: kind } } }], auditor_responses: responses };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory });
  const outbound = result.world.tables.channel_events.filter(row => row.direction === 'outbound').at(-1);
  return { world: result.world, outbound, lead: result.world.tables.sales_leads[0], calls: result.world.log.gemini.length };
}

test('veredito confirmed: a prova passa a confirmada, o nome é persistido e há UMA chamada de auditoria (sem chamada extra para nomes)', async () => {
  const { lead, outbound, calls } = await run('Meu nome é ' + NAME, 'self_declared', [verdict()]);
  assert.equal(lead.state.customer_name, NAME);
  assert.equal(lead.state.name_verified, true);
  assert.equal(lead.state.name_proof.audit, 'confirmed');
  assert.equal(outbound.raw_payload.name_proof_audit.verdict, 'confirmed');
  assert.equal(outbound.raw_payload.name_proof_audit.persisted, true);
  assert.equal(calls, 2, 'primária + a auditoria semântica que já existe');
});

test('veredito rejected (nome de terceiro): o nome não é adotado, a resposta é reescrita sem tratá-lo como cliente e nada é perdido', async () => {
  const { lead, outbound } = await run('Meu irmão ' + NAME + ' vai aí amanhã', 'self_declared', [verdict({ relation: 'third_party', belongs_to_customer: false }), clean]);
  assert.equal(lead.state.customer_name || '', '');
  assert.equal(lead.state.name_verified, false);
  assert.equal(lead.state.name_proof ?? null, null);
  assert.equal(outbound.raw_payload.name_proof_audit.verdict, 'rejected');
  assert.equal(JSON.stringify(outbound.raw_payload.dialogue_repair.original_issues), JSON.stringify(['UNPROVEN_CUSTOMER_NAME']));
  assert.doesNotMatch(outbound.message_text, /Prazer/);
});

test('auditoria indisponível: o nome fica NÃO comprovado e o atendimento segue sem rejeitar a resposta', async () => {
  const { lead, outbound } = await run('Meu nome é ' + NAME, 'self_declared', []);
  assert.equal(lead.state.name_verified, false);
  assert.equal(lead.state.name_proof ?? null, null);
  assert.equal(lead.state.customer_name || '', '', 'nome sem prova auditada não é adotado');
  assert.ok(!outbound.ai_error, 'a indisponibilidade da prova do nome não derruba a resposta');
  assert.notEqual(outbound.raw_payload.name_proof_audit.verdict, 'confirmed');
});

test('sem prova alegada (kind=none): não há chamada de auditoria de nome e o nome não é adotado', async () => {
  const { lead, calls } = await run('Vendem Celta? Camaro?', 'none', []);
  assert.equal(lead.state.name_verified, false);
  assert.equal(calls, 1);
});
