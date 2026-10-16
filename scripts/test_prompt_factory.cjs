const test = require('node:test');
const assert = require('node:assert/strict');
let compileSystemPrompt, PROMPT_TEMPLATES, TONE_DIRECTIVES;
test.before(async () => {
  const mod = await import('../app/src/promptFactory.js');
  compileSystemPrompt = mod.compileSystemPrompt;
  PROMPT_TEMPLATES = mod.PROMPT_TEMPLATES;
  TONE_DIRECTIVES = mod.TONE_DIRECTIVES;
});

test('compileSystemPrompt generates vehicle_sales prompt with custom company name and tone', () => {
  const result = compileSystemPrompt({
    companyName: 'Auto Motors Prime',
    segment: 'vehicle_sales',
    tone: 'consultative',
    businessAddress: 'Av. das Americas, 1500 - Rio de Janeiro',
    customRules: 'Não trabalhamos com veículos de leilão ou sinistrados.',
  });

  assert.equal(result.segment, 'vehicle_sales');
  assert.equal(result.capability, 'sales_v1');
  assert.match(result.systemPrompt, /Auto Motors Prime/);
  assert.match(result.systemPrompt, /especialista consultivo/i);
  assert.match(result.systemPrompt, /FLUXO DE COMPRA/);
  assert.match(result.systemPrompt, /Não trabalhamos com veículos de leilão/);
  assert.match(result.systemPrompt, /Av\. das Americas/);
  assert.ok(result.charCount > 500);
});

test('compileSystemPrompt generates aesthetic_clinic prompt with appointment flow and address', () => {
  const result = compileSystemPrompt({
    companyName: 'Studio Beleza Radiante',
    segment: 'aesthetic_clinic',
    tone: 'friendly',
    catalogHighlights: ['Bronzeamento Natural', 'Design de Sobrancelhas', 'Limpeza de Pele'],
    handoffMessage: 'Um momento, vou chamar a atendente no WhatsApp!',
  });

  assert.equal(result.segment, 'aesthetic_clinic');
  assert.equal(result.capability, 'standard');
  assert.match(result.systemPrompt, /Studio Beleza Radiante/);
  assert.match(result.systemPrompt, /FLUXO DE AGENDAMENTO/);
  assert.match(result.systemPrompt, /Bronzeamento Natural/);
  assert.match(result.systemPrompt, /Um momento, vou chamar a atendente no WhatsApp!/);
});

test('compileSystemPrompt fallbacks gracefully to general_services when segment unknown', () => {
  const result = compileSystemPrompt({
    companyName: 'Escritório Alfa',
    segment: 'unknown_segment',
    tone: 'formal',
  });

  assert.equal(result.capability, 'standard');
  assert.match(result.systemPrompt, /Escritório Alfa/);
  assert.match(result.systemPrompt, /estritamente profissional/);
  assert.match(result.systemPrompt, /REGRAS DE OURO/);
});
