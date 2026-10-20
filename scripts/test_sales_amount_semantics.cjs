const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Extract normalizeText and salesAmount from noria_core.js
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'sources', 'noria_core.js'), 'utf8');
const normMatch = coreSource.match(/function normalizeText\(value\)\s*\{[\s\S]*?\n\}/);
if (!normMatch) throw new Error('Failed to extract normalizeText from noria_core.js');
const coreMatch = coreSource.match(/function salesAmount\(text\)\s*\{[\s\S]*?\n\}/);
if (!coreMatch) throw new Error('Failed to extract salesAmount from noria_core.js');
const salesAmount = new Function(`${normMatch[0]}; ${coreMatch[0]}; return salesAmount;`)();

// Extract parsePrice and parseBrazilianCurrency from genesis_extension.js
const extSource = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'sources', 'genesis_extension.js'), 'utf8');
const priceMatch = extSource.match(/function parsePrice\(value\)\s*\{[\s\S]*?\n\}/);
if (!priceMatch) throw new Error('Failed to extract parsePrice from genesis_extension.js');
const extMatch = extSource.match(/function parseBrazilianCurrency\(text\)\s*\{[\s\S]*?\n\}/);
if (!extMatch) throw new Error('Failed to extract parseBrazilianCurrency from genesis_extension.js');
const parseBrazilianCurrency = new Function(`${normMatch[0]}; ${priceMatch[0]}; ${extMatch[0]}; return parseBrazilianCurrency;`)();

test('Mandatory semantic distinction for sales amount & currency parsing', () => {
  const cases = [
    {
      phrase: 'Tem como dar R$ 10 mil de entrada?',
      category: 'pergunta de viabilidade',
      expectedAmount: null,
      expectedCurrency: null,
    },
    {
      phrase: 'Se eu der 15 mil, quanto fica?',
      category: 'hipótese',
      expectedAmount: null,
      expectedCurrency: null,
    },
    {
      phrase: 'Posso dar 5 mil?',
      category: 'pergunta com permissão/possibilidade',
      expectedAmount: null,
      expectedCurrency: null,
    },
    {
      phrase: 'Vou dar R$ 10 mil de entrada.',
      category: 'proposta afirmativa',
      expectedAmount: 1000000,
      expectedCurrency: 1000000,
    },
    {
      phrase: 'Dá para financiar sem entrada?',
      category: 'pergunta sobre financiamento sem entrada',
      expectedAmount: null,
      expectedCurrency: null,
    },
    {
      phrase: 'Preferencialmente sem entrada.',
      category: 'preferência com evidência',
      expectedAmount: 0,
      expectedCurrency: 0,
    },
    {
      phrase: 'Se não der sem entrada, posso dar R$ 5 mil.',
      category: 'alternativa condicional',
      expectedAmount: 500000,
      expectedCurrency: 500000,
    },
    {
      phrase: 'Não consigo dar entrada agora.',
      category: 'restrição sem entrada',
      expectedAmount: 0,
      expectedCurrency: 0,
    },
    {
      phrase: 'Sem entrada por favor.',
      category: 'preferência sem entrada',
      expectedAmount: 0,
      expectedCurrency: 0,
    },
    {
      phrase: 'Consigo dar 20 mil de entrada?',
      category: 'pergunta direta sobre viabilidade',
      expectedAmount: null,
      expectedCurrency: null,
    },
    {
      phrase: 'Quero dar 25000 de entrada',
      category: 'proposta afirmativa',
      expectedAmount: 2500000,
      expectedCurrency: 2500000,
    },
  ];

  for (const c of cases) {
    const coreResult = salesAmount(c.phrase);
    const extResult = parseBrazilianCurrency(c.phrase);

    assert.equal(
      coreResult,
      c.expectedAmount,
      `[CORE salesAmount] Falha em "${c.phrase}" (${c.category}): esperado ${c.expectedAmount}, obteve ${coreResult}`
    );
    assert.equal(
      extResult.deposit_cents,
      c.expectedCurrency,
      `[EXT parseBrazilianCurrency] Falha em "${c.phrase}" (${c.category}): esperado ${c.expectedCurrency}, obteve ${extResult.deposit_cents}`
    );
  }
});
