import test from 'node:test';
import assert from 'node:assert/strict';
import { kanbanAgentFilterValue, KANBAN_OWNER_FILTERS, matchesKanbanOwnerFilter } from '../../src/services/kanban/kanbanFilters.js';

const aiCard = { id: 'ai', ownerKind: 'ai', owner: 'Assistente IA' };
const agentACard = { id: 'agent-a', ownerKind: 'agent', ownerId: 'agent-a', owner: 'Ana' };
const agentBCard = { id: 'agent-b', ownerKind: 'agent', ownerId: 'agent-b', owner: 'Bruna' };
const cards = [aiCard, agentACard, agentBCard];

test('Kanban owner filter returns all eligible cards for Todos', () => {
  assert.deepEqual(cards.filter((card) => matchesKanbanOwnerFilter(card, KANBAN_OWNER_FILTERS.ALL)), cards);
});

test('Kanban owner filter returns only AI-owned cards for Assistente IA', () => {
  assert.deepEqual(cards.filter((card) => matchesKanbanOwnerFilter(card, KANBAN_OWNER_FILTERS.AI)), [aiCard]);
});

test('Kanban owner filter matches a real agent by stable ID', () => {
  assert.deepEqual(cards.filter((card) => matchesKanbanOwnerFilter(card, kanbanAgentFilterValue('agent-a'))), [agentACard]);
});

test('Kanban owner filter never leaks another or unknown agent cards', () => {
  assert.deepEqual(cards.filter((card) => matchesKanbanOwnerFilter(card, kanbanAgentFilterValue('other-tenant-agent'))), []);
});
