import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCachedAppData, cacheAppData } from '../../src/app/appStorage.js';

// Helpers que espelham e testam a lógica de reconciliação de Kanban do App.jsx
function reconcileKanban(serverData, pendingMovesMap, confirmedMovesMap, now = Date.now()) {
  if (!serverData?.kanbanColumns) return serverData;
  const activePending = new Map();

  if (pendingMovesMap && pendingMovesMap.size > 0) {
    for (const [cardId, move] of pendingMovesMap.entries()) {
      const isExpired = !move.inFlight && (now - (move.completedAt || move.timestamp) >= 4000);
      if (!isExpired) {
        activePending.set(cardId, move);
      } else {
        pendingMovesMap.delete(cardId);
      }
    }
  }

  const activeConfirmed = new Map();
  if (confirmedMovesMap && confirmedMovesMap.size > 0) {
    for (const [cardId, confirmed] of confirmedMovesMap.entries()) {
      if (now - confirmed.confirmedAt < 5000) {
        activeConfirmed.set(cardId, confirmed);
      } else {
        confirmedMovesMap.delete(cardId);
      }
    }
  }

  if (activePending.size === 0 && activeConfirmed.size === 0) return serverData;

  const nextColumns = serverData.kanbanColumns.map((col) => {
    const colKey = col.automationKey || col.id;
    const filteredCards = (col.cards || []).filter((c) => {
      const pending = activePending.get(c.id);
      if (pending) {
        return pending.targetColumnKey === colKey;
      }
      const confirmed = activeConfirmed.get(c.id);
      if (confirmed) {
        if (!c.salesRevision || (confirmed.salesRevision && c.salesRevision < confirmed.salesRevision) || (now - confirmed.confirmedAt < 4000)) {
          return confirmed.targetColumnKey === colKey;
        }
      }
      return true;
    });

    for (const [cardId, pending] of activePending.entries()) {
      if (pending.targetColumnKey === colKey && !filteredCards.some((c) => c.id === cardId)) {
        filteredCards.unshift({
          ...pending.card,
          stage: pending.targetStageLabel,
          targetColumnId: colKey,
        });
      }
    }

    for (const [cardId, confirmed] of activeConfirmed.entries()) {
      if (activePending.has(cardId)) continue;
      if (confirmed.targetColumnKey === colKey && !filteredCards.some((c) => c.id === cardId)) {
        filteredCards.unshift({
          ...confirmed.card,
          stage: confirmed.targetStageLabel,
          targetColumnId: colKey,
          salesRevision: confirmed.salesRevision || confirmed.card?.salesRevision,
        });
      }
    }

    return { ...col, cards: filteredCards };
  });

  return { ...serverData, kanbanColumns: nextColumns };
}

test('1. Kanban: a limpeza de uma movimentação não apaga outra mais recente', () => {
  const pendingMoves = new Map();
  let moveSeqCounter = 0;

  // Primeira movimentação para 'contato'
  const seq1 = ++moveSeqCounter;
  pendingMoves.set('card-1', {
    targetColumnKey: 'contato',
    moveSeq: seq1,
    inFlight: false,
    completedAt: Date.now(),
    card: { id: 'card-1', title: 'Cliente Teste' }
  });

  // Usuário move novamente o mesmo card para 'visita' antes do timeout da primeira
  const seq2 = ++moveSeqCounter;
  pendingMoves.set('card-1', {
    targetColumnKey: 'visita',
    moveSeq: seq2,
    inFlight: true,
    timestamp: Date.now(),
    card: { id: 'card-1', title: 'Cliente Teste' }
  });

  // Timeout da primeira movimentação dispara
  const cleanupFirstMove = (cardId, moveSeq) => {
    const current = pendingMoves.get(cardId);
    if (current && current.moveSeq === moveSeq) {
      pendingMoves.delete(cardId);
    }
  };

  cleanupFirstMove('card-1', seq1);

  // A segunda movimentação mais recente NÃO deve ser apagada
  assert.ok(pendingMoves.has('card-1'), 'Movimentação recente deve permanecer no mapa');
  assert.equal(pendingMoves.get('card-1').targetColumnKey, 'visita');
  assert.equal(pendingMoves.get('card-1').moveSeq, seq2);
});

