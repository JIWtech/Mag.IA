import readXlsxFile from 'read-excel-file/browser';

export async function parseContactFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xls')) {
    throw new Error('Arquivo .xls legado nao e suportado. Salve como .xlsx ou CSV.');
  }
  if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
    return parseDelimitedContacts(await file.text());
  }
  const rows = await readXlsxFile(file);
  return rowsToObjects(rows);
}

export function parseDelimitedContacts(text) {
  const delimiter = text.includes(';') ? ';' : ',';
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  return rowsToObjects(rows);
}

export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header || `coluna_${index + 1}`] = row[index] ?? '';
    });
    return item;
  });
}

export function normalizeImportedContact(row, defaultChannel = 'telegram') {
  const lookup = (...keys) => {
    for (const key of keys) {
      const match = Object.keys(row).find((item) => normalizeKey(item) === normalizeKey(key));
      if (match && row[match] !== undefined && row[match] !== '') return String(row[match]).trim();
    }
    return '';
  };
  const externalConversationId = lookup(
    'chat_id',
    'telegram_id',
    'id_telegram',
    'external_conversation_id',
    'id_conversa',
    'conversation_id',
    'telefone',
    'phone',
  );
  return {
    name: lookup('nome', 'name', 'contato', 'cliente') || 'Contato',
    channelType: lookup('canal', 'channel', 'channel_type') || defaultChannel,
    externalConversationId,
    phone: lookup('telefone', 'phone', 'whatsapp'),
    email: lookup('email', 'e-mail'),
    source: 'import',
    key: contactKey({ channelType: lookup('canal', 'channel', 'channel_type') || defaultChannel, externalConversationId }),
  };
}

export function conversationToBroadcastContact(conversation) {
  return {
    name: conversation.contact,
    channelType: conversation.channelType || 'telegram',
    externalConversationId: conversation.externalConversationId,
    source: 'conversation',
    avatarUrl: conversation.avatarUrl || null,
    metadata: { stage: conversation.stage, status: conversation.status },
    key: contactKey({ channelType: conversation.channelType || 'telegram', externalConversationId: conversation.externalConversationId }),
  };
}

export function contactKey(contact) {
  return `${contact.channel_type || contact.channelType || 'telegram'}:${contact.external_conversation_id || contact.externalConversationId || contact.id || ''}`;
}

export function mergeBroadcastContacts(...groups) {
  const byKey = new Map();
  groups.flat().filter(Boolean).forEach((contact) => {
    const normalized = {
      ...contact,
      channelType: contact.channelType || contact.channel_type || 'telegram',
      externalConversationId: contact.externalConversationId || contact.external_conversation_id || '',
      key: contact.key || contactKey(contact),
    };
    if (normalized.externalConversationId) byKey.set(normalized.key, normalized);
  });
  return Array.from(byKey.values());
}

export function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function displayContactPhone(contact) {
  const raw = String(contact?.phone || contact?.external_conversation_id || contact?.externalConversationId || '').trim();
  if (!raw) return 'Telefone não informado';
  const value = raw.replace(/@(s\.whatsapp\.net|c\.us|g\.us|telegram|instagram)\b.*$/i, '');
  const digits = value.replace(/\D/g, '');
  if (/^55\d{11}$/.test(digits)) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return value;
}

export function displayContactName(contact) {
  const name = String(contact?.display_name || contact?.displayName || contact?.name || contact?.contact_name || '').trim();
  return name && !/@(s\.whatsapp\.net|c\.us|g\.us)\b/i.test(name) ? name : displayContactPhone(contact);
}
