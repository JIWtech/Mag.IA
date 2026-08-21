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
const requestId = `${tenantSlug || 'unknown'}:telegram:${Date.now()}`;
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
  return context.promptVersion?.prompt || settings.system_prompt || settings.prompt || settings.ai_prompt || '';
}

function matchKeywords(keywords = []) {
  return asArray(keywords).some((keyword) => normalized.includes(normalizeText(keyword)));
}

function isPureGreeting() {
  const compact = normalized.replace(/[^\w\s/]/g, ' ').replace(/\s+/g, ' ').trim();
  return ['/start', 'oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'teste'].includes(compact);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function httpJson(method, url, headers = {}, payload = null, options = {}) {
  return await helpers.httpRequest({
    method,
    url,
    headers,
    ...(payload === null ? {} : { body: payload }),
    json: true,
    timeout: Number(options.timeout || 15000),
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
    supabaseGet('/rest/v1/tenant_settings?select=*&tenant_id=eq.' + tenantId + '&limit=1'),
    supabaseGet('/rest/v1/ai_agents?select=*&tenant_id=eq.' + tenantId + '&limit=1'),
    supabaseGet('/rest/v1/ai_prompt_versions?select=*&tenant_id=eq.' + tenantId + '&active=eq.true&order=version.desc&limit=1'),
    supabaseGet('/rest/v1/channels?select=*&tenant_id=eq.' + tenantId + '&type=eq.telegram&limit=1'),
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
  if (!chatId) return { rows: [], error: '' };
  const path = '/rest/v1/channel_events?select=direction,sender_type,sent_by_user,message_text,response_text,service,stage,handoff,raw_payload,created_at'
    + '&tenant_slug=eq.' + encodeFilter(tenantSlug)
    + '&channel_type=eq.telegram'
    + '&external_conversation_id=eq.' + encodeFilter(String(chatId))
    + '&order=created_at.desc&limit=8';
  try {
    const rows = await supabaseGet(path);
    return { rows: Array.isArray(rows) ? rows.reverse() : [], error: '' };
  } catch (error) {
    return { rows: [], error: error.message || String(error) };
  }
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

function defaultConversationState(history = []) {
  const latestState = [...history].reverse().find((item) => item.raw_payload?.agent_state)?.raw_payload?.agent_state || {};
  const latest = history[history.length - 1] || {};
  return {
    saudacao_enviada: history.length > 0,
    nome_cliente: latestState.customer_name || latestState.nome_cliente || null,
    servico: latestState.service || latestState.servico || latest.service || null,
    dia: latestState.date || latestState.dia || null,
    periodo: latestState.period || latestState.periodo || null,
    agendamento_em_andamento: Boolean(latestState.ready_to_schedule || latestState.agendamento_em_andamento || latest.stage === 'Agendamento'),
    ultima_pergunta: latest.response_text || latestState.last_question || latestState.ultima_pergunta || null,
  };
}

function mergeConversationState(previousState, structured = {}) {
  return {
    ...previousState,
    nome_cliente: structured.customer_name || previousState.nome_cliente || null,
    servico: structured.service || previousState.servico || null,
    dia: structured.date || previousState.dia || null,
    periodo: structured.period || previousState.periodo || null,
    agendamento_em_andamento: Boolean(structured.intent === 'scheduling' || structured.ready_to_schedule || previousState.agendamento_em_andamento),
    ultima_pergunta: structured.reply || previousState.ultima_pergunta || null,
  };
}

function classify(context = {}) {
  const settings = settingsFor(context);
  let service = 'geral';
  let stage = 'Qualificacao';
  let handoff = false;

  for (const rule of asArray(settings.classification_rules || settings.intent_rules)) {
    if (!matchKeywords(rule.keywords || rule.triggers)) continue;
    return {
      service: rule.service || rule.intent || service,
      stage: rule.stage || stage,
      handoff: Boolean(rule.handoff),
    };
  }

  if (hasAny(['orcamento', 'proposta', 'contrato', 'quanto custa', 'preco', 'valor'])) {
    stage = 'Orcamento solicitado';
    handoff = true;
  } else if (hasAny(['humano', 'atendente', 'especialista', 'reuniao', 'ligar', 'whatsapp'])) {
    stage = 'Atendimento humano';
    handoff = true;
  } else if (hasAny(['urgente', 'fora do ar', 'parado', 'caiu', 'nao funciona', 'não funciona'])) {
    stage = 'Suporte tecnico';
    handoff = true;
  } else if (hasAny(['agendar', 'agenda', 'consulta', 'horario', 'visita', 'marcar'])) {
    stage = 'Agendamento';
  } else if (hasAny(['comprar', 'fechar', 'venda', 'pedido'])) {
    stage = 'Interesse comercial';
  }

  if (hasAny(['sistema', 'software', 'app', 'aplicativo', 'site', 'landing page', 'automacao', 'automação', 'integracao', 'integração', 'api', 'crm', 'dashboard'])) service = 'software_automacao';
  else if (hasAny(['suporte', 'erro', 'computador', 'notebook', 'internet', 'rede', 'servidor', 'email', 'impressora', 'ti', 'manutencao', 'manutenção'])) service = 'suporte_ti';
  else if (hasAny(['trafego', 'tráfego', 'anuncio', 'anúncio', 'google ads', 'meta ads', 'facebook ads', 'campanha', 'leads'])) service = 'trafego_pago';
  else if (hasAny(['social media', 'instagram', 'conteudo', 'conteúdo', 'post', 'reels', 'criativo'])) service = 'social_media';
  else if (hasAny(['consulta', 'clinica', 'clínica', 'paciente', 'agendamento'])) service = 'agendamento_atendimento';

  return { service, stage, handoff };
}

function fallbackAnswer(context, classification) {
  const tenantName = context.tenant?.name || tenantSlug;
  const settings = settingsFor(context);
  const categories = Array.isArray(settings.service_categories) && settings.service_categories.length
    ? settings.service_categories.join(', ')
    : 'atendimento, vendas, suporte, agendamentos e duvidas sobre a empresa';
  const manualResponse = findManualResponse(settings);

  if (!rawText || isPureGreeting()) {
    return buildInitialMessage(settings, tenantName, categories);
  }

  if (manualResponse) return manualResponse;

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

function asksForPrice() {
  return hasAny(['valor', 'preco', 'preço', 'quanto custa', 'custa', 'tabela', 'orçamento', 'orcamento']);
}

function normalizeServiceKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function servicePrice(settings, service) {
  const prices = settings.service_prices || settings.prices || {};
  const key = normalizeServiceKey(service);
  const direct = prices[service] ?? prices[key];
  if (direct !== undefined) return direct;

  for (const [candidateKey, candidateValue] of Object.entries(prices)) {
    if (normalizeServiceKey(candidateKey) === key) return candidateValue;
  }
  return null;
}

function formatPrice(value) {
  const amount = typeof value === 'object' && value !== null ? value.price : value;
  const number = Number(amount);
  if (!Number.isFinite(number)) return String(amount || '');
  return 'R$ ' + number.toFixed(2).replace('.', ',');
}

function serviceLabel(settings, service) {
  const prices = settings.service_prices || settings.prices || {};
  const entry = prices[service] || prices[normalizeServiceKey(service)];
  if (entry && typeof entry === 'object' && entry.label) return entry.label;
  return String(service || '').replace(/_/g, ' ');
}

function applyPricingGuard(reply, structured, settings) {
  if (!structured?.service || !asksForPrice()) return reply;
  const price = servicePrice(settings, structured.service);
  if (price === null || price === undefined || price === '') return reply;
  return `${serviceLabel(settings, structured.service)} fica ${formatPrice(price)}. Quer garantir seu horario?`;
}

const AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['greeting', 'service_info', 'pricing', 'scheduling', 'complaint', 'handoff', 'out_of_scope', 'other'],
    },
    reply: { type: 'string' },
    service: { type: ['string', 'null'] },
    customer_name: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    period: { type: ['string', 'null'], enum: ['manha', 'tarde', 'noite', 'indiferente', null] },
    ready_to_schedule: { type: 'boolean' },
    handoff: { type: 'boolean' },
    action_tag: { type: ['string', 'null'], enum: ['PRONTO_PARA_AGENDAR', 'RECLAMACAO', 'HUMANO_SOLICITADO', null] },
  },
  required: ['intent', 'reply', 'service', 'customer_name', 'date', 'period', 'ready_to_schedule', 'handoff', 'action_tag'],
};

function usageGate(context = {}) {
  const settings = settingsFor(context);
  const tenantAiMode = String(settings.ai_mode || '').toLowerCase();
  const hasTenantDisabledAi = settings.ai_enabled === false || String(settings.ai_enabled).toLowerCase() === 'false';
  const forceMock = tenantAiMode === 'mock' || hasTenantDisabledAi;
  const enabled = String(env('GEMINI_ENABLED', 'false')).toLowerCase() === 'true';
  const hasKey = Boolean(env('GEMINI_API_KEY'));
  const dailyLimit = Number(env('GEMINI_DAILY_LIMIT', 20));
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

async function callGemini(context, classification, fallback, history, catalog) {
  const settings = settingsFor(context);
  const agent = context.agent || {};
  const model = settings.ai_model || agent.model || env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
  const maxOutputTokens = Math.min(Number(agent.max_tokens || env('GEMINI_MAX_OUTPUT_TOKENS', 300)), 500);
  const temperature = Number(agent.temperature || 0.65);
  const basePrompt = activePromptFor(context)
    || `Voce e o assistente virtual da empresa ${context.tenant.name}. Seu papel e entender a necessidade do contato, responder com clareza, qualificar oportunidades e solicitar atendimento humano quando necessario.`;
  const conversationState = defaultConversationState(history);
  const recentHistory = history.length
    ? history.map((item) => {
      const actor = item.direction === 'outbound' ? 'Assistente/equipe' : 'Cliente';
      return `${actor}: ${item.message_text || item.response_text || ''}`;
    }).join('\n')
    : 'Sem historico recente.';

  const prompt = `${basePrompt}

Empresa/tenant: ${context.tenant.name}
Segmento: ${context.tenant.industry || 'nao informado'}

Base consultada:
${catalog.context || 'Nenhum item especifico encontrado para esta mensagem.'}

Configuracao manual do tenant:
${JSON.stringify({
  service_categories: settings.service_categories || [],
  menu_options: settings.menu_options || settings.conversation_options || [],
  manual_responses: settings.manual_responses || settings.faq || [],
  service_prices: settings.service_prices || settings.prices || {},
  appointment_fields: settings.appointment_fields || settings.required_fields || [],
  handoff_rules: settings.handoff_rules || [],
}).slice(0, 3000)}

Estado atual da conversa:
${JSON.stringify(conversationState)}

Historico recente:
${recentHistory}

Mensagem atual de ${firstName}:
${rawText}

Classificacao previa: ${classification.service}
Etapa sugerida: ${classification.stage}
Resposta fallback se a IA nao conseguir melhorar: ${fallback}

Regras:
- Responda em portugues do Brasil.
- Seja natural, consultivo e direto.
- Nao repita exatamente respostas anteriores do historico.
- Nao invente preco, prazo fechado, disponibilidade ou garantia.
- Faca no maximo 2 ou 3 perguntas por resposta.
- Se houver pedido de orcamento, urgencia ou humano, inclua [HUMANO_SOLICITADO].
- Maximo de 900 caracteres.
- Retorne somente JSON valido no schema solicitado.
- Use o campo reply para a mensagem que sera enviada a cliente.
- Se a cliente responder "sim", "isso", "pode ser" ou similar, use o estado da conversa para continuar o fluxo anterior, sem reiniciar explicacoes.

Schema obrigatorio da resposta:
{
  "intent": "greeting|service_info|pricing|scheduling|complaint|handoff|out_of_scope|other",
  "reply": "mensagem curta para enviar a cliente",
  "service": "servico_identificado_ou_null",
  "customer_name": "nome_ou_null",
  "date": "data_ou_null",
  "period": "manha|tarde|noite|indiferente|null",
  "ready_to_schedule": false,
  "handoff": false,
  "action_tag": "PRONTO_PARA_AGENDAR|RECLAMACAO|HUMANO_SOLICITADO|null"
}`;

  const body = await httpJson(
    'POST',
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      'Content-Type': 'application/json',
      'x-goog-api-key': env('GEMINI_API_KEY'),
    },
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        topP: 0.9,
        topK: 40,
        maxOutputTokens,
        candidateCount: 1,
        responseMimeType: 'application/json',
      },
    },
    { timeout: Number(env('GEMINI_TIMEOUT_MS', 5000)) },
  );
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini sem texto de resposta');
  let structured;
  try {
    structured = JSON.parse(text);
  } catch (error) {
    structured = {
      intent: 'other',
      reply: text,
      service: conversationState.servico || null,
      customer_name: conversationState.nome_cliente || null,
      date: conversationState.dia || null,
      period: conversationState.periodo || null,
      ready_to_schedule: false,
      handoff: false,
      action_tag: null,
    };
  }
  const guardedReply = applyPricingGuard(structured.reply || fallback, structured, settings);
  structured.reply = guardedReply;
  return {
    text: guardedReply,
    structured,
    state: mergeConversationState(conversationState, structured),
    usage: body.usageMetadata || {},
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
  const classification = classify(context);
  const historyResult = await loadRecentHistory();
  const history = historyResult.rows;
  const catalog = await loadCatalogContext();
  const fallback = fallbackAnswer(context, classification);
  const gate = usageGate(context);

  let responseText = fallback;
  let aiProvider = 'fallback_rules';
  let aiModel = env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
  let aiError = '';
  let aiUsage = {};
  let structuredOutput = null;
  let agentState = defaultConversationState(history);

  if (rawText && gate.allowed) {
    try {
      const gemini = await callGemini(context, classification, fallback, history, catalog);
      responseText = gemini.text;
      aiProvider = 'gemini';
      aiModel = gemini.model;
      aiUsage = gemini.usage;
      structuredOutput = gemini.structured;
      agentState = gemini.state || agentState;
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

  const handoff = classification.handoff || responseText.includes('[HUMANO_SOLICITADO]');
  const cleanResponse = responseText.replace('[HUMANO_SOLICITADO]', '').trim();
  const contactName = [from.first_name, from.last_name].filter(Boolean).join(' ') || chat.title || 'Contato Telegram';
  const externalConversationId = String(chatId);
  const externalMessageId = message.message_id ? String(message.message_id) : `${chatId}:${Date.now()}`;

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
    stage: classification.stage,
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
    request_id: requestId,
    error_code: historyResult.error ? 'history_load_error' : null,
    raw_payload: {
      telegram_update: update,
      agent_state: agentState,
      structured_output: structuredOutput,
      observability: {
        request_id: requestId,
        history_count: history.length,
        history_error: historyResult.error,
        prompt_source: activePromptFor(context) ? 'tenant_config' : 'default',
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
      request_id: requestId,
      error: error.message || String(error),
      error_code: 'telegram_processing_error',
      telegram_response: {
        method: 'sendMessage',
        chat_id: chatId,
        text: messageText,
        disable_web_page_preview: true,
      },
    },
  };
}
