const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../scripts/test_whatsapp_sales.cjs');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update run() options signature to include businessFacts=null
if (!content.includes('businessFacts=null')) {
  content = content.replace(
    'boundary=null,boundaryId=boundary?\'close-1\':\'initial\'}={}) {',
    'boundary=null,boundaryId=boundary?\'close-1\':\'initial\',businessFacts=null}={}) {'
  );
  content = content.replace(
    'business_facts:{locations:[{verified:true,address:\'Endereco oficial\'}]},',
    'business_facts:businessFacts||{locations:[{verified:true,address:\'Endereco oficial\'}]},'
  );
}

// 2. Handle follow_up_jobs table mock
if (!content.includes('table===\'follow_up_jobs\'')) {
  content = content.replace(
    'throw Error(\'Unexpected \'+table);',
    'if(table===\'follow_up_jobs\') return [{id:\'job\',status:\'cancelled\'}];\n    throw Error(\'Unexpected \'+table);'
  );
}

// 3. New Tests A to M
const newTests = `

// =========================================================================
// SECTION 10: FOLLOW-UP ELIGIBILITY & CANCELLATION (A to G)
// =========================================================================

test('follow-up A: IA pergunta "Qual modelo você procura?" e cliente some -> follow_up elegivel', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy', buy_interest: { ...blank.buy_interest, model: '' } };
  const r = await run({
    texts: ['quero comprar um carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: { action: 'reply', reason: 'none', reply: 'Qual modelo você procura?', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 3);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'awaiting_customer');
  assert.ok(r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up B: cliente "valeu obrigado" -> resposta cordial e 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['valeu obrigado'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Por nada! Se precisar de mais alguma informação ou quiser conferir nossos veículos disponíveis, estou à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'closed_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up C: cliente "não tenho interesse" -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['não tenho interesse'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Tudo bem! Se precisar de algo no futuro, estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'declined');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up D: cliente "qualquer coisa eu chamo" -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['qualquer coisa eu chamo'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Combinado! Qualquer dúvida estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'deferred_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up E: cliente "vou pensar" -> 0 follow-ups automáticos', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['vou pensar'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Combinado! Qualquer dúvida estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'deferred_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up F: cliente responde novamente antes das 3h -> jobs anteriores cancelados', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy', buy_interest: { ...blank.buy_interest, model: '' } };
  const r1 = await run({
    texts: ['quero comprar um carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: { action: 'reply', reason: 'none', reply: 'Qual modelo você procura?', state }
  });
  assert.equal(r1.result.follow_ups_scheduled, 3);

  const r2 = await run({
    texts: ['valeu obrigado'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Por nada! Estamos à disposição.', state }
  });
  assert.equal(r2.result.follow_ups_scheduled, 0);
  assert.ok(r2.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
  const patchCall = r2.calls.find(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH');
  assert.equal(patchCall.body.status, 'cancelled');
});

test('follow-up G: mensagem sem pending / sem pergunta real -> não agenda', async () => {
  const r = await run({
    texts: ['qual o endereço?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    businessFacts: { locations: [{ verified: true, address: 'Av. Itapemirim, 747' }] }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'not_applicable');
});

// =========================================================================
// SECTION 11: LOCATION, REFERENCE POINT & DIRECTIONS (H to M)
// =========================================================================

test('location H: "qual o endereço?" -> endereço oficial', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const r = await run({
    texts: ['qual o endereço?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0], address);
  assert.equal(r.result.handoff, false);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.optional_human_offer, undefined);
});

test('location I: "tem ponto de referência?" sem reference_point cadastrado -> oferece atendente opcional e handoff=false', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const r = await run({
    texts: ['tem ponto de referência?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.doesNotMatch(r.sent[0], new RegExp(address));
  assert.match(r.sent[0], /Não tenho um ponto de referência confirmado aqui/i);
  assert.match(r.sent[0], /atendente pode te orientar melhor/i);
  assert.equal(r.result.handoff, false);
  assert.notEqual(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.deepEqual(outbound.body.raw_payload.optional_human_offer, { reason: 'location_details' });
});

test('location J: "fica na rua alta ou baixa?" -> não repete endereço nem inventa e handoff=false', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const r = await run({
    texts: ['fica na rua alta ou baixa?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.doesNotMatch(r.sent[0], new RegExp(address));
  assert.match(r.sent[0], /não tenho essa referência de rua alta\\/baixa confirmada/i);
  assert.match(r.sent[0], /atendente pode te passar esse detalhe/i);
  assert.equal(r.result.handoff, false);
  assert.notEqual(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.deepEqual(outbound.body.raw_payload.optional_human_offer, { reason: 'location_details' });
});

test('location K: depois da oferta: "sim, pode chamar" -> handoff=true', async () => {
  const history = [
    { id: 'e0', direction: 'inbound', message_text: 'tem ponto de referência?' },
    { id: 'a0', direction: 'outbound', ai_provider: 'sales_core', message_text: 'Não tenho um ponto de referência confirmado aqui. Se quiser, um atendente pode te orientar melhor sobre como chegar.',
      raw_payload: { optional_human_offer: { reason: 'location_details' } } }
  ];
  const r = await run({
    texts: ['sim, pode chamar'],
    history,
    lead: { id: 'lead-1', revision: 1, stage_key: 'sales_qualifying', state: { ...blank, optional_human_offer: { reason: 'location_details' } }, ai_locked: false }
  });
  assert.equal(r.result.handoff, true);
  assert.equal(r.saved[0].p_stage, 'sales_human');
  assert.match(r.sent[0], /Wesley continuar por aqui|equipe continuar por aqui/i);
});

test('location L: "sim" sem oferta humana anterior -> não handoff automaticamente', async () => {
  const r = await run({
    texts: ['sim'],
    history: [],
    response: { action: 'reply', reason: 'none', reply: 'Como posso ajudar você?', state: blank }
  });
  assert.equal(r.result.handoff, false);
  assert.notEqual(r.saved[0].p_stage, 'sales_human');
});

test('location M: business_facts futuramente contém reference_point verificado -> IA responde diretamente sem humano', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const refPoint = 'Em frente ao posto BR da entrada do bairro';
  const r = await run({
    texts: ['tem ponto de referência?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, reference_point: refPoint, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0], new RegExp(refPoint));
  assert.doesNotMatch(r.sent[0], /atendente pode te orientar/i);
  assert.equal(r.result.handoff, false);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.optional_human_offer, undefined);
});
`;

if (!content.includes('SECTION 10: FOLLOW-UP ELIGIBILITY')) {
  content = content.trimEnd() + '\n' + newTests;
}

fs.writeFileSync(filePath, content.replace(/\r?\n/g, '\r\n'));
console.log('Successfully updated scripts/test_whatsapp_sales.cjs');
