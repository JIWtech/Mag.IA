import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import { validateKanbanOrderProposal } from '../../src/services/kanban/kanbanOrderValidation.js';
import * as dataService from '../../src/dataService.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const validationPath = path.join(__dirname, '../../src/services/kanban/kanbanOrderValidation.js');
const dataServicePath = path.join(__dirname, '../../src/dataService.js');

test('6B.33 kanbanOrderValidation.js possui AST limpa, zero variáveis livres e sem ciclos', () => {
  assert.ok(fs.existsSync(validationPath), 'kanbanOrderValidation.js deve existir');
  const code = fs.readFileSync(validationPath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module' });

  const free = new Set();
  const globals = new Set(['String', 'Array', 'Boolean', 'Set', 'undefined', 'null']);

  traverse(ast, {
    ReferencedIdentifier(p) {
      if (!globals.has(p.node.name) && !p.scope.hasBinding(p.node.name)) free.add(p.node.name);
    },
  });

  assert.deepEqual([...free], [], 'kanbanOrderValidation.js não deve ter variáveis livres');
  assert.doesNotMatch(code, /from ['"].*dataService/, 'kanbanOrderValidation.js não deve importar dataService');
});

test('6B.33 contratos funcionais de validateKanbanOrderProposal', () => {
  const columns = [
    { automationKey: 'conversas_ia' },
    { automation_key: 'aguardando_humano' },
    { id: 'agendamentos' },
  ];

  // 1. Permutação válida
  const validProposal = validateKanbanOrderProposal(columns, {
    orderedAutomationKeys: ['agendamentos', 'conversas_ia', 'aguardando_humano'],
    reasoning: '   Priorizar agendamentos antes de retorno humano.   ',
  });
  assert.equal(validProposal.valid, true);
  assert.deepEqual(validProposal.orderedAutomationKeys, ['agendamentos', 'conversas_ia', 'aguardando_humano']);
  assert.equal(validProposal.reasoning, 'Priorizar agendamentos antes de retorno humano.');

  // 2. Rejeita proposta com colunas faltantes
  const incompleteProposal = validateKanbanOrderProposal(columns, {
    orderedAutomationKeys: ['agendamentos', 'conversas_ia'],
  });
  assert.equal(incompleteProposal.valid, false);
  assert.deepEqual(incompleteProposal.orderedAutomationKeys, []);

  // 3. Rejeita proposta com colunas extras / desconhecidas
  const extraProposal = validateKanbanOrderProposal(columns, {
    orderedAutomationKeys: ['agendamentos', 'conversas_ia', 'aguardando_humano', 'desconhecido'],
  });
  assert.equal(extraProposal.valid, false);
  assert.deepEqual(extraProposal.orderedAutomationKeys, []);

  // 4. Rejeita proposta com colunas duplicadas
  const duplicateProposal = validateKanbanOrderProposal(columns, {
    orderedAutomationKeys: ['agendamentos', 'conversas_ia', 'conversas_ia'],
  });
  assert.equal(duplicateProposal.valid, false);
  assert.deepEqual(duplicateProposal.orderedAutomationKeys, []);

  // 5. Entradas vazias ou inválidas
  assert.equal(validateKanbanOrderProposal([], { orderedAutomationKeys: ['conversas_ia'] }).valid, false);
  assert.equal(validateKanbanOrderProposal(columns, null).valid, false);
  assert.equal(validateKanbanOrderProposal(columns, {}).valid, false);
  assert.equal(validateKanbanOrderProposal(columns, { orderedAutomationKeys: null }).valid, false);

  // 6. Sanitização de reasoning (não string)
  const nonStringReasoning = validateKanbanOrderProposal(columns, {
    orderedAutomationKeys: ['agendamentos', 'conversas_ia', 'aguardando_humano'],
    reasoning: 12345,
  });
  assert.equal(nonStringReasoning.valid, true);
  assert.equal(nonStringReasoning.reasoning, '');
});

test('6B.33 preservação de compatibilidade da fachada dataService.js com 106 exports', () => {
  const dataServiceCode = fs.readFileSync(dataServicePath, 'utf8');

  // dataService re-exporta validateKanbanOrderProposal do módulo modularizado
  assert.match(dataServiceCode, /from '\.\/services\/kanban\/kanbanOrderValidation\.js'/);
  assert.doesNotMatch(dataServiceCode, /\bfunction validateKanbanOrderProposal\s*\(/);

  // Comportamento através da fachada é idêntico
  assert.equal(typeof dataService.validateKanbanOrderProposal, 'function');
  const res = dataService.validateKanbanOrderProposal(
    [{ automationKey: 'conversas_ia' }],
    { orderedAutomationKeys: ['conversas_ia'], reasoning: 'teste' }
  );
  assert.equal(res.valid, true);
  assert.equal(res.reasoning, 'teste');

  // Total de 106 exports públicos rigorosamente preservado
  assert.equal(Object.keys(dataService).length, 106, 'dataService deve preservar exatamente 106 exports públicos');
});
