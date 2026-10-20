import readXlsxFile from 'read-excel-file/browser';
import { normalizeExternalConversationId } from '../../../services/identity/conversationIdentity.js';

export const SUPPORTED_CONTACT_FORMATS = '.csv, .tsv, .txt, .json, .vcf, .html, .xlsx, .xlsm, .ods';

async function readText(file) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  // Planilhas exportadas pelo Excel em português costumam vir em Windows-1252.
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buffer) : utf8.replace(/^\uFEFF/, '');
}

export async function parseContactFile(file) {
  const lowerName = file.name.toLowerCase();
  const ext = lowerName.includes('.') ? lowerName.split('.').pop() : '';
  if (ext === 'xls') {
    throw new Error('Arquivo .xls (formato antigo) não é suportado. Salve como .xlsx ou .csv e tente de novo.');
  }
  if (['xlsx', 'xlsm'].includes(ext)) return rowsToObjects(await readXlsxFile(file));
  if (ext === 'ods') return rowsToObjects(await readOdsRows(file));
  if (ext === 'json') return parseJsonContacts(await readText(file));
  if (['vcf', 'vcard'].includes(ext)) return parseVCardContacts(await readText(file));
  if (['html', 'htm'].includes(ext)) return parseHtmlTableContacts(await readText(file));
  // csv, tsv, txt e qualquer outro texto puro
  const text = await readText(file);
  if (text.includes('BEGIN:VCARD')) return parseVCardContacts(text);
  return parseDelimitedContacts(text);
}

function detectDelimiter(text) {
  const firstLines = text.split(/\r?\n/).filter(Boolean).slice(0, 5).join('\n');
  const counts = ['\t', ';', ',', '|'].map((delimiter) => [delimiter, firstLines.split(delimiter).length - 1]);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

// Leitor de CSV com aspas, aspas escapadas e quebras de linha dentro do campo.
export function parseDelimitedContacts(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rowsToObjects(rows);
}

export function parseJsonContacts(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data?.contacts) ? data.contacts : Array.isArray(data?.contatos) ? data.contatos : null;
  if (!list) throw new Error('O JSON precisa ser uma lista de contatos (ou um objeto com "contacts").');
  return list.map((item) => (item && typeof item === 'object' ? item : { telefone: String(item) }));
}

export function parseVCardContacts(text) {
  return text.split(/BEGIN:VCARD/i).slice(1).map((card) => {
    const lines = card.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const field = (name) => lines.find((line) => new RegExp(`^${name}[;:]`, 'i').test(line));
    const value = (line) => (line ? line.slice(line.indexOf(':') + 1).trim() : '');
    const name = value(field('FN')) || value(field('N')).split(';').filter(Boolean).reverse().join(' ');
    return { nome: name, telefone: value(field('TEL')), email: value(field('EMAIL')) };
  }).filter((item) => item.telefone || item.email);
}

export function parseHtmlTableContacts(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const table = doc.querySelector('table');
  if (!table) throw new Error('Nenhuma tabela encontrada no arquivo HTML.');
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => cell.textContent.trim()));
  return rowsToObjects(rows.filter((row) => row.some(Boolean)));
}

// ODS é um zip com content.xml; a descompressão usa a API nativa do navegador.
async function readOdsRows(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Arquivo .ods inválido.');
  let offset = view.getUint32(end + 16, true);
  const entries = view.getUint16(end + 10, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < entries; i += 1) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== 'content.xml') continue;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.slice(dataStart, dataStart + compressedSize);
    let xmlBytes = raw;
    if (method === 8) {
      xmlBytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    const xml = new DOMParser().parseFromString(decoder.decode(xmlBytes), 'application/xml');
    const table = xml.getElementsByTagNameNS('*', 'table')[0];
    if (!table) break;
    const rows = [];
    for (const tr of Array.from(table.getElementsByTagNameNS('*', 'table-row'))) {
      const cells = [];
      for (const td of Array.from(tr.getElementsByTagNameNS('*', 'table-cell'))) {
        const repeat = Math.min(Number(td.getAttribute('table:number-columns-repeated') || 1), 50);
        const text = td.textContent.trim();
        for (let r = 0; r < repeat; r += 1) cells.push(text);
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
    return rows;
  }
  throw new Error('Não foi possível ler a planilha .ods.');
}

const PHONE_LIKE = /^[+(]?\d[\d\s().-]{7,}$/;

// Lista sem cabeçalho (só números, ou nome + número) também é aceita.
function looksLikeHeader(row) {
  return row.some((cell) => /\p{L}/u.test(cell)) && !row.some((cell) => PHONE_LIKE.test(cell));
}

export function rowsToObjects(rows) {
  const clean = rows.map((row) => row.map((cell) => String(cell ?? '').trim())).filter((row) => row.some(Boolean));
  if (!clean.length) return [];
  if (!looksLikeHeader(clean[0])) {
    return clean.map((row) => {
      const phoneIndex = row.findIndex((cell) => PHONE_LIKE.test(cell));
      const nameCell = row.find((cell, index) => index !== phoneIndex && /\p{L}/u.test(cell));
      return { nome: nameCell || '', telefone: phoneIndex >= 0 ? row[phoneIndex] : row[0] };
    });
  }
  const headers = clean[0].map((header) => String(header || '').trim());
  return clean.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header || `coluna_${index + 1}`] = row[index] ?? '';
    });
    return item;
  });
}

// Planilhas costumam trazer o número só com DDD ("(21) 98888-0000"). Sem o 55 o
// WhatsApp recebe um JID inexistente. Com "+" explícito o número é internacional
// e fica como está; sem "+", 10 ou 11 dígitos são tratados como número brasileiro.
function withBrazilianCountryCode(channelType, value) {
  if (String(channelType).toLowerCase() !== 'whatsapp') return value;
  const raw = String(value || '').trim();
  if (!raw || raw.includes('@') || raw.startsWith('+')) return value;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : value;
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
    'celular',
    'whatsapp',
    'numero',
    'fone',
    'tel',
    'mobile',
    'id',
  );
  const channelType = (lookup('canal', 'channel', 'channel_type') || defaultChannel).toLowerCase();
  const normalizedId = normalizeExternalConversationId(channelType, withBrazilianCountryCode(channelType, externalConversationId));
  return {
    name: lookup('nome', 'name', 'contato', 'cliente') || 'Contato',
    channelType,
    externalConversationId: normalizedId,
    phone: lookup('telefone', 'phone', 'whatsapp', 'celular', 'numero', 'fone', 'tel', 'mobile'),
    email: lookup('email', 'e-mail'),
    source: 'import',
    key: contactKey({ channelType, externalConversationId: normalizedId }),
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