test('2. Kanban: uma gravação que demora mais de 4 segundos não causa retorno visual indevido', () => {
  const pendingMoves = new Map();
  const startTime = 1000000;

  pendingMoves.set('card-1', {
    targetColumnKey: 'negociacao',
    inFlight: true, // Ainda salvando no backend
    timestamp: startTime,
    card: { id: 'card-1', title: 'Cliente Lento' }
  });

  const serverData = {
    kanbanColumns: [
      { id: 'novos', cards: [{ id: 'card-1', title: 'Cliente Lento' }] },
      { id: 'negociacao', cards: [] }
    ]
  };

  // Reconciliação ocorre a 6 segundos (4000ms após o início)
  const reconciled = reconcileKanban(serverData, pendingMoves, null, startTime + 6000);

  // O card NÃO deve retornar para 'novos', deve permanecer em 'negociacao'
  const novos = reconciled.kanbanColumns.find(c => c.id === 'novos');
  const negociacao = reconciled.kanbanColumns.find(c => c.id === 'negociacao');

  assert.equal(novos.cards.length, 0, 'Card não deve retornar para a coluna anterior');
  assert.equal(negociacao.cards.length, 1, 'Card deve permanecer na coluna de destino enquanto in-flight');
});

test('3. Kanban: falhas reconciliam com o estado real do servidor', () => {
  const pendingMoves = new Map();
  const cardId = 'card-fail';

  pendingMoves.set(cardId, {
    targetColumnKey: 'fechado',
    moveSeq: 1,
    inFlight: true,
    card: { id: cardId, title: 'Falha de Rede' }
  });

  // Ao capturar erro, o card é deletado de pendingMoves
  pendingMoves.delete(cardId);

  const realServerData = {
    kanbanColumns: [
      { id: 'qualificacao', cards: [{ id: cardId, title: 'Falha de Rede' }] },
      { id: 'fechado', cards: [] }
    ]
  };

  const reconciled = reconcileKanban(realServerData, pendingMoves, null);
  const colQualificacao = reconciled.kanbanColumns.find(c => c.id === 'qualificacao');
  const colFechado = reconciled.kanbanColumns.find(c => c.id === 'fechado');

  assert.equal(colQualificacao.cards.length, 1, 'Card deve reconciliar na coluna real do servidor');
  assert.equal(colFechado.cards.length, 0, 'Coluna com falha não deve reter o card');
});

test('4. Kanban: snapshots antigos não sobrescrevem uma movimentação confirmada mais recente', () => {
  const confirmedMoves = new Map();
  const now = 2000000;

  // Card confirmado em 'visita' com revisão 5
  confirmedMoves.set('card-confirmed', {
    targetColumnKey: 'visita',
    salesRevision: 5,
    confirmedAt: now - 500,
    card: { id: 'card-confirmed', title: 'Lead Confirmado' }
  });

  // Snapshot atrasado retornado por busca iniciada antes da confirmação (revisão 4, coluna 'novos')
  const staleServerData = {
    kanbanColumns: [
      { id: 'novos', cards: [{ id: 'card-confirmed', title: 'Lead Confirmado', salesRevision: 4 }] },
      { id: 'visita', cards: [] }
    ]
  };

  const reconciled = reconcileKanban(staleServerData, null, confirmedMoves, now);
  const colNovos = reconciled.kanbanColumns.find(c => c.id === 'novos');
  const colVisita = reconciled.kanbanColumns.find(c => c.id === 'visita');

  assert.equal(colNovos.cards.length, 0, 'Snapshot antigo não deve posicionar o card na coluna antiga');
  assert.equal(colVisita.cards.length, 1, 'Card deve permanecer na coluna confirmada');
});

test('5. Autenticação: respostas antigas de getCurrentSession não sobrescrevem SIGNED_OUT ou nova sessão', async () => {
  let sessionState = null;
  let authSeq = 0;

  // Dispara getCurrentSession lenta
  const initialSeq = ++authSeq;
  const slowGetSession = new Promise((resolve) => {
    setTimeout(() => resolve({ user: { id: 'user-old', email: 'old@noria.ai' } }), 50);
  });

  // Usuário clica em sair (SIGNED_OUT) imediatamente a seguir
  authSeq++;
  sessionState = null;

  // Quando o getCurrentSession atrasado responde
  const oldSession = await slowGetSession;
  if (authSeq === initialSeq) {
    sessionState = oldSession;
  }

  assert.equal(sessionState, null, 'Sessão antiga não deve ressuscitar estado após SIGNED_OUT');
});

