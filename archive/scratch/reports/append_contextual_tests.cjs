const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../scripts/test_whatsapp_sales.cjs');
let content = fs.readFileSync(filePath, 'utf8');

const newTests = `

// =========================================================================
// SECTION 13: CONTEXTUAL FOLLOW-UP TESTS (A to E)
// =========================================================================

test('follow-up contextual A: cliente pede horário fora do expediente, IA oferece outro horário com pergunta -> awaiting_customer -> follow-up permitido', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['vou chegar aí umas 18:30, segura o carro pra mim?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: {
      action: 'reply',
      reason: 'none',
      reply: 'Como nosso horário vai até as 18:00, você pode agendar para outro momento dentro do expediente. Gostaria de agendar?',
      state
    }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 3);
  assert.ok(r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'awaiting_customer');
});

test('follow-up contextual B: cliente "nesse horário não consigo, então deixa" -> declined/closed -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['nesse horário não consigo, então deixa'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Tudo bem! Se precisar, estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'declined');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up contextual C: cliente "outro dia eu vejo" -> deferred_by_customer -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['outro dia eu vejo'],
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

test('follow-up contextual D: IA somente informa horário/endereço sem perguntar nada -> not_applicable -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['qual o horário de funcionamento de vocês?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Nosso horário de funcionamento é de segunda a sexta das 08:00 às 18:00.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'not_applicable');
});

test('follow-up contextual E: IA informa restrição + oferece alternativa com pergunta -> awaiting_customer', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['consigo passar aí no domingo?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: {
      action: 'reply',
      reason: 'none',
      reply: 'Não abrimos aos domingos, mas atendemos aos sábados até as 13h. Gostaria de agendar para sábado?',
      state
    }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 3);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'awaiting_customer');
});
`;

content = content.trimEnd() + newTests;
fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully appended contextual tests!');
