import { useCallback, useEffect, useRef, useState } from 'react';
import { appointmentReminders, belongsToTenant, followUpReminders, MAX_NOTIFICATIONS, mergeOperatorNotifications, notificationScope, OPERATOR_EVENT, operatorEvents } from './operatorEvents.js';

export function readOperatorNotifications(storage, key, tenantId) {
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item?.tenantId === tenantId && typeof item.id === 'string' && typeof item.title === 'string'
      && typeof item.description === 'string' && typeof item.unread === 'boolean' && Number.isFinite(Date.parse(item.createdAt))).slice(0, MAX_NOTIFICATIONS);
  } catch { return []; }
}

export function useOperatorNotifications({ tenantId, tenantSlug, userId, appointments = [], kanbanColumns = [] }) {
  const key = notificationScope(tenantId, userId);
  const [items, setItems] = useState(() => {
    try { return readOperatorNotifications(window.localStorage, key, tenantId); } catch { return []; }
  });
  const [soundSequence, setSoundSequence] = useState(0);
  const itemsRef = useRef(items);
  const rows = useRef(new Map());
  const add = useCallback((incoming) => {
    if (!incoming.length) return;
    const previous = itemsRef.current;
    const hasNew = incoming.some(item => !previous.some(old => old.id === item.id));
    if (!hasNew) return;
    const next = mergeOperatorNotifications(previous, incoming);
    itemsRef.current = next;
    setItems(next);
    setSoundSequence(value => value + 1);
  }, []);

  useEffect(() => {
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify(items)); } catch { /* The inbox remains usable when storage is unavailable. */ }
  }, [key, items]);

  useEffect(() => {
    if (!key) return undefined;
    const receive = event => {
      const detail = event.detail;
      if (detail?.tenantId !== tenantId || detail?.userId !== userId) return;
      const payload = detail.payload;
      if (!belongsToTenant(payload?.new, tenantId, tenantSlug)) return;
      const rowKey = `${payload.table}:${payload.new.id}`;
      const old = rows.current.get(rowKey) || payload.old || {};
      rows.current.set(rowKey, payload.new);
      if (rows.current.size > 500) rows.current.delete(rows.current.keys().next().value);
      add(operatorEvents({ ...payload, old }, { tenantId, tenantSlug, userId }));
    };
    const storage = event => {
      if (event.key !== key) return;
      try {
        const next = readOperatorNotifications(window.localStorage, key, tenantId);
        itemsRef.current = next;
        setItems(next);
      } catch { /* Ignore unavailable storage. */ }
    };
    window.addEventListener(OPERATOR_EVENT, receive);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(OPERATOR_EVENT, receive);
      window.removeEventListener('storage', storage);
    };
  }, [key, tenantId, tenantSlug, userId, add]);

  useEffect(() => {
    if (!key) return undefined;
    const check = () => add([...appointmentReminders(appointments, tenantId), ...followUpReminders(kanbanColumns, tenantId)]);
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [key, appointments, kanbanColumns, tenantId, add]);

  useEffect(() => {
    if (!key) return undefined;
    const connection = event => add([{ id: `connection:${event.type}:${Date.now()}`, tenantId, kind: 'connection',
      title: event.type === 'offline' ? 'Você está sem conexão' : 'Conexão restabelecida',
      description: event.type === 'offline' ? 'Os novos avisos voltarão a chegar quando a conexão for restabelecida.' : 'Atualize a tela para conferir as últimas mensagens da equipe.',
      category: 'attention', attention: event.type === 'offline', unread: true, createdAt: new Date().toISOString() }]);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => { window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [key, tenantId, add]);

  const markRead = useCallback((id) => {
    const next = itemsRef.current.map(item => !id || item.id === id ? { ...item, unread: false } : item);
    itemsRef.current = next;
    setItems(next);
  }, []);

  return { items, soundSequence, markRead, markAllRead: () => markRead(null) };
}
