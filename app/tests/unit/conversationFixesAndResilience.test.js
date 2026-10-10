import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../../src/utils/dateFormatting.js';
import { matchesResponsibleFilter } from '../../src/services/timeline/conversationFilters.js';
import { buildLoadedClientData } from '../../src/services/clientData/clientDataTransforms.js';

test('formatDate handles empty, invalid, and valid dates safely without throwing RangeError', () => {
  assert.equal(formatDate(null), 'Agora');
  assert.equal(formatDate(''), 'Agora');
  assert.equal(formatDate('invalid-iso-string'), 'Agora');
  assert.equal(formatDate(undefined), 'Agora');
  
  const validIso = '2026-03-15T14:30:00.000Z';
  const formatted = formatDate(validIso);
  assert.ok(typeof formatted === 'string' && formatted.length > 5);
});

test('matchesResponsibleFilter matches agent and unassigned human conversations when filtering by that agent', () => {
  const convOwnedByWesley = {
    status: 'atendimento_humano',
    owner: 'Wesley',
    ownerKind: 'agent',
  };
  const convHumanUnassigned = {
    status: 'atendimento_humano',
    owner: null,
    ownerKind: 'agent',
  };
  const convHumanGenericOwner = {
    status: 'atendimento_humano',
    owner: 'Atendimento humano',
  };
  const convOtherAgent = {
    status: 'atendimento_humano',
    owner: 'Carlos',
    ownerKind: 'agent',
  };
  const convAi = {
    status: 'ia_ativa',
    owner: 'Assistente IA',
    ownerKind: 'ai',
  };

  // Filtro "Wesley" deve casar com convOwnedByWesley e conversas humanas sem outro atendente fixo
  assert.equal(matchesResponsibleFilter(convOwnedByWesley, 'Wesley'), true);
  assert.equal(matchesResponsibleFilter(convHumanUnassigned, 'Wesley'), true);
  assert.equal(matchesResponsibleFilter(convHumanGenericOwner, 'Wesley'), true);
  
  // NUNCA deve casar com Carlos nem com IA
  assert.equal(matchesResponsibleFilter(convOtherAgent, 'Wesley'), false);
  assert.equal(matchesResponsibleFilter(convAi, 'Wesley'), false);
});

test('eventsToFunnel populates all 5 stages (including Negociação e Cliente fechado)', () => {
  const events = [
    { channel_type: 'whatsapp', external_conversation_id: '1', stage: 'Lead recebido' },
    { channel_type: 'whatsapp', external_conversation_id: '2', stage: 'Qualificação' },
    { channel_type: 'whatsapp', external_conversation_id: '3', stage: 'Proposta' },
    { channel_type: 'whatsapp', external_conversation_id: '4', stage: 'Negociação' },
    { channel_type: 'whatsapp', external_conversation_id: '5', stage: 'Cliente fechado' },
  ];

  const clientData = buildLoadedClientData({
    fallback: {},
    tenantId: 'tenant-1',
    enabledChannels: ['whatsapp'],
    activeTenantSlug: 'wesley_automoveis',
    userId: 'user-1',
    events,
    appointments: [],
    broadcastContacts: [],
    broadcastCampaigns: [],
    conversationReads: [],
    teamAgents: [],
    kanbanConfig: { columns: [] },
    followUpJobs: [],
    salesLeads: [],
    tenantSettings: {},
  });

  const stages = clientData.funnelStages;
  assert.equal(stages.length, 5);
  assert.equal(stages[0].count, 1, 'Etapa 0: Lead recebido');
  assert.equal(stages[1].count, 1, 'Etapa 1: Diagnóstico/Qualificação');
  assert.equal(stages[2].count, 1, 'Etapa 2: Proposta');
  assert.equal(stages[3].count, 1, 'Etapa 3: Negociação');
  assert.equal(stages[4].count, 1, 'Etapa 4: Cliente fechado');
});
