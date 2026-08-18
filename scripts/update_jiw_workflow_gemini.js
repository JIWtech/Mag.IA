const fs = require('fs');

const workflowPath = 'magia/n8n/workflows/jiw_telegram_real_supabase.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

async function n8nCode() {
  const update = $json.body || $json;
  const message = update.message || update.edited_message || update.channel_post || {};
  const chat = message.chat || {};
  const from = message.from || {};
  const chatId = chat.id;
  const rawText = String(message.text || '').trim();
  const firstName = from.first_name || chat.first_name || 'tudo bem';
  const normalized = rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function hasAny(words) {
    return words.some((word) => normalized.includes(word));
  }

  function serviceLabel() {
    if (hasAny(['sistema', 'software', 'app', 'aplicativo', 'site', 'landing page', 'automacao', 'integracao', 'api', 'crm', 'dashboard'])) return 'software_house';
    if (hasAny(['suporte', 'erro', 'computador', 'notebook', 'internet', 'rede', 'servidor', 'email', 'impressora', 'ti', 'manutencao'])) return 'suporte_ti';
    if (hasAny(['trafego', 'anuncio', 'google ads', 'meta ads', 'facebook ads', 'campanha', 'leads', 'vendas online'])) return 'trafego_pago';
    if (hasAny(['social media', 'instagram', 'conteudo', 'post', 'reels', 'criativo', 'identidade visual'])) return 'social_media';
    if (hasAny(['consultoria', 'digital', 'processo', 'tecnologia para empresa'])) return 'consultoria_digital';
    return 'geral';
  }

  function fallbackAnswer() {
    let response = '';
    let stage = 'Qualificacao';
    let handoff = false;
    const service = serviceLabel();

    if (!rawText) {
      response = 'Ola! No momento eu consigo te atender melhor por texto. Me envie o que sua empresa precisa: software, suporte de TI, trafego pago, social media, site, automacao ou consultoria digital.';
    } else if (hasAny(['/start', 'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'teste'])) {
      response = `Ola, ${firstName}! Sou o assistente da JIW - Solucoes tecnologicas.\n\nA JIW ajuda empresas com desenvolvimento de sistemas, sites, automacoes, suporte de TI, trafego pago, social media e consultoria digital.\n\nMe diga em poucas palavras o que voce precisa.`;
    } else if (hasAny(['orcamento', 'quanto custa', 'preco', 'valor', 'proposta', 'contrato'])) {
      stage = 'Orcamento solicitado';
      handoff = true;
      response = 'Perfeito. Para preparar um orcamento, preciso entender melhor o escopo.\n\nMe envie, por favor:\n1. Nome da empresa\n2. Servico desejado\n3. Objetivo principal\n4. Prazo desejado\n5. Melhor contato\n\nVou sinalizar para um especialista da JIW continuar com voce. [HUMANO_SOLICITADO]';
    } else if (service === 'software_house') {
      stage = 'Briefing necessario';
      response = 'Entendi. A JIW pode ajudar com sistemas, apps, sites, landing pages, dashboards, integracoes e automacoes.\n\nPara direcionar corretamente, me diga:\n1. O que voce quer construir ou automatizar?\n2. Ja existe algum sistema hoje?\n3. Qual problema principal precisa resolver?\n4. Existe prazo ou urgencia?';
    } else if (service === 'suporte_ti') {
      stage = 'Suporte tecnico';
      handoff = hasAny(['urgente', 'fora do ar', 'parado', 'caiu', 'sem internet', 'nao funciona']);
      response = 'Certo. Para suporte de TI, me envie:\n1. Qual equipamento, sistema ou servico esta com problema?\n2. O erro impacta quantas pessoas?\n3. E urgente ou pode ser agendado?\n4. Nome da empresa e contato.\n\nSe for caso critico, vou encaminhar para atendimento humano. ' + (handoff ? '[HUMANO_SOLICITADO]' : '');
    } else if (service === 'trafego_pago') {
      stage = 'Briefing necessario';
      response = 'A JIW pode ajudar com campanhas de trafego pago para geracao de leads, vendas e posicionamento.\n\nPara avaliar, me diga:\n1. Qual produto ou servico voce vende?\n2. Ja anuncia hoje?\n3. Qual cidade/regiao atende?\n4. Qual objetivo: leads, vendas, agenda ou reconhecimento?';
    } else if (service === 'social_media') {
      stage = 'Briefing necessario';
      response = 'A JIW pode apoiar sua empresa com social media, conteudo, criativos e organizacao de presenca digital.\n\nMe diga:\n1. Qual e o segmento da empresa?\n2. Quais redes usa hoje?\n3. Precisa de estrategia, criacao de posts, reels ou gestao completa?';
    } else if (hasAny(['humano', 'atendente', 'especialista', 'reuniao', 'ligar', 'whatsapp'])) {
      stage = 'Atendimento humano';
      handoff = true;
      response = 'Claro. Vou encaminhar seu atendimento para um especialista da JIW continuar com voce. [HUMANO_SOLICITADO]';
    } else if (hasAny(['receita', 'bolo', 'piada', 'musica', 'filme', 'jogo'])) {
      stage = 'Fora de contexto';
      response = 'Nao consegui relacionar sua mensagem aos servicos da JIW. Posso ajudar com software, suporte de TI, trafego pago, social media, sites, automacoes ou consultoria digital. Pode reformular seu pedido nesse contexto?';
    } else {
      response = 'Entendi. Para eu direcionar melhor: sua necessidade esta mais ligada a software/site/automacao, suporte de TI, trafego pago, social media ou consultoria digital?';
    }
    return { response, stage, handoff, service };
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function safeEnv(name, fallback = '') {
    try {
      return $env[name] || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function getUsageGate() {
    const enabled = String(safeEnv('GEMINI_ENABLED', 'false')).toLowerCase() === 'true';
    const hasKey = Boolean(safeEnv('GEMINI_API_KEY'));
    const dailyLimit = Number(safeEnv('GEMINI_DAILY_LIMIT', 20));
    let usedToday = 0;
    try {
      const data = $getWorkflowStaticData('global');
      usedToday = Number(data[`gemini_jiw_${todayKey()}`] || 0);
    } catch (error) {}
    return { enabled, hasKey, dailyLimit, usedToday, allowed: enabled && hasKey && usedToday < dailyLimit };
  }

  function markUsage() {
    try {
      const data = $getWorkflowStaticData('global');
      const key = `gemini_jiw_${todayKey()}`;
      data[key] = Number(data[key] || 0) + 1;
      return data[key];
    } catch (error) {
      return null;
    }
  }

  async function callGemini(context) {
    const model = safeEnv('GEMINI_MODEL', 'gemini-2.5-flash-lite');
    const maxOutputTokens = Math.min(Number(safeEnv('GEMINI_MAX_OUTPUT_TOKENS', 220)), 300);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const prompt = `Voce e o assistente da JIW - Solucoes tecnologicas.\n\nContexto da empresa:\nA JIW atende empresas com desenvolvimento de sistemas, apps, sites, landing pages, automacoes, dashboards, integracoes, suporte de TI, infraestrutura, trafego pago, social media e consultoria digital.\n\nBase consultada no banco de dados:\n${context.catalogContext || 'Nenhum item especifico encontrado na base para esta mensagem.'}\n\nRegras:\n- Responda em portugues do Brasil, com acentos corretos.\n- Seja objetivo, consultivo e profissional.\n- Maximo de 900 caracteres.\n- Nao invente precos, prazos fechados ou garantias de resultado.\n- Use valores apenas quando vierem da base consultada acima.\n- Ao informar preco, trate como referencia inicial/a partir de, pois o escopo pode alterar o valor final.\n- Quando houver pedido de orcamento, proposta, contrato, suporte critico ou atendimento humano, colete dados minimos e sinalize [HUMANO_SOLICITADO].\n- Se fugir do contexto da JIW, informe que nao compete ao atendimento e peca para reformular dentro dos servicos digitais.\n\nMensagem do cliente (${firstName}): ${rawText}\n\nClassificacao previa: ${context.service}\nEtapa sugerida: ${context.stage}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': safeEnv('GEMINI_API_KEY'),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens,
          candidateCount: 1,
        },
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || `Gemini HTTP ${response.status}`);
    }
    const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini sem texto de resposta');
    return { text, usage: body.usageMetadata || {} };
  }

  async function queryCatalog() {
    const enabled = String(safeEnv('TENANT_CATALOG_ENABLED', 'false')).toLowerCase() === 'true';
    const supabaseUrl = safeEnv('SUPABASE_URL', '').replace(/\/$/, '');
    const serviceKey = safeEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    if (!enabled || !supabaseUrl || !serviceKey || !rawText) {
      return { matches: [], context: '', error: '' };
    }

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/search_tenant_service_catalog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          p_tenant_slug: 'jiw',
          p_query: rawText,
          p_limit: 5,
        }),
      });
      const body = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(body?.message || body?.error || `Supabase HTTP ${response.status}`);
      }
      const matches = Array.isArray(body) ? body : [];
      const context = matches.map((item, index) => {
        const price = item.price === null || item.price === undefined ? 'preco sob consulta' : `R$ ${Number(item.price).toFixed(2).replace('.', ',')}`;
        const hours = item.estimated_hours === null || item.estimated_hours === undefined ? '' : ` Tempo estimado: ${item.estimated_hours}h.`;
        const notes = item.notes ? ` Observacoes: ${item.notes}.` : '';
        return `${index + 1}. ${item.name} (${item.category || 'categoria geral'}): ${item.description || 'sem descricao'}. Unidade: ${item.billing_unit || 'sob consulta'}. Valor: ${price}.${hours}${notes}`;
      }).join('\n');
      return { matches, context, error: '' };
    } catch (error) {
      return { matches: [], context: '', error: error.message || String(error) };
    }
  }

  function buildCatalogFallback(matches) {
    if (!matches.length) return '';
    const lines = matches.slice(0, 3).map((item, index) => {
      const price = item.price === null || item.price === undefined ? 'preco sob consulta' : `R$ ${Number(item.price).toFixed(2).replace('.', ',')}`;
      const unit = item.billing_unit ? ` (${item.billing_unit})` : '';
      const notes = item.notes ? ` Obs.: ${item.notes}` : '';
      return `${index + 1}. ${item.name}${unit}: ${price}.${notes}`;
    });
    return `Encontrei estes itens na base da JIW:\n\n${lines.join('\n')}\n\nEsses valores sao referencias iniciais e podem mudar conforme o escopo. Para fechar um orcamento, me envie nome da empresa, servico desejado, objetivo, prazo e melhor contato. [HUMANO_SOLICITADO]`;
  }

  if (!chatId) return { json: { ok: false, error: 'missing_chat_id' } };

  const fallback = fallbackAnswer();
  const catalog = await queryCatalog();
  const gate = getUsageGate();
  let response = fallback.response;
  let aiProvider = 'fallback_rules';
  let aiModel = safeEnv('GEMINI_MODEL', 'gemini-2.5-flash-lite');
  let aiError = '';
  let aiUsage = {};

  if (rawText && gate.allowed) {
    try {
    const gemini = await callGemini({ ...fallback, catalogContext: catalog.context });
      response = gemini.text;
      aiUsage = gemini.usage;
      aiProvider = 'gemini';
      markUsage();
    } catch (error) {
      aiError = error.message || String(error);
      aiProvider = 'fallback_gemini_error';
    }
  } else if (!gate.enabled) {
    aiProvider = 'fallback_gemini_disabled';
  } else if (!gate.hasKey) {
    aiProvider = 'fallback_no_gemini_key';
  } else if (gate.usedToday >= gate.dailyLimit) {
    aiProvider = 'fallback_daily_limit';
  }

  if (aiProvider !== 'gemini' && catalog.matches.length && hasAny(['preco', 'valor', 'quanto custa', 'custa', 'orcamento', 'cobranca'])) {
    response = buildCatalogFallback(catalog.matches);
  }

  const handoff = fallback.handoff || response.includes('[HUMANO_SOLICITADO]');
  const contactName = [from.first_name, from.last_name].filter(Boolean).join(' ') || chat.title || 'Contato Telegram';
  const externalConversationId = String(chatId);
  const externalMessageId = message.message_id ? String(message.message_id) : `${chatId}:${Date.now()}`;

  return { json: {
    ok: true,
    tenant_slug: 'jiw',
    channel_type: 'telegram',
    external_conversation_id: externalConversationId,
    external_message_id: externalMessageId,
    direction: 'inbound',
    chat_id: chatId,
    contact_name: contactName,
    contact_handle: from.username || '',
    message_text: rawText,
    service: fallback.service,
    stage: fallback.stage,
    handoff,
    response_text: response,
    ai_provider: aiProvider,
    ai_model: aiModel,
    ai_error: aiError,
    ai_usage: aiUsage,
    catalog_matches: catalog.matches,
    catalog_error: catalog.error,
    gemini_daily_limit: gate.dailyLimit,
    gemini_used_today_before_request: gate.usedToday,
    raw_payload: update,
    telegram_response: { method: 'sendMessage', chat_id: chatId, text: response, disable_web_page_preview: true }
  } };
}

const source = n8nCode.toString();
const code = source.slice(source.indexOf('{') + 1, source.lastIndexOf('}')).trim();

for (const node of workflow.nodes) {
  if (node.name === 'Classificar e Responder') {
    node.parameters.jsCode = code;
  }
  if (node.name === 'Salvar Evento Supabase') {
    const fields = node.parameters.fieldsUi.fieldValues;
    const stableFields = new Set([
      'tenant_slug',
      'channel_type',
      'external_conversation_id',
      'external_message_id',
      'direction',
      'contact_name',
      'contact_handle',
      'message_text',
      'service',
      'stage',
      'handoff',
      'response_text',
      'raw_payload',
    ]);
    node.parameters.fieldsUi.fieldValues = fields.filter((field) => stableFields.has(field.fieldId));
  }
}

workflow.active = true;
workflow.versionId = 'gemini-cost-control-v1';
workflow.activeVersionId = 'gemini-cost-control-v1';
workflow.versionCounter = 2;

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log(`Workflow atualizado: ${workflowPath}`);
