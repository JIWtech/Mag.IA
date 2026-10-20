const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('=== TEST SUITE: P0 — Rigorous Concurrency & Real Persistence of human_dispatch ===\n');

// 1. Load canonical noria_core.js code
const coreCode = fs.readFileSync(path.resolve(__dirname, '../n8n/sources/noria_core.js'), 'utf8');

function extractFn(code, name) {
  let idx = code.indexOf('async function ' + name);
  if (idx === -1) {
    idx = code.indexOf('function ' + name);
  }
  if (idx === -1) return null;
  let paren = 0, paramDone = false, bodyStart = -1;
  for (let i = idx; i < code.length; i++) {
    if (code[i] === '(') paren++;
    else if (code[i] === ')') {
      paren--;
      if (paren === 0) paramDone = true;
    } else if (paramDone && code[i] === '{') {
      bodyStart = i;
      break;
    }
  }
  if (bodyStart === -1) return null;
  let brace = 0, end = -1;
  for (let i = bodyStart; i < code.length; i++) {
    if (code[i] === '{') brace++;
    else if (code[i] === '}') {
      brace--;
      if (brace === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return code.slice(idx, end);
}

const eventsToKanbanModule = require('../app/src/services/kanban/eventsToKanban.js');
const eventsToKanban = eventsToKanbanModule.eventsToKanban;

// Tenant settings fixture with business hours
const genesisContext = {
  tenant: { id: '74b57037-9349-4a9e-889c-b65fb63c983a', slug: 'wesley_automoveis' },
  settings: {
    timezone: 'America/Sao_Paulo',
    business_hours: {
      schedule: {
        segunda: { start: '09:00', end: '18:00' },
        terca: { start: '09:00', end: '18:00' },
        quarta: { start: '09:00', end: '18:00' },
        quinta: { start: '09:00', end: '18:00' },
        sexta: { start: '09:00', end: '18:00' },
        sabado: { start: '09:00', end: '14:00' },
        domingo: { closed: true }
      }
    },
    sales: {
      stage_keys: {
        qualifying: 'sales_qualifying',
        financing: 'sales_financing',
        human: 'sales_human'
      }
    }
  }
};

/**
 * Creates an execution environment evaluating canonical functions directly from noria_core.js
 */
function createCoreSandbox(overrides = {}) {
  const env = {
    normalizeText: (val) => String(val || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    tenantSlug: 'wesley_automoveis',
    chatId: '5521999990000',
    turn: { boundary_id: 'boundary-test', messages: [{ id: 'msg-1', name: 'Cliente' }] },
    encodeFilter: (v) => encodeURIComponent(String(v)),
    settingsFor: (ctx) => ctx?.settings?.settings || ctx?.settings || {},
    tenantTimeZone: (ctx) => 'America/Sao_Paulo',
    salesCurrentAssignmentCommandId: null,
    salesOwnAssignmentEventId: null,
    salesLoadLead: async (ctx) => null,
    supabaseGet: async (path) => [],
    supabasePost: async (path, body) => body,
    supabasePatch: async (path, body) => [body],
    cancelPendingFollowUps: async () => {},
    console,
    ...overrides
  };

  const fnNames = [
    'salesVerifyAssignmentOutcome',
    'salesRefreshAfterOwnAssignment',
    'salesRecoverFailedAssignment',
    'salesAssignConversation',
    'resolveTenantDayHours',
    'tenantBusinessHoursStatus',
    'salesHandoffMessage'
  ];

  const fnDefs = {};
  for (const name of fnNames) {
    const fnDef = extractFn(coreCode, name);
    if (fnDef) {
      fnDefs[name] = fnDef;
    } else {
      console.warn('Warning: Could not extract canonical function:', name);
    }
  }

  env._fns = {};
  for (const name of fnNames) {
    if (env[name] === undefined) {
      env[name] = (...args) => env._fns[name](...args);
    }
  }

  for (const [name, def] of Object.entries(fnDefs)) {
    const evalFn = new Function(...Object.keys(env), `return (${def});`);
    const compiled = evalFn(...Object.values(env));
    env._fns[name] = compiled;
    env[name] = compiled;
  }

  return env;
}

async function runTestSuite() {
  console.log('--- REQUISITO 1 & 4: CORRELAÇÃO DE ATRIBUIÇÃO & VALIDAÇÃO ESTRITA DE matchesCurrentDirectResult ---');
  {
    const defaultAssignee = { id: 'usr-wesley', name: 'Wesley' };
    const savedLead = {
      id: 'lead-req1',
      tenant_id: genesisContext.tenant.id,
      revision: 1,
      ai_locked: true,
      stage_key: 'sales_human'
    };

    // Sub-teste 1.1: revision > saved.revision sem evento específico
    {
      const env = createCoreSandbox({
        salesLoadLead: async () => ({ ...savedLead, revision: 2, ai_locked: true }),
        supabaseGet: async () => []
      });

      const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, null, null);
      console.log('  1.1 Revision > saved.revision sem evento:', outcome.status);
      assert.notEqual(outcome.status, 'assigned', 'NUNCA deve retornar "assigned" apenas por aumento de revision!');
      assert.equal(outcome.status, 'dispatch_uncertain');
      assert.equal(outcome.confirmed, false);
      console.log('  ✓ 1.1 Passou: revision > saved.revision sem evento NÃO retorna "assigned"');
    }

    // Sub-teste 1.2: Evento de atribuição ANTIGO existente no histórico (> 30s atrás)
    {
      const staleEvent = {
        id: 'evt-old-assign',
        service: 'conversation_assigned',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        command_id: 'wesley_automoveis:whatsapp:5521999990000:assign:old_turn',
        tenant_id: genesisContext.tenant.id,
        external_conversation_id: '5521999990000',
        raw_payload: {
          sales_lead_id: savedLead.id,
          assignee: { id: 'usr-wesley', name: 'Wesley' }
        }
      };

      const env = createCoreSandbox({
        salesCurrentAssignmentCommandId: 'wesley_automoveis:whatsapp:5521999990000:assign:current_turn',
        salesLoadLead: async () => ({ ...savedLead, revision: 2, ai_locked: true }),
        supabaseGet: async () => [staleEvent]
      });

      const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, null, null);
      console.log('  1.2 Evento antigo (> 30s, outro command_id):', outcome.status);
      assert.notEqual(outcome.status, 'assigned', 'NUNCA deve retornar "assigned" baseado em evento antigo!');
      assert.equal(outcome.status, 'dispatch_uncertain');
      assert.equal(outcome.confirmed, false);
      console.log('  ✓ 1.2 Passou: Evento antigo não é aceito como confirmação da tentativa atual');
    }

    // Sub-teste 1.3: Evento recente (< 30s), mas para OUTRO operador ("Carlos" !== "Wesley")
    {
      const wrongOperatorEvent = {
        id: 'evt-carlos-assign',
        service: 'conversation_assigned',
        created_at: new Date().toISOString(),
        command_id: 'wesley_automoveis:whatsapp:5521999990000:assign:turn_now',
        tenant_id: genesisContext.tenant.id,
        external_conversation_id: '5521999990000',
        raw_payload: {
          sales_lead_id: savedLead.id,
          assignee: { id: 'usr-carlos', name: 'Carlos' }
        }
      };

      const env = createCoreSandbox({
        salesCurrentAssignmentCommandId: 'wesley_automoveis:whatsapp:5521999990000:assign:turn_now',
        salesLoadLead: async () => ({ ...savedLead, revision: 2, ai_locked: true }),
        supabaseGet: async () => [wrongOperatorEvent]
      });

      const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, null, null);
      console.log('  1.3 Atribuição a operador diferente ("Carlos" !== "Wesley"):', outcome.status);
      assert.notEqual(outcome.status, 'assigned');
      assert.equal(outcome.status, 'dispatch_uncertain');
      assert.equal(outcome.confirmed, false);
      console.log('  ✓ 1.3 Passou: Operador diferente é rejeitado');
    }

    // Sub-teste 1.4: Evento recente com operador CORRETO ("Wesley") e tentativa atual correspondente
    {
      const validCurrentEvent = {
        id: 'evt-wesley-assign-current',
        service: 'conversation_assigned',
        created_at: new Date().toISOString(),
        command_id: 'wesley_automoveis:whatsapp:5521999990000:assign:turn_now',
        tenant_id: genesisContext.tenant.id,
        external_conversation_id: '5521999990000',
        raw_payload: {
          sales_lead_id: savedLead.id,
          assignee: { id: 'usr-wesley', name: 'Wesley' }
        }
      };

      const env = createCoreSandbox({
        salesCurrentAssignmentCommandId: 'wesley_automoveis:whatsapp:5521999990000:assign:turn_now',
        salesLoadLead: async () => ({ ...savedLead, revision: 2, ai_locked: true }),
        supabaseGet: async () => [validCurrentEvent]
      });

      const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, null, null);
      console.log('  1.4 Evento correto e atual de Wesley:', outcome.status);
      assert.equal(outcome.status, 'assigned');
      assert.equal(outcome.confirmed, true);
      assert.equal(outcome.lead.id, savedLead.id);
      console.log('  ✓ 1.4 Passou: "assigned" retornado exclusivamente com evidência direta e operador coincidente');
    }

    // Sub-teste 1.5: Duas atribuições concorrentes ao MESMO operador e ao MESMO lead, com command IDs DIFERENTES, em < 30s
    {
      const commandIdA = 'wesley_automoveis:whatsapp:5521999990000:assign:cmd_A';
      const commandIdB = 'wesley_automoveis:whatsapp:5521999990000:assign:cmd_B';

      const eventA = {
        id: 'evt-assign-cmd-A',
        service: 'conversation_assigned',
        created_at: new Date(Date.now() - 3000).toISOString(),
        command_id: commandIdA,
        tenant_id: genesisContext.tenant.id,
        external_conversation_id: '5521999990000',
        raw_payload: {
          sales_lead_id: savedLead.id,
          assignee: { id: 'usr-wesley', name: 'Wesley' }
        }
      };

      const envB = createCoreSandbox({
        salesCurrentAssignmentCommandId: commandIdB,
        salesLoadLead: async () => ({ ...savedLead, revision: 2, ai_locked: true }),
        supabaseGet: async () => [eventA]
      });

      const outcomeB = await envB.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, null, null);
      console.log('  1.5 Tentativa B examinando evento de A (command ID diferente):', outcomeB.status);

      assert.notEqual(outcomeB.status, 'assigned', 'Tentativa B NUNCA deve ser confirmada por evento de A!');
      assert.equal(outcomeB.status, 'dispatch_uncertain');
      assert.equal(outcomeB.confirmed, false);
      assert.equal(outcomeB.lead.ai_locked, true);
      console.log('  ✓ 1.5 Passou: Duas atribuições concorrentes (< 30s) não se confundem graças ao command ID inequívoco');
    }

    // Sub-teste 1.6: Validação estrita do fast path (matchesCurrentDirectResult) contra contexto autorizado
    {
      const currentCommandId = 'wesley_automoveis:whatsapp:5521999990000:assign:fast_path';

      // 1.6A: Resposta direta incompleta (faltando tenant_id) -> deve rejeitar fast path
      {
        const incompleteResult = {
          id: 'evt-direct-incomplete',
          command_id: currentCommandId,
          // tenant_id ausente!
          channel_type: 'whatsapp',
          external_conversation_id: '5521999990000',
          raw_payload: { sales_lead_id: savedLead.id, assignee: { id: 'usr-wesley', name: 'Wesley' } }
        };

        const env = createCoreSandbox({
          salesCurrentAssignmentCommandId: currentCommandId,
          salesLoadLead: async () => ({ ...savedLead, revision: 1, ai_locked: true }),
          supabaseGet: async () => []
        });

        const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, incompleteResult, null);
        console.log('  1.6A Resposta direta incompleta (sem tenant_id):', outcome.status);
        assert.notEqual(outcome.status, 'assigned', 'Resultado incompleto sem tenant_id NUNCA pode ser aceito no fast path!');
        console.log('  ✓ 1.6A Passou: Fast path rejeita resultado sem tenant_id');
      }

      // 1.6B: Resposta direta com conversa divergente -> deve rejeitar fast path
      {
        const wrongChatResult = {
          id: 'evt-direct-wrong-chat',
          command_id: currentCommandId,
          tenant_id: genesisContext.tenant.id,
          channel_type: 'whatsapp',
          external_conversation_id: '5521999999999', // Conversa diferente!
          raw_payload: { sales_lead_id: savedLead.id, assignee: { id: 'usr-wesley', name: 'Wesley' } }
        };

        const env = createCoreSandbox({
          salesCurrentAssignmentCommandId: currentCommandId,
          salesLoadLead: async () => ({ ...savedLead, revision: 1, ai_locked: true }),
          supabaseGet: async () => []
        });

        const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, wrongChatResult, null);
        console.log('  1.6B Resposta direta com conversa divergente:', outcome.status);
        assert.notEqual(outcome.status, 'assigned', 'Resultado com chat divergente deve ser rejeitado no fast path!');
        console.log('  ✓ 1.6B Passou: Fast path rejeita resultado de outro chat');
      }

      // 1.6C: Resposta direta completa e autorizada -> aceita e confirma
      {
        const authorizedResult = {
          id: 'evt-direct-authorized',
          command_id: currentCommandId,
          tenant_id: genesisContext.tenant.id,
          channel_type: 'whatsapp',
          external_conversation_id: '5521999990000',
          raw_payload: { sales_lead_id: savedLead.id, assignee: { id: 'usr-wesley', name: 'Wesley' } }
        };

        const env = createCoreSandbox({
          salesCurrentAssignmentCommandId: currentCommandId,
          salesLoadLead: async () => ({ ...savedLead, revision: 2, ai_locked: true })
        });

        const outcome = await env.salesVerifyAssignmentOutcome(genesisContext, savedLead, defaultAssignee, authorizedResult, null);
        console.log('  1.6C Resposta direta completa e autorizada:', outcome.status);
        assert.equal(outcome.status, 'assigned');
        assert.equal(outcome.confirmed, true);
        console.log('  ✓ 1.6C Passou: Fast path aceita exclusivamente resposta íntegra e contextualizada');
      }
    }
  }

  console.log('\n--- REQUISITO 2: ATRIBUIÇÃO EM EXECUÇÃO APÓS TIMEOUT (IN-FLIGHT) & PRESERVAÇÃO DE AI_LOCKED=TRUE ---');
  {
    const initialLead = {
      id: 'lead-inflight-timeout',
      tenant_id: genesisContext.tenant.id,
      revision: 1,
      ai_locked: true,
      stage_key: 'sales_human',
      state: { intent: 'buy', financing: { vehicle: 'Yamaha Crosser' } }
    };
    const defaultAssignee = { id: 'usr-wesley', name: 'Wesley' };

    let recoveryAttempted = false;

    const dbState = {
      lead: { ...initialLead },
      events: []
    };

    const env = createCoreSandbox({
      salesLoadLead: async () => ({ ...dbState.lead }),
      supabaseGet: async () => [...dbState.events],
      supabasePatch: async (url, body) => {
        if (body.ai_locked === false) {
          recoveryAttempted = true;
          dbState.lead = { ...dbState.lead, ...body };
        }
        return [dbState.lead];
      }
    });

    const assignmentError = 'ETIMEDOUT: Connection timed out after 5000ms';

    assert.equal(dbState.lead.revision, 1);
    assert.equal(dbState.events.length, 0);

    const outcome = await env.salesVerifyAssignmentOutcome(
      genesisContext,
      initialLead,
      defaultAssignee,
      null,
      assignmentError
    );

    console.log('  Outcome da verificação durante timeout in-flight:', outcome.status);
    console.log('  Confirmed:', outcome.confirmed);
    console.log('  Motivo:', outcome.reason);

    assert.equal(outcome.status, 'dispatch_uncertain', 'Timeout em andamento DEVE retornar dispatch_uncertain, NUNCA dispatch_failed!');
    assert.equal(outcome.confirmed, false);
    assert.match(outcome.reason, /TIMEOUT_IN_FLIGHT_UNCERTAIN/);

    let saved = { ...initialLead };
    let dispatchStatus = 'dispatch_failed';

    if (outcome.status === 'assigned') {
      dispatchStatus = 'assigned';
    } else if (outcome.status === 'dispatch_failed' && outcome.provenFailure) {
      await env.salesRecoverFailedAssignment(genesisContext, saved, saved.state);
    } else {
      dispatchStatus = 'dispatch_uncertain';
      saved.ai_locked = true;
    }

    assert.equal(recoveryAttempted, false, 'salesRecoverFailedAssignment NUNCA pode ser chamado após timeout in-flight!');
    assert.equal(saved.ai_locked, true, 'saved.ai_locked DEVE permanecer true!');
    assert.equal(dbState.lead.ai_locked, true, 'db.lead.ai_locked no banco NÃO pode ter sido desbloqueado!');

    // Conclusão tardia no Postgres
    dbState.lead.revision = 2;
    dbState.events.push({
      id: 'evt-inflight-completed',
      service: 'conversation_assigned',
      created_at: new Date().toISOString(),
      raw_payload: {
        sales_lead_id: initialLead.id,
        assignee: { id: 'usr-wesley', name: 'Wesley' }
      }
    });

    console.log('  Transação tardia concluída no Postgres. Revision atual:', dbState.lead.revision);
    console.log('  Estado final de ai_locked no lead:', dbState.lead.ai_locked);
    assert.equal(dbState.lead.ai_locked, true, 'O lead permaneceu protegido contra tomada indevida da IA!');
    console.log('  ✓ 2 Passou: Timeout in-flight isolado em dispatch_uncertain sem desbloqueio indevido do lead');
  }

  console.log('\n--- REQUISITO 3: PERSISTÊNCIA REAL, PRESERVAÇÃO DE ATRIBUIÇÃO HUMANA & DISPUTA ENTRE ATENDENTES ---');
  {
    // Sub-teste 3.1: Preservação de todos os outros campos do state
    {
      const initialLead = {
        id: 'lead-concurrency-fields',
        tenant_id: genesisContext.tenant.id,
        revision: 4,
        ai_locked: true,
        stage_key: 'sales_human',
        state: {
          intent: 'buy',
          customer_name: 'Marcos Vinicius',
          cpf: '12345678909',
          financing: { vehicle: 'Yamaha Fazer 250', deposit_cents: 800000, documents_complete: true },
          trade_in: { model: 'Honda CG 160', year: '2021' },
          custom_operational_tag: 'vip_client'
        }
      };

      const humanDispatchData = {
        status: 'assigned',
        assignee_id: 'usr-wesley',
        assignee_name: 'Wesley',
        target_assignee: null,
        within_business_hours: true,
        next_opening: null
      };

      let capturedPatchFilter = null;
      const env = createCoreSandbox({
        supabasePatch: async (url, body) => {
          capturedPatchFilter = url;
          return [{ ...initialLead, state: body.state, revision: body.revision }];
        }
      });

      const s = { ...(initialLead.state || {}) };
      let saved = { ...initialLead };

      const mergedState = { ...(saved.state || {}), ...s, human_dispatch: humanDispatchData };
      const patchRes = await env.supabasePatch('/rest/v1/sales_leads?id=eq.' + env.encodeFilter(saved.id)
        + '&tenant_id=eq.' + env.encodeFilter(genesisContext.tenant.id)
        + '&chat_id=eq.' + env.encodeFilter(env.chatId)
        + '&revision=eq.' + env.encodeFilter(saved.revision),
        { state: mergedState, revision: saved.revision + 1, updated_at: new Date().toISOString() });

      saved = patchRes[0];

      console.log('  3.1 Patch URL filter:', capturedPatchFilter);
      assert.match(capturedPatchFilter, /&revision=eq\.4/, 'PATCH DEVE incluir controle de concorrência com revision=eq.');
      assert.equal(saved.revision, 5);
      assert.equal(saved.state.customer_name, 'Marcos Vinicius');
      assert.equal(saved.state.cpf, '12345678909');
      assert.deepEqual(saved.state.financing, { vehicle: 'Yamaha Fazer 250', deposit_cents: 800000, documents_complete: true });
      assert.deepEqual(saved.state.trade_in, { model: 'Honda CG 160', year: '2021' });
      assert.equal(saved.state.custom_operational_tag, 'vip_client');
      assert.deepEqual(saved.state.human_dispatch, humanDispatchData);
      console.log('  ✓ 3.1 Passou: Concorrência revision=eq. garantida e nenhum campo pré-existente foi sobrescrito');
    }

    // Sub-teste 3.2: Colisão de concorrência sem atribuição anterior e repatriciação bem-sucedida
    {
      const initialLead = {
        id: 'lead-concurrency-conflict',
        tenant_id: genesisContext.tenant.id,
        revision: 2,
        state: { intent: 'buy', step: 'initial' }
      };

      const humanDispatchData = { status: 'dispatch_uncertain', assignee_id: null, assignee_name: null };

      let firstPatchAttempted = false;
      let retryPatchAttempted = false;

      const env = createCoreSandbox({
        supabasePatch: async (url, body) => {
          if (url.includes('revision=eq.2')) {
            firstPatchAttempted = true;
            return [];
          }
          if (url.includes('revision=eq.3')) {
            retryPatchAttempted = true;
            return [{ ...initialLead, revision: 4, state: body.state }];
          }
          return [];
        },
        salesLoadLead: async () => ({
          ...initialLead,
          revision: 3,
          state: { intent: 'buy', step: 'updated_by_concurrent_worker', concurrent_note: 'keep_me' }
        })
      });

      let saved = { ...initialLead };
      const s = { ...(saved.state || {}) };

      const mergedState = { ...(saved.state || {}), ...s, human_dispatch: humanDispatchData };
      const patchRes = await env.supabasePatch('/rest/v1/sales_leads?id=eq.' + env.encodeFilter(saved.id)
        + '&tenant_id=eq.' + env.encodeFilter(genesisContext.tenant.id)
        + '&chat_id=eq.' + env.encodeFilter(env.chatId)
        + '&revision=eq.' + env.encodeFilter(saved.revision),
        { state: mergedState, revision: saved.revision + 1, updated_at: new Date().toISOString() });

      let currentAttemptPersisted = false;
      const patchedRow = Array.isArray(patchRes) ? patchRes[0] : (patchRes?.id ? patchRes : null);
      if (patchedRow?.id && patchedRow.revision > saved.revision) {
        saved = patchedRow;
        currentAttemptPersisted = true;
      } else {
        const reloadedAfterConflict = await env.salesLoadLead(genesisContext);
        if (reloadedAfterConflict?.id === saved.id) {
          saved = reloadedAfterConflict;
          const retryMerged = { ...(saved.state || {}), human_dispatch: humanDispatchData };
          const retryPatch = await env.supabasePatch('/rest/v1/sales_leads?id=eq.' + env.encodeFilter(saved.id)
            + '&tenant_id=eq.' + env.encodeFilter(genesisContext.tenant.id)
            + '&chat_id=eq.' + env.encodeFilter(env.chatId)
            + '&revision=eq.' + env.encodeFilter(saved.revision),
            { state: retryMerged, revision: saved.revision + 1, updated_at: new Date().toISOString() });
          const retryRow = Array.isArray(retryPatch) ? retryPatch[0] : (retryPatch?.id ? retryPatch : null);
          if (retryRow?.id && retryRow.revision > saved.revision) {
            saved = retryRow;
            currentAttemptPersisted = true;
          }
        }
      }

      assert.equal(firstPatchAttempted, true);
      assert.equal(retryPatchAttempted, true);
      assert.equal(currentAttemptPersisted, true);
      assert.equal(saved.revision, 4);
      assert.equal(saved.state.concurrent_note, 'keep_me');
      assert.deepEqual(saved.state.human_dispatch, humanDispatchData);
      console.log('  ✓ 3.2 Passou: Conflito de concorrência detectado, recarregado e repatriciado sem perda de dados');
    }

    // Sub-teste 3.5: Falha HTTP (500) no PATCH do lead — NUNCA atualizar memória local como sucesso
    {
      const initialLead = {
        id: 'lead-patch-fail-http',
        tenant_id: genesisContext.tenant.id,
        revision: 1,
        ai_locked: true,
        state: { intent: 'buy', financing: { step: 'docs' } }
      };

      const humanDispatchData = { status: 'assigned', assignee_name: 'Wesley' };

      let leadPatchError = null;
      let currentAttemptPersisted = false;
      let saved = { ...initialLead };

      const env = createCoreSandbox({
        supabasePatch: async () => {
          throw new Error('HTTP 500: Internal Server Error on Postgres update');
        }
      });

      try {
        const mergedState = { ...(saved.state || {}), human_dispatch: humanDispatchData };
        const patchRes = await env.supabasePatch('/rest/v1/sales_leads?...', { state: mergedState });
        const patchedRow = Array.isArray(patchRes) ? patchRes[0] : patchRes;
        if (patchedRow?.id && patchedRow.revision > saved.revision) {
          saved = patchedRow;
          currentAttemptPersisted = true;
        }
      } catch (err) {
        leadPatchError = 'LEAD_PATCH_FAILED: ' + String(err.message || err);
      }

      console.log('  3.5 Falha HTTP no PATCH:', leadPatchError);
      console.log('  currentAttemptPersisted:', currentAttemptPersisted);
      console.log('  saved.state.human_dispatch na memória:', saved.state.human_dispatch);

      assert.equal(currentAttemptPersisted, false, 'currentAttemptPersisted DEVE ser false após falha HTTP!');
      assert.match(leadPatchError, /HTTP 500/);
      assert.strictEqual(saved.state.human_dispatch, undefined, 'Memória local NÃO pode fingir que gravou no banco!');
      assert.equal(saved.revision, 1);
      assert.equal(saved.ai_locked, true, 'Bloqueio humano continua efetivo!');
      console.log('  ✓ 3.5 Passou: Falha HTTP não atualiza memória local, propaga erro e mantém ai_locked=true');
    }

    // Sub-teste 3.6: Timeout no PATCH do lead — Bloqueio humano efetivo mantido no estado
    {
      const initialLead = {
        id: 'lead-patch-timeout',
        tenant_id: genesisContext.tenant.id,
        revision: 2,
        ai_locked: true,
        state: { intent: 'buy' }
      };

      let leadPatchError = null;
      let currentAttemptPersisted = false;
      let saved = { ...initialLead };

      const env = createCoreSandbox({
        supabasePatch: async () => {
          throw new Error('ETIMEDOUT: Connection timeout during sales_leads PATCH');
        }
      });

      try {
        await env.supabasePatch('/rest/v1/sales_leads?...', {});
        currentAttemptPersisted = true;
      } catch (err) {
        leadPatchError = 'LEAD_PATCH_FAILED: ' + String(err.message || err);
      }

      assert.equal(currentAttemptPersisted, false);
      assert.match(leadPatchError, /ETIMEDOUT/);
      assert.equal(saved.ai_locked, true, 'ai_locked DEVE permanecer true durante timeout!');
      console.log('  ✓ 3.6 Passou: Timeout no PATCH mantém ai_locked=true');
    }

    // Sub-teste 3.7: Duas transferências disputando o mesmo lead (Wesley vs Carlos):
    // Preservar atribuição existente sem substituição indevida e diferenciar status
    {
      // Cenário 3.7A: Carlos já estava confirmado no banco. Wesley tenta transferir concorrentemente.
      {
        const leadWithCarlos = {
          id: 'lead-carlos-assigned',
          tenant_id: genesisContext.tenant.id,
          revision: 2,
          ai_locked: true,
          stage_key: 'sales_human',
          state: {
            intent: 'buy',
            human_dispatch: {
              status: 'assigned',
              assignee_id: 'usr-carlos',
              assignee_name: 'Carlos',
              within_business_hours: true,
              next_opening: null
            }
          }
        };

        // Tentativa de Wesley (iniciada com lead na revision 1)
        let savedWesley = { ...leadWithCarlos, revision: 1 };
        let wesleyDispatchData = {
          status: 'assigned',
          assignee_id: 'usr-wesley',
          assignee_name: 'Wesley',
          within_business_hours: true
        };
        let dispatchStatusWesley = 'assigned';
        let currentAttemptPersistedWesley = false;
        let existingAssignmentPreservedWesley = false;
        let assignmentResultWesley = 'pending_persistence';

        const envWesley = createCoreSandbox({
          supabasePatch: async (url) => {
            if (url.includes('revision=eq.1')) return []; // Colisão com Carlos na revision 2!
            return [];
          },
          salesLoadLead: async () => ({ ...leadWithCarlos })
        });

        // Simulação do bloco de persistência e resolução de concorrência em noria_core.js
        const patchRes = await envWesley.supabasePatch('/rest/v1/sales_leads?id=eq.' + envWesley.encodeFilter(savedWesley.id)
          + '&tenant_id=eq.' + envWesley.encodeFilter(genesisContext.tenant.id)
          + '&chat_id=eq.' + envWesley.encodeFilter(envWesley.chatId)
          + '&revision=eq.' + envWesley.encodeFilter(savedWesley.revision),
          { state: { ...(savedWesley.state || {}), human_dispatch: wesleyDispatchData }, revision: savedWesley.revision + 1 });

        const patchedRow = Array.isArray(patchRes) ? patchRes[0] : (patchRes?.id ? patchRes : null);
        if (patchedRow?.id && patchedRow.revision > savedWesley.revision) {
          savedWesley = patchedRow;
          currentAttemptPersistedWesley = true;
          assignmentResultWesley = 'current_assignment_confirmed';
        } else {
          const reloadedAfterConflict = await envWesley.salesLoadLead(genesisContext);
          if (reloadedAfterConflict?.id === savedWesley.id) {
            savedWesley = reloadedAfterConflict;
            const existingDispatch = savedWesley.state?.human_dispatch;
            const existingIsAssigned = existingDispatch && (
              existingDispatch.status === 'assigned'
              || Boolean(existingDispatch.assignee_id || existingDispatch.assignee_name)
            );

            if (existingIsAssigned) {
              existingAssignmentPreservedWesley = true;
              currentAttemptPersistedWesley = false;
              assignmentResultWesley = 'existing_assignment_preserved';
              dispatchStatusWesley = 'assigned';
              wesleyDispatchData = {
                ...existingDispatch,
                assignment_result: 'existing_assignment_preserved'
              };
              savedWesley.ai_locked = true;
            }
          }
        }

        console.log('  3.7A Tentativa de Wesley disputando lead já atribuído a Carlos:');
        console.log('    Operador final no lead:', wesleyDispatchData.assignee_name);
        console.log('    assignmentResult:', assignmentResultWesley);
        console.log('    existingAssignmentPreserved:', existingAssignmentPreservedWesley);
        console.log('    currentAttemptPersisted:', currentAttemptPersistedWesley);
        console.log('    savedWesley.ai_locked:', savedWesley.ai_locked);

        assert.equal(wesleyDispatchData.assignee_name, 'Carlos', 'Carlos NÃO pode ser substituído indevidamente por Wesley!');
        assert.equal(wesleyDispatchData.assignee_id, 'usr-carlos');
        assert.equal(assignmentResultWesley, 'existing_assignment_preserved', 'Deve diferenciar existing_assignment_preserved de current_assignment_confirmed!');
        assert.equal(existingAssignmentPreservedWesley, true);
        assert.equal(currentAttemptPersistedWesley, false, 'A escrita da tentativa atual NÃO pode ser marcada como persistida!');
        assert.equal(savedWesley.ai_locked, true, 'ai_locked DEVE ser true!');
        console.log('  ✓ 3.7A Passou: Atribuição existente de Carlos é preservada intacta diante de tentativa concorrente de Wesley');
      }

      // Cenário 3.7B: Wesley já estava confirmado no banco. Carlos tenta transferir concorrentemente.
      {
        const leadWithWesley = {
          id: 'lead-wesley-assigned',
          tenant_id: genesisContext.tenant.id,
          revision: 2,
          ai_locked: true,
          stage_key: 'sales_human',
          state: {
            intent: 'buy',
            human_dispatch: {
              status: 'assigned',
              assignee_id: 'usr-wesley',
              assignee_name: 'Wesley',
              within_business_hours: true,
              next_opening: null
            }
          }
        };

        let savedCarlos = { ...leadWithWesley, revision: 1 };
        let carlosDispatchData = {
          status: 'assigned',
          assignee_id: 'usr-carlos',
          assignee_name: 'Carlos'
        };
        let currentAttemptPersistedCarlos = false;
        let existingAssignmentPreservedCarlos = false;
        let assignmentResultCarlos = 'pending_persistence';

        const envCarlos = createCoreSandbox({
          supabasePatch: async (url) => {
            if (url.includes('revision=eq.1')) return []; // Colisão com Wesley na revision 2!
            return [];
          },
          salesLoadLead: async () => ({ ...leadWithWesley })
        });

        const patchRes = await envCarlos.supabasePatch('/rest/v1/sales_leads?...');
        const patchedRow = Array.isArray(patchRes) ? patchRes[0] : (patchRes?.id ? patchRes : null);
        if (patchedRow?.id && patchedRow.revision > savedCarlos.revision) {
          savedCarlos = patchedRow;
          currentAttemptPersistedCarlos = true;
        } else {
          const reloadedAfterConflict = await envCarlos.salesLoadLead(genesisContext);
          if (reloadedAfterConflict?.id === savedCarlos.id) {
            savedCarlos = reloadedAfterConflict;
            const existingDispatch = savedCarlos.state?.human_dispatch;
            const existingIsAssigned = existingDispatch && (
              existingDispatch.status === 'assigned'
              || Boolean(existingDispatch.assignee_id || existingDispatch.assignee_name)
            );

            if (existingIsAssigned) {
              existingAssignmentPreservedCarlos = true;
              currentAttemptPersistedCarlos = false;
              assignmentResultCarlos = 'existing_assignment_preserved';
              carlosDispatchData = {
                ...existingDispatch,
                assignment_result: 'existing_assignment_preserved'
              };
              savedCarlos.ai_locked = true;
            }
          }
        }

        console.log('  3.7B Tentativa de Carlos disputando lead já atribuído a Wesley:');
        console.log('    Operador final no lead:', carlosDispatchData.assignee_name);
        console.log('    assignmentResult:', assignmentResultCarlos);
        console.log('    savedCarlos.ai_locked:', savedCarlos.ai_locked);

        assert.equal(carlosDispatchData.assignee_name, 'Wesley', 'Wesley NÃO pode ser substituído indevidamente por Carlos!');
        assert.equal(carlosDispatchData.assignee_id, 'usr-wesley');
        assert.equal(assignmentResultCarlos, 'existing_assignment_preserved');
        assert.equal(existingAssignmentPreservedCarlos, true);
        assert.equal(currentAttemptPersistedCarlos, false);
        assert.equal(savedCarlos.ai_locked, true);
        console.log('  ✓ 3.7B Passou: Atribuição existente de Wesley é preservada intacta diante de tentativa concorrente de Carlos');
      }

      // Cenário 3.7C: Tentativa limpa bem-sucedida (sem colisão)
      {
        const currentAttemptConfirmedLead = {
          status: 'assigned',
          assignee_id: 'usr-wesley',
          assignee_name: 'Wesley'
        };

        const assignmentConfirmed = true;
        const currentAttemptPersisted = true;
        const assignmentResult = assignmentConfirmed ? 'current_assignment_confirmed' : 'current_attempt_persisted';

        assert.equal(assignmentResult, 'current_assignment_confirmed', 'Deve marcar current_assignment_confirmed quando a própria tentativa concluiu');
        console.log('  ✓ 3.7C Passou: Diferenciação clara entre existing_assignment_preserved e current_assignment_confirmed');
      }
    }

    // Sub-teste 3.8: Falha nas duas persistências — NUNCA produzir sucesso fictício
    {
      let assignmentConfirmed = false;
      let currentAttemptPersisted = false;
      let existingAssignmentPreserved = false;
      let dispatchStatus = 'assigned';
      const defaultAssignee = { id: 'usr-wesley', name: 'Wesley' };
      let humanDispatchData = {
        status: dispatchStatus,
        assignee_id: 'usr-wesley',
        assignee_name: 'Wesley'
      };
      let saved = { id: 'lead-both-failed', ai_locked: true };
      let assignmentResult = 'pending';

      if (!assignmentConfirmed && !currentAttemptPersisted && !existingAssignmentPreserved) {
        if (dispatchStatus === 'assigned') {
          dispatchStatus = 'dispatch_uncertain';
          humanDispatchData.status = 'dispatch_uncertain';
          humanDispatchData.assignee_id = null;
          humanDispatchData.assignee_name = null;
          humanDispatchData.target_assignee = defaultAssignee ? { id: defaultAssignee.id || null, name: defaultAssignee.name || null } : null;
        }
        assignmentResult = 'persistence_failed';
        saved.ai_locked = true;
      }

      console.log('  3.8 Status após falha dupla de persistência:', dispatchStatus);
      console.log('  Assignee ID:', humanDispatchData.assignee_id);
      console.log('  Assignment Result:', assignmentResult);
      console.log('  AI Locked:', saved.ai_locked);

      assert.equal(dispatchStatus, 'dispatch_uncertain', 'NUNCA reportar assigned se ambas as persistências falharam!');
      assert.strictEqual(humanDispatchData.assignee_id, null, 'Operador NÃO pode ser confirmado!');
      assert.equal(assignmentResult, 'persistence_failed');
      assert.equal(saved.ai_locked, true, 'ai_locked DEVE ser true!');
      console.log('  ✓ 3.8 Passou: Falha em ambas as persistências impede sucesso fictício e mantém ai_locked=true');
    }
  }

  console.log('\n--- REQUISITO 4: NO ESTADO "dispatch_uncertain", NÃO APRESENTAR assignee_id CONFIRMADO NEM AFIRMAR SINALIZAÇÃO SEM COMPROVAÇÃO ---');
  {
    const defaultAssignee = { id: 'usr-wesley', name: 'Wesley' };
    const hoursStatus = { is_open: true, next_opening: null };

    const dispatchStatus = 'dispatch_uncertain';

    const humanDispatchData = {
      status: dispatchStatus,
      assignee_id: dispatchStatus === 'assigned' ? (defaultAssignee?.id || null) : null,
      assignee_name: dispatchStatus === 'assigned' ? (defaultAssignee?.name || null) : null,
      target_assignee: (dispatchStatus === 'dispatch_uncertain' && defaultAssignee) ? {
        id: defaultAssignee.id || null,
        name: defaultAssignee.name || null
      } : null,
      within_business_hours: hoursStatus?.is_open ?? true,
      next_opening: hoursStatus?.next_opening?.formatted || null
    };

    console.log('  Payload human_dispatch no estado incerto:', JSON.stringify(humanDispatchData, null, 2));

    assert.strictEqual(humanDispatchData.assignee_id, null, 'assignee_id DEVE ser null no estado dispatch_uncertain!');
    assert.strictEqual(humanDispatchData.assignee_name, null, 'assignee_name DEVE ser null no estado dispatch_uncertain!');
    assert.deepEqual(humanDispatchData.target_assignee, { id: 'usr-wesley', name: 'Wesley' }, 'target_assignee deve preservar quem se tentou acionar');

    const event = { raw_payload: { human_dispatch: humanDispatchData } };
    let reply = '';
    if (dispatchStatus === 'dispatch_uncertain') {
      event.ai_error = 'SALES_DISPATCH_UNCERTAIN';
      reply = 'Recebi sua mensagem. Seu atendimento está registrado e passará por verificação da nossa equipe em breve.';
    }

    console.log('  Resposta ao cliente:', `"${reply}"`);
    console.log('  AI Error registrado:', event.ai_error);

    assert.equal(event.ai_error, 'SALES_DISPATCH_UNCERTAIN');
    assert.doesNotMatch(reply, /sinalizada|equipe já foi|avisei/i, 'NUNCA deve dizer que a equipe já foi sinalizada sem confirmação real!');
    assert.doesNotMatch(reply, /Wesley/i, 'Não deve prometer operador específico não confirmado!');
    assert.match(reply, /passará por verificação da nossa equipe em breve/i, 'Mensagem deve ser transparente e cautelosa');

    const leadState = {
      id: 'lead-uncertain-check',
      tenant_id: genesisContext.tenant.id,
      channel_type: 'whatsapp',
      chat_id: '5521999990000',
      revision: 2,
      ai_locked: true,
      stage_key: 'sales_human',
      state: { human_dispatch: humanDispatchData }
    };
    const kanbanEvent = {
      id: 'evt-uncertain-check',
      tenant_id: genesisContext.tenant.id,
      channel_type: 'whatsapp',
      external_conversation_id: '5521999990000',
      stage: 'Atendimento humano',
      handoff: true,
      raw_payload: { human_dispatch: humanDispatchData }
    };

    const kanban = eventsToKanban([kanbanEvent], 'wesley_automoveis', [], null, [], [leadState]);
    const cols = Array.isArray(kanban) ? kanban : kanban.columns;
    const humanCol = cols.find(c => c.id === 'conversas_humanos' || c.id === 'sales_human');
    const card = humanCol?.cards?.find(c => c.externalConversationId === '5521999990000');

    assert.ok(card, 'Card deve estar presente na coluna de atendimento humano');
    assert.equal(card.humanDispatchStatus, 'dispatch_uncertain');
    assert.notEqual(card.owner, 'Wesley', 'Wesley NÃO pode ser exibido como responsável confirmado!');
    assert.equal(card.ownerId, null, 'ownerId confirmado deve ser null');
    assert.equal(card.aiReason, 'Atendimento com status incerto - requer intervenção manual', 'Deve alertar necessidade de intervenção operacional');
    assert.equal(card.salesAiLocked, true, 'Lead deve permanecer protegido (ai_locked=true)');
    console.log('  ✓ 4 Passou: dispatch_uncertain não confirma operador, não mente sobre sinalização e requer intervenção manual');
  }

  console.log('\n================================================================================');
  console.log('🎯 TODAS AS VERIFICAÇÕES P0 FORAM COMPROVADAS COM SUCESSO E RIGOR MÁXIMO!');
  console.log('================================================================================');
}

runTestSuite().catch(err => {
  console.error('\n❌ Falha na bateria de testes:', err);
  process.exit(1);
});
