const helpers = this.helpers;

const update = $json.body || $json;
const params = $json.params || {};
const query = $json.query || {};
const message = update.message || update.edited_message || update.channel_post || {};
const chat = message.chat || {};
const from = message.from || {};
const chatId = chat.id;
const rawText = String(message.text || '').trim();
const tenantSlug = String(query.tenant_slug || query.tenant || params.tenant_slug || params.tenantSlug || $env.DEFAULT_TENANT_SLUG || 'jiw')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '');
const firstName = from.first_name || chat.first_name || 'tudo bem';
const normalized = rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function env(name, fallback = '') {
  let envValue = '';
  let varsValue = '';
  try {
    envValue = $env[name] || '';
  } catch (error) {}
  try {
    varsValue = $vars?.[name] || '';
  } catch (error) {}
  return envValue || varsValue || fallback;
}

function hasAny(words) {
  return words.some((word) => normalized.includes(word));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function settingsFor(context = {}) {
  return context.settings?.settings || {};
}

function activePromptFor(context = {}) {
  const settings = settingsFor(context);
  return settings.system_prompt || context.promptVersion?.prompt || settings.prompt || settings.ai_prompt || '';
}

function removeMidConversationGreeting(text, hasHistory) {
  if (!hasHistory) return String(text || '').trim();

  const original = String(text || '').trim();
  const cleaned = original
    .replace(
      /^(?:oi|ol├í|ola|oie|bom dia|boa tarde|boa noite)(?:\s*,?\s*(?:linda|querida|meu amor|amor|flor|meu chapa))?[!,.:;\sÔ£¿­ƒÆû­ƒî©ÔÿÇ´©Å­ƒæÖ-]*/i,
      ''
    )
    .trim();

  return cleaned || original;
}

function detectActions(text) {
  const value = String(text || '');
  return {
    humanRequested: /\[HUMANO_SOLICITADO\]/i.test(value),
    complaint: /\[(?:A├ç├âO|ACAO)\s*:\s*RECLAMACAO\]/i.test(value) || /\[RECLAMACAO\]/i.test(value),
    readyToSchedule: /\[(?:A├ç├âO|ACAO)\s*:\s*PRONTO_PARA_AGENDAR\]/i.test(value) || /\[PRONTO_PARA_AGENDAR\]/i.test(value),
  };
}

function cleanReplyText(text) {
  return String(text || '')
    // Tags internas: nunca devem aparecer para o cliente
    .replace(/\[(?:A├ç├âO|ACAO)\s*:\s*[^\]]+\]/gi, '')
    .replace(/\[HUMANO_SOLICITADO\]/gi, '')
    .replace(/\[PRONTO_PARA_AGENDAR\]/gi, '')
    .replace(/\[RECLAMACAO\]/gi, '')

    // Desescapa Markdown que alguns modelos devolvem como "\*\*" / "\-"
    .replace(/\\([*_`~>#\-\[\]()])/g, '$1')

    // Remove Markdown e mant├®m texto leg├¡vel no Telegram sem parse_mode
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, 'ÔÇó ')

    // Limpeza de espa├ºos
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isBotFrustrationText() {
  const value = normalizeText(rawText);
  return [
    'ia burra',
    'ia idiota',
    'bot burro',
    'bot idiota',
    'voce e burra',
    'voce e burro',
    'voc├¬ ├® burra',
    'voc├¬ ├® burro',
    'responde direito',
    'responda direito',
    'nao foi isso',
    'n├úo foi isso',
    'voce nao entendeu',
    'voc├¬ n├úo entendeu',
    'que resposta ruim',
    'que resposta merda',
    'ta burra',
    't├í burra',
    'burra do caralho',
    'burro do caralho',
  ].some((term) => value.includes(normalizeText(term)));
}

function isRealServiceComplaintText() {
  const value = normalizeText(rawText);
  return [
    'reclamacao do atendimento',
    'reclama├º├úo do atendimento',
    'fui mal atendida',
    'fui mal atendido',
    'quero meu dinheiro de volta',
    'dinheiro de volta',
    'estorno',
    'reembolso',
    'procon',
    'ouvidoria',
    'procedimento deu errado',
    'resultado ficou ruim',
    'resultado horrivel',
    'resultado horr├¡vel',
    'me queimou',
    'queimadura',
    'me machucou',
    'machucou minha pele',
    'problema com o procedimento',
    'problema no atendimento',
  ].some((term) => value.includes(normalizeText(term)));
}
function audienceSignals() {
  const value = normalizeText(rawText);

  const selfMaleSignals = [
    'sou homem',
    'sou um homem',
    'sou masculino',
    'sou do sexo masculino',
    'quero fazer em mim',
    'quero fazer pra mim e sou homem',
    'quero fazer para mim e sou homem',
  ];

  const bookingForOtherFemaleSignals = [
    'minha esposa',
    'pra minha esposa',
    'para minha esposa',
    'minha namorada',
    'pra minha namorada',
    'para minha namorada',
    'minha amiga',
    'pra minha amiga',
    'para minha amiga',
    'minha filha',
    'pra minha filha',
    'para minha filha',
    'minha irm├ú',
    'minha irma',
    'pra minha irm├ú',
    'para minha irm├ú',
    'para outra pessoa',
    'pra outra pessoa',
  ];

  const minorSignals = [
    'sou menor',
    'sou menor de idade',
    'tenho 17 anos',
    'tenho 16 anos',
    'tenho 15 anos',
    'tenho 14 anos',
    'tenho 13 anos',
    'tenho 12 anos',
    'ela tem 17 anos',
    'ela tem 16 anos',
    'ela tem 15 anos',
    'ela tem 14 anos',
    'ela tem 13 anos',
    'ela tem 12 anos',
    'minha filha tem 17',
    'minha filha tem 16',
    'minha filha tem 15',
    'minha filha tem 14',
    'minha filha tem 13',
    'minha filha tem 12',
  ];

  return {
    selfMaleExplicit: selfMaleSignals.some((term) => value.includes(normalizeText(term))),
    bookingForOtherFemaleExplicit: bookingForOtherFemaleSignals.some((term) => value.includes(normalizeText(term))),
    minorExplicit: minorSignals.some((term) => value.includes(normalizeText(term))),
  };
}

function explicitAgeFromText() {
  const match = String(rawText || '').match(/\b(?:tenho|tem|idade\s*(?:├®|e)?|com)\s*(\d{1,2})\s*anos?\b/i);
  if (!match) return null;
  const age = Number(match[1]);
  return Number.isFinite(age) ? age : null;
}

function matchKeywords(keywords = []) {
  return asArray(keywords).some((keyword) => normalized.includes(normalizeText(keyword)));
}

function isPureGreeting() {
  const compact = normalized.replace(/[^\w\s/]/g, ' ').replace(/\s+/g, ' ').trim();
  return ['/start', 'oi', 'ola', 'ol├â┬í', 'bom dia', 'boa tarde', 'boa noite', 'teste'].includes(compact);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function httpJson(method, url, headers = {}, payload = null) {
  return await helpers.httpRequest({
    method,
    url,
    headers,
    ...(payload === null ? {} : { body: payload }),
    json: true,
    timeout: 45000,
  });
}

function supabaseHeaders(prefer) {
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function supabaseUrl(pathname) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  if (!base) throw new Error('SUPABASE_URL nao configurada no n8n');
  if (!env('SUPABASE_SERVICE_ROLE_KEY')) throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada no n8n');
  return base + pathname;
}

async function supabaseGet(pathname) {
  return httpJson('GET', supabaseUrl(pathname), supabaseHeaders());
}

async function supabasePost(pathname, payload, prefer = 'return=representation') {
  return httpJson('POST', supabaseUrl(pathname), supabaseHeaders(prefer), payload);
}

function encodeFilter(value) {
  return encodeURIComponent(String(value));
}

async function loadTenantContext() {
  const tenants = await supabaseGet('/rest/v1/tenants?select=*&slug=eq.' + encodeFilter(tenantSlug) + '&limit=1');
  const tenant = Array.isArray(tenants) ? tenants[0] : null;
  if (!tenant) throw new Error('Tenant nao encontrado: ' + tenantSlug);
  if (tenant.status && !['active', 'trial', 'pilot', 'Piloto'].includes(String(tenant.status))) {
    throw new Error('Tenant inativo: ' + tenantSlug);
  }

  const tenantId = tenant.id;
  const [settingsRows, agentRows, promptRows, channelRows] = await Promise.all([
    supabaseGet('/rest/v1/tenant_settings?select=*&tenant_id=eq.' + tenantId + '&limit=1').catch(() => []),
    supabaseGet('/rest/v1/ai_agents?select=*&tenant_id=eq.' + tenantId + '&limit=1').catch(() => []),
    supabaseGet('/rest/v1/ai_prompt_versions?select=*&tenant_id=eq.' + tenantId + '&active=eq.true&order=version.desc&limit=1').catch(() => []),
    supabaseGet('/rest/v1/channels?select=*&tenant_id=eq.' + tenantId + '&type=eq.telegram&limit=1').catch(() => []),
  ]);

  return {
    tenant,
    settings: Array.isArray(settingsRows) ? settingsRows[0] : null,
    agent: Array.isArray(agentRows) ? agentRows[0] : null,
    promptVersion: Array.isArray(promptRows) ? promptRows[0] : null,
    channel: Array.isArray(channelRows) ? channelRows[0] : null,
  };
}

async function loadRecentHistory() {
  if (!chatId) return [];

  const path = '/rest/v1/channel_events?select=direction,sender_type,message_text,response_text,service,stage,handoff,sent_by_user,ai_provider,created_at,external_message_id'
    + '&tenant_slug=eq.' + encodeFilter(tenantSlug)
    + '&channel_type=eq.telegram'
    + '&external_conversation_id=eq.' + encodeFilter(String(chatId))
    + '&order=created_at.desc&limit=30';

  const rows = await supabaseGet(path).catch(() => []);
  if (!Array.isArray(rows)) return [];

  const chronological = rows.reverse();

  // /reset vira um marco: nada anterior a ele entra de novo na mem├│ria.
  let lastResetIndex = -1;
  chronological.forEach((event, index) => {
    const stage = normalizeText(event.stage);
    const provider = normalizeText(event.ai_provider);
    if (stage === 'reset' || provider === 'conversation_reset') {
      lastResetIndex = index;
    }
  });

  const afterReset = lastResetIndex >= 0
    ? chronological.slice(lastResetIndex + 1)
    : chronological;

  // Mant├®m contexto suficiente sem transformar o prompt em um hist├│rico infinito.
  return afterReset.slice(-12);
}

async function alreadyProcessedExternalMessage(externalMessageId) {
  if (!externalMessageId) return false;

  try {
    const path = '/rest/v1/channel_events?select=external_message_id'
      + '&tenant_slug=eq.' + encodeFilter(tenantSlug)
      + '&channel_type=eq.telegram'
      + '&external_conversation_id=eq.' + encodeFilter(String(chatId))
      + '&external_message_id=eq.' + encodeFilter(String(externalMessageId))
      + '&limit=1';

    const rows = await supabaseGet(path);
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    // Deduplica├º├úo nunca pode derrubar o atendimento.
    return false;
  }
}
function eventTime(event) {
  const value = Date.parse(event?.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function isHumanOutbound(event) {
  if (!event || event.direction !== 'outbound') return false;
  const senderType = normalizeText(event.sender_type);
  const sentBy = normalizeText(event.sent_by_user);
  if (['human', 'agent', 'operator', 'atendente'].includes(senderType)) return true;
  return Boolean(event.handoff && sentBy && !sentBy.includes('assistente') && !sentBy.includes('bot') && !sentBy.includes('ia'));
}

function isConversationClosedEvent(event) {
  const stage = normalizeText(event?.stage);
  const service = normalizeText(event?.service);
  const provider = normalizeText(event?.ai_provider);
  return stage === 'finalizado'
    || stage === 'encerrado'
    || service === 'conversation_closed'
    || provider === 'conversation_closed';
}

function historyAfterControlBoundary(history = []) {
  let boundaryIndex = -1;
  history.forEach((event, index) => {
    const stage = normalizeText(event.stage);
    const provider = normalizeText(event.ai_provider);
    if (isConversationClosedEvent(event) || stage === 'reset' || provider === 'conversation_reset') {
      boundaryIndex = index;
    }
  });
  return boundaryIndex >= 0 ? history.slice(boundaryIndex + 1) : history;
}

function conversationControl(history = []) {
  const activeHistory = historyAfterControlBoundary(history);
  const latestHandoff = [...activeHistory].reverse().find((event) => event.direction === 'inbound' && event.handoff === true);
  const latestHumanReply = [...activeHistory].reverse().find(isHumanOutbound);
  const lockEvent = [latestHandoff, latestHumanReply]
    .filter(Boolean)
    .sort((left, right) => eventTime(right) - eventTime(left))[0] || null;

  return {
    activeHistory,
    lockedByHuman: Boolean(lockEvent),
    lockSource: latestHumanReply && eventTime(latestHumanReply) >= eventTime(latestHandoff)
      ? 'human_reply'
      : latestHandoff
        ? 'handoff_requested'
        : null,
    lockEvent,
  };
}

async function loadAppointments(tenantId) {
  if (!tenantId || !chatId) return { rows: [], error: '' };
  const path = '/rest/v1/appointments?select=id,title,starts_at,ends_at,status,external_conversation_id,contact_name,notes,updated_at'
    + '&tenant_id=eq.' + encodeFilter(tenantId)
    + '&external_conversation_id=eq.' + encodeFilter(String(chatId))
    + '&order=starts_at.desc&limit=20';
  try {
    const rows = await supabaseGet(path);
    return { rows: Array.isArray(rows) ? rows : [], error: '' };
  } catch (error) {
    return { rows: [], error: error.message || String(error) };
  }
}

function appointmentState(rows = [], now = Date.now()) {
  const cancelled = new Set(['cancelled', 'canceled', 'cancelado', 'cancelada', 'deleted']);
  const active = new Set(['scheduled', 'confirmed', 'booked', 'reserved', 'rescheduled', 'agendado', 'agendada', 'confirmado', 'confirmada']);
  const normalizedRows = rows
    .map((row) => ({ ...row, startsAtMs: Date.parse(row.starts_at || ''), statusKey: normalizeText(row.status || 'scheduled') }))
    .filter((row) => !cancelled.has(row.statusKey) && Number.isFinite(row.startsAtMs));
  const futureConfirmed = normalizedRows
    .filter((row) => row.startsAtMs > now && active.has(row.statusKey))
    .sort((left, right) => left.startsAtMs - right.startsAtMs)[0] || null;
  const passed = normalizedRows
    .filter((row) => row.startsAtMs <= now)
    .sort((left, right) => right.startsAtMs - left.startsAtMs)[0] || null;

  return {
    rows: normalizedRows,
    futureConfirmed,
    passed,
    hasConfirmed: Boolean(futureConfirmed),
    hasPassed: Boolean(passed),
  };
}

function appointmentDateLabel(appointment) {
  if (!appointment?.starts_at) return 'data nao informada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: env('APP_TIMEZONE', 'America/Sao_Paulo'),
  }).format(new Date(appointment.starts_at));
}

function asksAppointmentStatus() {
  return hasAny([
    'meu agendamento',
    'minha agenda',
    'agendamento confirmado',
    'consulta marcada',
    'horario marcado',
    'esta confirmado',
    'ja confirmei',
    'ja agendei',
    'quando e meu horario',
    'que dia e meu horario',
    'passou meu agendamento',
  ]);
}

function appointmentResponse(state, classification, settings) {
  if (state.futureConfirmed && (classification.stage === 'Agendamento' || asksAppointmentStatus())) {
    const title = state.futureConfirmed.title || 'seu atendimento';
    return `Encontrei ${title} confirmado para ${appointmentDateLabel(state.futureConfirmed)}. Se precisar alterar ou cancelar, me avise para eu encaminhar a equipe.`;
  }
  if (state.passed && (classification.stage === 'Agendamento' || asksAppointmentStatus())) {
    const title = state.passed.title || 'seu atendimento';
    return `O agendamento de ${title}, previsto para ${appointmentDateLabel(state.passed)}, ja passou. Quer que eu encaminhe a equipe para remarcar? [HUMANO_SOLICITADO]`;
  }
  if (asksAppointmentStatus() && !state.rows.length) {
    return `${settings.no_appointment_message || 'Nao encontrei um agendamento confirmado para esta conversa.'} Se quiser, posso encaminhar a equipe para verificar ou marcar um novo horario.`;
  }
  return '';
}

async function loadCatalogContext() {
  const enabled = String(env('TENANT_CATALOG_ENABLED', 'false')).toLowerCase() === 'true';
  if (!enabled || !rawText) return { matches: [], context: '' };
  try {
    const matches = await supabasePost('/rest/v1/rpc/search_tenant_service_catalog', {
      p_tenant_slug: tenantSlug,
      p_query: rawText,
      p_limit: 5,
    });
    const rows = Array.isArray(matches) ? matches : [];
    const context = rows.map((item, index) => {
      const price = item.price === null || item.price === undefined
        ? 'preco sob consulta'
        : 'R$ ' + Number(item.price).toFixed(2).replace('.', ',');
      const unit = item.billing_unit ? ' Unidade: ' + item.billing_unit + '.' : '';
      const notes = item.notes ? ' Observacoes: ' + item.notes + '.' : '';
      return `${index + 1}. ${item.name || 'Item'} (${item.category || 'geral'}): ${item.description || 'sem descricao'}. Valor: ${price}.${unit}${notes}`;
    }).join('\n');
    return { matches: rows, context };
  } catch (error) {
    return { matches: [], context: '', error: error.message || String(error) };
  }
}

function classify(context = {}) {
  const settings = settingsFor(context);
  let service = 'geral';
  let stage = 'Qualificacao';
  let handoff = false;

  const botFrustrationOnly = isBotFrustrationText() && !isRealServiceComplaintText();

  for (const rule of asArray(settings.classification_rules || settings.intent_rules)) {
    if (!matchKeywords(rule.keywords || rule.triggers)) continue;

    const matched = {
      service: rule.service || rule.intent || service,
      stage: rule.stage || stage,
      handoff: Boolean(rule.handoff),
    };

    // "IA burra", "n├úo foi isso", etc. = corrigir a resposta, n├úo abrir reclama├º├úo formal.
    if (botFrustrationOnly) {
      matched.stage = 'Qualificacao';
      matched.handoff = false;
    }

    return matched;
  }

  if (isRealServiceComplaintText()) {
    stage = 'Atendimento humano';
    service = 'reclamacao';
    handoff = true;
  } else if (botFrustrationOnly) {
    stage = 'Qualificacao';
    handoff = false;
  } else if (hasAny(['orcamento complexo', 'proposta comercial', 'contrato'])) {
    stage = 'Orcamento solicitado';
    handoff = true;
  } else if (hasAny(['quanto custa', 'preco', 'precos', 'valor', 'valores', 'tabela'])) {
    // Perguntar pre├ºo ├® uma d├║vida normal; a IA deve responder usando cat├ílogo/prompt.
    stage = 'Tabela de precos';
    handoff = false;
  } else if (hasAny(['humano', 'atendente', 'especialista', 'falar com alguem', 'falar com algu├®m', 'reuniao', 'ligar', 'whatsapp'])) {
    stage = 'Atendimento humano';
    handoff = true;
  } else if (hasAny(['urgente', 'fora do ar', 'parado', 'caiu', 'nao funciona', 'n├úo funciona'])) {
    stage = 'Suporte tecnico';
    handoff = true;
  } else if (hasAny(['agendar', 'agenda', 'consulta', 'horario', 'hor├írio', 'visita', 'marcar'])) {
    stage = 'Agendamento';
  } else if (hasAny(['comprar', 'fechar', 'venda', 'pedido'])) {
    stage = 'Interesse comercial';
  }

  if (hasAny(['sistema', 'software', 'app', 'aplicativo', 'site', 'landing page', 'automacao', 'automa├º├úo', 'integracao', 'integra├º├úo', 'api', 'crm', 'dashboard'])) service = 'software_automacao';
  else if (hasAny(['suporte', 'erro', 'computador', 'notebook', 'internet', 'rede', 'servidor', 'email', 'impressora', 'ti', 'manutencao', 'manuten├º├úo'])) service = 'suporte_ti';
  else if (hasAny(['trafego', 'tr├ífego', 'anuncio', 'an├║ncio', 'google ads', 'meta ads', 'facebook ads', 'campanha', 'leads'])) service = 'trafego_pago';
  else if (hasAny(['social media', 'instagram', 'conteudo', 'conte├║do', 'post', 'reels', 'criativo'])) service = 'social_media';
  else if (hasAny(['consulta', 'clinica', 'cl├¡nica', 'paciente', 'agendamento', 'bronze', 'bronzeamento'])) service = 'agendamento_atendimento';

  return { service, stage, handoff };
}
function fallbackAnswer(context, classification, appointments = appointmentState([])) {
  const tenantName = context.tenant?.name || tenantSlug;
  const settings = settingsFor(context);
  const categories = Array.isArray(settings.service_categories) && settings.service_categories.length
    ? settings.service_categories.join(', ')
    : 'atendimento, vendas, suporte, agendamentos e duvidas sobre a empresa';
  const manualResponse = findManualResponse(settings);
  const appointmentReply = appointmentResponse(appointments, classification, settings);

  if (!rawText || isPureGreeting()) {
    return buildInitialMessage(settings, tenantName, categories);
  }

  if (manualResponse) return manualResponse;

  if (appointmentReply) return appointmentReply;

  if (classification.handoff) {
    return context.settings?.handoff_message
      || settings.handoff_message
      || 'Certo. Para encaminhar corretamente, me envie nome, melhor contato e um resumo do que precisa. Vou sinalizar para uma pessoa da equipe continuar com voce. [HUMANO_SOLICITADO]';
  }

  if (classification.stage === 'Agendamento') return buildAppointmentMessage(settings);

  return context.settings?.fallback_message
    || `Para eu direcionar melhor: sua necessidade esta ligada a ${categories}? Pode me explicar o objetivo principal?`;
}

function buildInitialMessage(settings, tenantName, categories) {
  const greeting = settings.greeting_message || settings.initial_message || `Ola, ${firstName}! Sou o assistente da ${tenantName}.`;
  const options = asArray(settings.menu_options || settings.conversation_options);
  if (!options.length) return `${greeting} Posso ajudar com ${categories}. Me conte em poucas palavras o que voce precisa.`;

  const lines = options.map((option, index) => `${index + 1}. ${option.label || option.title || option.question || option.intent || option}`);
  return `${greeting}\n\n${lines.join('\n')}`;
}

function findManualResponse(settings) {
  const options = asArray(settings.menu_options || settings.conversation_options);
  const manualResponses = [
    ...options,
    ...asArray(settings.manual_responses),
    ...asArray(settings.mock_responses),
    ...asArray(settings.faq),
  ];
  const selectedOption = normalized.match(/^\d+$/) ? Number(normalized) - 1 : -1;

  if (selectedOption >= 0 && options[selectedOption]) {
    return responseFromItem(options[selectedOption]);
  }

  for (const item of manualResponses) {
    if (typeof item === 'string') continue;
    const searchable = [
      item.intent,
      item.label,
      item.title,
      item.question,
      item.category,
      ...asArray(item.keywords),
      ...asArray(item.triggers),
    ].map(normalizeText);

    if (searchable.some((part) => part && normalized.includes(part))) {
      return responseFromItem(item);
    }
  }

  return '';
}

function responseFromItem(item) {
  if (typeof item === 'string') return item;
  return item.answer || item.response || item.text || item.message || '';
}

function buildAppointmentMessage(settings) {
  const fields = asArray(settings.appointment_fields || settings.required_fields);
  if (!fields.length) {
    return 'Consigo ajudar com isso. Me diga qual servico deseja agendar, melhor dia/horario e um telefone de contato para confirmacao.';
  }
  return `Para seguir com o agendamento, me envie:\n${fields.map((field, index) => `${index + 1}. ${field}`).join('\n')}`;
}

function usageGate(context = {}) {
  const settings = settingsFor(context);
  const tenantAiMode = String(settings.ai_mode || '').toLowerCase();
  const hasTenantDisabledAi = settings.ai_enabled === false || String(settings.ai_enabled).toLowerCase() === 'false';
  const forceMock = tenantAiMode === 'mock' || hasTenantDisabledAi;
  const enabled = String(env('GEMINI_ENABLED', 'false')).toLowerCase() === 'true';
  const hasKey = Boolean(env('GEMINI_API_KEY'));
  const dailyLimit = Number(env('GEMINI_DAILY_LIMIT', 50));
  let usedToday = 0;
  try {
    const data = $getWorkflowStaticData('global');
    usedToday = Number(data[`gemini_${tenantSlug}_${todayKey()}`] || 0);
  } catch (error) {}
  return { enabled, hasKey, dailyLimit, usedToday, forceMock, allowed: !forceMock && enabled && hasKey && usedToday < dailyLimit };
}

function markUsage() {
  try {
    const data = $getWorkflowStaticData('global');
    const key = `gemini_${tenantSlug}_${todayKey()}`;
    data[key] = Number(data[key] || 0) + 1;
  } catch (error) {}
}

async function callGemini(context, classification, fallback, history, catalog, appointments) {
  const agent = context.agent || {};
  const settings = settingsFor(context);
  const model = settings.ai_model || agent.model || env('GEMINI_MODEL', 'gemini-2.5-flash-lite');

  const configuredMax = Number(agent.max_tokens || env('GEMINI_MAX_OUTPUT_TOKENS', 900));
  // Evita configura├º├Áes acidentais muito baixas no banco cortarem "Bronze no Sol (" no meio.
  const maxOutputTokens = Math.max(650, Math.min(
    Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 900,
    1400
  ));

  const temperature = Number(agent.temperature || 0.5);

  const basePrompt = activePromptFor(context)
    || `Voc├¬ faz parte da equipe de atendimento da empresa ${context.tenant.name}. Responda com naturalidade, contexto e objetividade.`;

  const hasHistory = history.some((item) =>
    Boolean(item?.message_text || item?.response_text)
  );

  const botFrustrationOnly = isBotFrustrationText() && !isRealServiceComplaintText();
  const audience = audienceSignals();
  const explicitAge = explicitAgeFromText();

  const appointmentContext = JSON.stringify({
    confirmado: appointments?.futureConfirmed ? {
      titulo: appointments.futureConfirmed.title,
      quando: appointmentDateLabel(appointments.futureConfirmed),
    } : null,
    passado: appointments?.passed ? {
      titulo: appointments.passed.title,
      quando: appointmentDateLabel(appointments.passed),
    } : null,
    encontrado: Boolean(appointments?.rows?.length),
  });

  const systemText = `${basePrompt}

CONTEXTO OPERACIONAL:
- Empresa: ${context.tenant.name}
- Segmento: ${context.tenant.industry || 'n├úo informado'}
- Esta conversa j├í come├ºou: ${hasHistory ? 'SIM' : 'N├âO'}
- O cliente est├í frustrado apenas com uma resposta do bot: ${botFrustrationOnly ? 'SIM' : 'N├âO'}
- Homem querendo explicitamente procedimento nele pr├│prio nesta mensagem: ${audience.selfMaleExplicit ? 'SIM' : 'N├âO'}
- Agendamento explicitamente para outra pessoa/mulher nesta mensagem: ${audience.bookingForOtherFemaleExplicit ? 'SIM' : 'N├âO'}
- Menor de idade explicitamente mencionado nesta mensagem: ${(audience.minorExplicit || (explicitAge !== null && explicitAge < 18)) ? 'SIM' : 'N├âO'}
- Idade explicitamente informada nesta mensagem: ${explicitAge === null ? 'N├âO INFORMADA' : explicitAge}
- Classifica├º├úo atual: ${classification.service}
- Etapa sugerida: ${classification.stage}

BASE CONSULTADA:
${catalog.context || 'Nenhum item espec├¡fico foi recuperado para esta mensagem.'}

STATUS DE AGENDAMENTO:
${appointmentContext}

REGRAS DE CONVERSA:
- Responda ├á mensagem atual levando em conta TODO o hist├│rico.
- Se a conversa j├í come├ºou, N├âO reabra com "Oi", "Ol├í", "Bom dia", "Boa tarde", "Boa noite", "linda", "querida", "meu amor", "que bom te ver" ou equivalentes.
- N├úo repita apresenta├º├úo, boas-vindas, elogios ou informa├º├Áes j├í dadas.
- Continue exatamente do ponto em que a conversa parou.
- Se o cliente disser "n├úo sei", N├âO devolva a mesma pergunta. Explique op├º├Áes concretas e ajude a escolher.
- Se o cliente pedir "todos", "todas as op├º├Áes", "me explique cada um", "me d├¬ as op├º├Áes" ou equivalente, ENTREGUE a lista pedida. N├úo pergunte qual quer conhecer primeiro.
- Se o cliente estiver frustrado apenas porque sua resposta anterior foi ruim, reconhe├ºa de forma curta e corrija imediatamente. N├âO trate isso como reclama├º├úo formal da cl├¡nica e N├âO use tag de reclama├º├úo.
- N├úo presuma o g├¬nero do cliente. Voc├¬ pode se expressar como atendente mulher, mas n├úo chame a pessoa de "linda", "querida", "meu amor" ou semelhantes sem contexto.
- Use no m├íximo 1 ou 2 emojis por mensagem.
- Prefira linguagem humana de WhatsApp: direta, curta, espec├¡fica e contextual.
- N├úo invente pre├ºo, disponibilidade, prazo ou garantia.
- Fa├ºa pergunta somente quando ela for realmente necess├íria para avan├ºar.
- Pergunta simples sobre pre├ºo N├âO exige atendimento humano.
- Reclama├º├úo real sobre servi├ºo, procedimento, pagamento ou atendimento pode usar [A├ç├âO: RECLAMACAO].
- Quando todos os dados necess├írios de agendamento estiverem reunidos, pode usar [A├ç├âO: PRONTO_PARA_AGENDAR].
- Se a pessoa pedir explicitamente atendimento humano, use [HUMANO_SOLICITADO].
- Nunca confirme disponibilidade/agendamento sem usar o status de agendamento informado acima.
- N├âO use Markdown. N├úo use **negrito**, _, #, crases ou tabelas Markdown.
- Para listas, use apenas o caractere "ÔÇó" e texto simples.
- Normalmente responda em 1 a 4 frases. Se pedirem v├írias op├º├Áes, pode usar uma lista curta.
- N├úo interrompa uma frase no meio. Entregue a resposta completa.
- M├íximo aproximado de 1600 caracteres.

REGRAS DE NATURALIDADE E CTA:
- N├âO termine toda resposta com pergunta.
- Se a pessoa pediu apenas uma informa├º├úo objetiva, responda e pare.
- N├úo ofere├ºa agendamento repetidamente.
- Se voc├¬ j├í ofereceu agendamento e a pessoa continuou tirando d├║vidas, espere ela demonstrar inten├º├úo de marcar.
- Fa├ºa pergunta apenas quando a resposta for necess├íria para avan├ºar o atendimento.

REGRA "TODOS":
- Quando a pessoa pedir "todos", "todas as op├º├Áes", "todos os bronzeamentos", "me explique todos", "me d├¬ todas as op├º├Áes" ou equivalente, n├úo resuma apenas para os principais.
- Apresente TODAS as op├º├Áes oficiais de bronzeamento dispon├¡veis no contexto/cat├ílogo.
- Se houver variantes, agrupe para ficar leg├¡vel, mas n├úo omita op├º├Áes.
- N├úo invente op├º├úo que n├úo esteja no cat├ílogo ou prompt oficial.

FIDELIDADE AOS DADOS:
- Nunca complete uma informa├º├úo usando conhecimento geral, mesmo que pare├ºa ├│bvia.
- Use somente informa├º├Áes presentes no cat├ílogo oficial, system prompt, configura├º├Áes do tenant ou contexto fornecido pelo sistema.
- Se uma caracter├¡stica n├úo estiver cadastrada, diga apenas o que est├í confirmado.
- N├úo invente t├®cnica, produto utilizado, dura├º├úo, contraindica├º├úo, documenta├º├úo, regra de idade, prazo ou disponibilidade.

REGRAS DE P├ÜBLICO DA CL├ìNICA DA N├ÜBIA:
- Os procedimentos da cl├¡nica s├úo realizados exclusivamente em mulheres.
- Homens podem conversar normalmente, pedir informa├º├Áes, consultar pre├ºos e realizar um agendamento PARA uma mulher, como esposa, namorada, amiga, filha, irm├ú, familiar ou outra pessoa.
- Nunca bloqueie um homem apenas por ele estar conversando com a cl├¡nica.
- Se ficar explicitamente claro que um homem deseja realizar o procedimento nele pr├│prio, explique de forma gentil e direta que os procedimentos s├úo exclusivos para o p├║blico feminino e ofere├ºa ajuda para marcar para outra mulher.
- N├âO presuma g├¬nero pelo nome, username, foto, modo de escrever ou qualquer infer├¬ncia. O nome "Jo├úo", por exemplo, n├úo ├® autoriza├º├úo para concluir nada sozinho.
- S├│ aplique a restri├º├úo de p├║blico quando a pr├│pria conversa deixar claro que o procedimento seria feito em um homem.
- Se a pessoa quiser agendar e ainda n├úo estiver claro para quem ├® o procedimento, pergunte naturalmente: "O agendamento seria para voc├¬ ou para outra pessoa?"
- Se j├í estiver claro para quem ├®, n├úo repita essa pergunta.

MENORES DE IDADE:
- Menores de 18 anos somente podem realizar o atendimento com respons├ível.
- Se a conversa informar explicitamente que a cliente ├® menor de idade, explique essa condi├º├úo antes de concluir o agendamento.
- Estando com respons├ível, o fluxo de agendamento pode continuar normalmente.
- N├úo invente idade m├¡nima al├®m de ser menor de 18 anos, tipo de documento, autoriza├º├úo escrita, grau de parentesco ou outra exig├¬ncia que n├úo esteja cadastrada.
- Se um homem estiver marcando para uma menor de idade, as duas regras continuam v├ílidas: o procedimento ├® para uma cliente mulher e a menor precisa estar com respons├ível.

AGENDAMENTO E VERDADE OPERACIONAL:
- N├úo diga que est├í "consultando a agenda" se este workflow n├úo estiver consultando disponibilidade naquele momento.
- Quando nome, servi├ºo, dia e per├¡odo estiverem completos, confirme apenas os dados recebidos e diga que ir├í encaminhar para a equipe confirmar a disponibilidade e finalizar o agendamento.
- Evite duas mensagens dizendo a mesma coisa.
- Exemplo de fechamento: "Perfeito, Jo├úo! J├í anotei Bronze a Jato corpo todo para o dia 22 pela manh├ú. Vou encaminhar para a equipe confirmar a disponibilidade e finalizar o agendamento. ­ƒÆû"`;

  const contents = [];

  for (const item of history) {
    if (item.direction === 'inbound' && item.message_text) {
      contents.push({
        role: 'user',
        parts: [{ text: String(item.message_text) }],
      });
    }

    if (item.response_text) {
      contents.push({
        role: 'model',
        parts: [{ text: cleanReplyText(String(item.response_text)) }],
      });
    }

    if (item.direction === 'outbound' && item.message_text) {
      contents.push({
        role: 'model',
        parts: [{ text: cleanReplyText(String(item.message_text)) }],
      });
    }
  }

  contents.push({
    role: 'user',
    parts: [{ text: rawText }],
  });

  async function generate(tokenLimit, retryInstruction = '') {
    const body = await httpJson(
      'POST',
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        'Content-Type': 'application/json',
        'x-goog-api-key': env('GEMINI_API_KEY'),
      },
      {
        system_instruction: {
          parts: [{
            text: systemText + retryInstruction,
          }],
        },
        contents,
        generationConfig: {
          temperature,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: tokenLimit,
          candidateCount: 1,
        },
      },
    );

    const candidate = body?.candidates?.[0] || {};
    const text = candidate?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || '';

    return {
      body,
      text,
      finishReason: String(candidate.finishReason || ''),
    };
  }

  let generated = await generate(maxOutputTokens);
  let retriedForTruncation = false;

  const suspiciousEnding = (value) => {
    const text = String(value || '').trim();
    if (!text) return true;
    return /(?:\(|\[|\{|:|,|;|\\|\*\*|-)\s*$/.test(text);
  };

  if (
    generated.finishReason.toUpperCase() === 'MAX_TOKENS'
    || suspiciousEnding(generated.text)
  ) {
    retriedForTruncation = true;
    generated = await generate(
      Math.min(Math.max(maxOutputTokens * 2, 1200), 2000),
      '\n\nIMPORTANTE NESTA TENTATIVA: a resposta anterior foi cortada. Responda novamente desde o in├¡cio, de forma completa, concisa e sem Markdown.'
    );
  }

  if (!generated.text) {
    throw new Error('Gemini sem texto de resposta');
  }

  return {
    text: removeMidConversationGreeting(generated.text, hasHistory),
    usage: {
      ...(generated.body?.usageMetadata || {}),
      finish_reason: generated.finishReason,
      retried_for_truncation: retriedForTruncation,
      output_chars: generated.text.length,
    },
    model,
  };
}
async function saveEvent(event) {
  const saved = await supabasePost('/rest/v1/channel_events', event, 'return=representation');
  return Array.isArray(saved) ? saved[0] : saved;
}

if (!tenantSlug) return { json: { ok: false, error: 'missing_tenant_slug' } };
if (!chatId) return { json: { ok: false, error: 'missing_chat_id' } };

try {
  const context = await loadTenantContext();
  const contactName = [from.first_name, from.last_name].filter(Boolean).join(' ') || chat.title || 'Contato Telegram';
  const externalConversationId = String(chatId);
  const externalMessageId = message.message_id ? String(message.message_id) : `${chatId}:${Date.now()}`;

  // Telegram pode reenviar update em algumas situa├º├Áes. N├úo responda duas vezes ao mesmo message_id.
  if (message.message_id && await alreadyProcessedExternalMessage(externalMessageId)) {
    return {
      json: {
        ok: true,
        skipped: true,
        reason: 'duplicate_telegram_message',
        chat_id: chatId,
        skip_response: true,
        telegram_response: {
          method: 'noop',
          chat_id: chatId,
          text: '',
        },
      },
    };
  }

  const controlHistory = await loadRecentHistory();

  // Controle de handoff/encerramento olha uma janela grande.
  // O Gemini recebe apenas os 12 eventos mais recentes apos a ultima fronteira.
  const history = historyAfterControlBoundary(controlHistory).slice(-12);

  // Reset expl├¡cito da mem├│ria desta conversa.
  if (normalized === '/reset' || normalized === 'reset') {
    const resetText = 'Conversa reiniciada Ô£¿ Pode mandar sua pr├│xima mensagem que come├ºamos do zero.';

    const resetEvent = {
      tenant_slug: tenantSlug,
      channel_type: 'telegram',
      external_conversation_id: externalConversationId,
      external_message_id: externalMessageId,
      direction: 'inbound',
      sender_type: 'contact',
      contact_name: contactName,
      contact_handle: from.username || '',
      message_text: rawText,
      service: 'geral',
      stage: 'Reset',
      handoff: false,
      response_text: resetText,
      ai_provider: 'conversation_reset',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      raw_payload: {
        telegram_update: update,
        reset: true,
      },
    };

    await saveEvent(resetEvent);

    return {
      json: {
        ok: true,
        ...resetEvent,
        chat_id: chatId,
        telegram_response: {
          method: 'sendMessage',
          chat_id: chatId,
          text: resetText,
          disable_web_page_preview: true,
        },
      },
    };
  }

  const classification = classify(context);
  const appointmentResult = await loadAppointments(context.tenant.id);
  const appointments = appointmentState(appointmentResult.rows);
  const control = conversationControl(controlHistory);

  if (control.lockedByHuman) {
    const lockedEvent = {
      tenant_slug: tenantSlug,
      channel_type: 'telegram',
      external_conversation_id: externalConversationId,
      external_message_id: externalMessageId,
      direction: 'inbound',
      sender_type: 'contact',
      contact_name: contactName,
      contact_handle: from.username || '',
      message_text: rawText,
      service: 'atendimento_humano',
      stage: 'Atendimento humano',
      handoff: true,
      response_text: null,
      ai_provider: 'human_lock',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      raw_payload: {
        telegram_update: update,
        human_lock_source: control.lockSource,
        appointment_state: {
          has_confirmed: appointments.hasConfirmed,
          has_passed: appointments.hasPassed,
        },
      },
    };
    await saveEvent(lockedEvent);
    return {
      json: {
        ok: true,
        ...lockedEvent,
        chat_id: chatId,
        skip_response: true,
        human_lock: true,
        telegram_response: {
          method: 'noop',
          chat_id: chatId,
          text: '',
        },
      },
    };
  }

  const catalog = await loadCatalogContext();
  const fallback = fallbackAnswer(context, classification, appointments);
  const gate = usageGate(context);

  let responseText = fallback;
  let aiProvider = 'fallback_rules';
  let aiModel = env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
  let aiError = '';
  let aiUsage = {};

  if (rawText && gate.allowed) {
    try {
      const gemini = await callGemini(context, classification, fallback, history, catalog, appointments);
      responseText = gemini.text;
      aiProvider = 'gemini';
      aiModel = gemini.model;
      aiUsage = gemini.usage;
      markUsage();
    } catch (error) {
      aiProvider = 'fallback_gemini_error';
      aiError = error.message || String(error);
    }
  } else if (gate.forceMock) {
    aiProvider = 'mock_rules';
  } else if (!gate.enabled) {
    aiProvider = 'fallback_gemini_disabled';
  } else if (!gate.hasKey) {
    aiProvider = 'fallback_no_gemini_key';
  } else if (gate.usedToday >= gate.dailyLimit) {
    aiProvider = 'fallback_daily_limit';
  }

  const actions = detectActions(responseText);
  const botFrustrationOnly = isBotFrustrationText() && !isRealServiceComplaintText();
  const complaintHandoff = actions.complaint && !botFrustrationOnly;
  const readyToSchedule = actions.readyToSchedule;

  let handoff = Boolean(
    classification.handoff
    || actions.humanRequested
    || complaintHandoff
    || readyToSchedule
  );

  // Xingamento/frustra├º├úo com a resposta da IA n├úo ├® reclama├º├úo formal da cl├¡nica.
  if (botFrustrationOnly && !actions.humanRequested && !isRealServiceComplaintText()) {
    handoff = false;
  }

  let visibleResponse = cleanReplyText(responseText);

  if (handoff) {
    const normalizedVisible = normalizeText(visibleResponse);
    const alreadyMentionsTeamForwarding = [
      'vou encaminhar',
      'vou passar para a equipe',
      'vou enviar para a equipe',
      'equipe confirmar',
      'equipe vai confirmar',
      'confirmar a disponibilidade',
      'finalizar o agendamento',
    ].some((term) => normalizedVisible.includes(normalizeText(term)));

    if (!alreadyMentionsTeamForwarding) {
      const teamNotice = readyToSchedule
        ? 'Vou encaminhar essas informa├º├Áes para a equipe confirmar a disponibilidade e finalizar o agendamento.'
        : 'Vou encaminhar isso para a equipe continuar com voc├¬.';

      visibleResponse = `${visibleResponse}\n\n${teamNotice}`.trim();
    }
  }

  const cleanResponse = removeMidConversationGreeting(
    cleanReplyText(visibleResponse),
    history.length > 0
  );

  const event = {
    tenant_slug: tenantSlug,
    channel_type: 'telegram',
    external_conversation_id: externalConversationId,
    external_message_id: externalMessageId,
    direction: 'inbound',
    sender_type: 'contact',
    contact_name: contactName,
    contact_handle: from.username || '',
    message_text: rawText,
    service: classification.service,
    stage: complaintHandoff
      ? 'Atendimento humano'
      : readyToSchedule
        ? 'Agendamento'
        : classification.stage,
    handoff,
    response_text: cleanResponse,
    ai_provider: aiProvider,
    ai_model: aiModel,
    ai_error: aiError,
    ai_usage: aiUsage,
    catalog_matches: catalog.matches || [],
    catalog_error: catalog.error || '',
    gemini_daily_limit: gate.dailyLimit,
    gemini_used_today_before_request: gate.usedToday,
    raw_payload: {
      telegram_update: update,
      appointment_state: {
        has_confirmed: appointments.hasConfirmed,
        has_passed: appointments.hasPassed,
        confirmed: appointments.futureConfirmed ? {
          id: appointments.futureConfirmed.id,
          title: appointments.futureConfirmed.title,
          starts_at: appointments.futureConfirmed.starts_at,
        } : null,
        passed: appointments.passed ? {
          id: appointments.passed.id,
          title: appointments.passed.title,
          starts_at: appointments.passed.starts_at,
        } : null,
      },
      appointment_lookup_error: appointmentResult.error || '',
      internal_actions: {
        human_requested: actions.humanRequested,
        complaint: actions.complaint,
        complaint_handoff: complaintHandoff,
        ready_to_schedule: readyToSchedule,
        bot_frustration_only: botFrustrationOnly,
        audience: audienceSignals(),
        explicit_age: explicitAgeFromText(),
      },
    },
  };
  await saveEvent(event);

  return {
    json: {
      ok: true,
      ...event,
      chat_id: chatId,
      telegram_response: {
        method: 'sendMessage',
        chat_id: chatId,
        text: cleanResponse,
        disable_web_page_preview: true,
      },
    },
  };
} catch (error) {
  const messageText = 'Nao consegui processar sua mensagem agora. Vou sinalizar para a equipe verificar o atendimento.';
  return {
    json: {
      ok: false,
      tenant_slug: tenantSlug,
      channel_type: 'telegram',
      chat_id: chatId,
      error: error.message || String(error),
      telegram_response: {
        method: 'sendMessage',
        chat_id: chatId,
        text: messageText,
        disable_web_page_preview: true,
      },
    },
  };
}