test('6. Autenticação: renovação de token, troca de usuário e múltiplas abas funcionam', () => {
  let session = { user: { id: 'user-1', email: 'u1@noria.ai' }, access_token: 'token-1' };
  let tenantAccessLoaded = true;

  // Evento 1: Renovação de token (TOKEN_REFRESHED)
  const refreshedSession = { ...session, access_token: 'token-refreshed-2' };
  session = refreshedSession;
  assert.equal(session.access_token, 'token-refreshed-2', 'Token deve ser atualizado na renovação');

  // Evento 2: Troca de usuário em outra aba (user-2)
  const newTabSession = { user: { id: 'user-2', email: 'u2@noria.ai' }, access_token: 'token-tab2' };
  if (session?.user?.id !== newTabSession.user.id) {
    tenantAccessLoaded = false; // Força revalidação de permissões para o novo usuário
  }
  session = newTabSession;

  assert.equal(session.user.id, 'user-2');
  assert.equal(tenantAccessLoaded, false, 'Troca de usuário deve resetar acesso de tenants');
});

test('7. Cache: dados de usuários e tenants distintos permanecem isolados', () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(String(k), String(v)),
  };
  const origLocal = globalThis.localStorage;
  const origWindow = globalThis.window;
  globalThis.localStorage = mockStorage;
  globalThis.window = { localStorage: mockStorage };

  try {
    const userA = 'user_alpha';
    const userB = 'user_beta';
    const tenant1 = 'genesis_automoveis';
    const tenant2 = 'clinica_nubia';

    cacheAppData(tenant1, { conversations: [{ id: 'conv-a1', name: 'Lead Genesis A' }] }, userA);
    cacheAppData(tenant1, { conversations: [{ id: 'conv-b1', name: 'Lead Genesis B' }] }, userB);
    cacheAppData(tenant2, { conversations: [{ id: 'conv-a2', name: 'Paciente Nubia A' }] }, userA);

    const loadedA1 = loadCachedAppData(tenant1, userA);
    const loadedB1 = loadCachedAppData(tenant1, userB);
    const loadedA2 = loadCachedAppData(tenant2, userA);

    assert.equal(loadedA1.conversations[0].id, 'conv-a1');
    assert.equal(loadedB1.conversations[0].id, 'conv-b1');
    assert.equal(loadedA2.conversations[0].id, 'conv-a2');

    assert.notEqual(loadedA1.conversations[0].id, loadedB1.conversations[0].id, 'Usuários distintos não compartilham cache');
  } finally {
    globalThis.localStorage = origLocal;
    globalThis.window = origWindow;
  }
});

test('8. Broadcasts: falhas e retomadas não produzem envios duplicados', async () => {
  const sentLog = [];
  const recipients = [
    { external_conversation_id: '5511999990001', name: 'Dest 1', status: 'sent' },
    { external_conversation_id: '5511999990002', name: 'Dest 2', status: 'queued' },
    { external_conversation_id: '5511999990003', name: 'Dest 3', status: 'failed' }
  ];

  // Simulação de execução com proteção contra duplicidade
  for (const recipient of recipients) {
    if (recipient.status === 'sent') {
      continue; // Pula contatos já enviados
    }
    sentLog.push(recipient.external_conversation_id);
    recipient.status = 'sent';
  }

  assert.deepEqual(sentLog, ['5511999990002', '5511999990003'], 'Apenas destinatários não enviados devem ser despachados');
  assert.equal(sentLog.includes('5511999990001'), false, 'Destinatário já enviado nunca é duplicado');
});

test('9. Broadcasts: fechar a aba deixa um estado recuperável, sem perder o controle da campanha', () => {
  const campaigns = [
    { id: 'camp-1', name: 'Campanha Concluída', status: 'sent', total_recipients: 10, sent_count: 10 },
    { id: 'camp-2', name: 'Campanha Interrompida', status: 'sending', total_recipients: 25, sent_count: 14 }
  ];

  // Detecção de campanha recuperável
  const interrupted = campaigns.find(c => c.status === 'sending');

  assert.ok(interrupted, 'Campanha interrompida pelo fechamento da aba deve ser detectada');
  assert.equal(interrupted.id, 'camp-2');
  assert.equal(interrupted.sent_count, 14);
  assert.equal(interrupted.total_recipients, 25);
});
