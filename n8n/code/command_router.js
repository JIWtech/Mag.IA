async function main(helpers) {
  const input = typeof $json.body === 'string' ? JSON.parse($json.body || '{}') : ($json.body || $json);
  const headers = $json.headers || {};

  function env(name, fallback = '') {
    let envValue = '';
    let varsValue = '';
    try { envValue = $env[name] || ''; } catch (error) {}
    try { varsValue = $vars?.[name] || ''; } catch (error) {}
    return envValue || varsValue || fallback;
  }

  function required(value, label) {
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(label + ' obrigatorio');
    }
    return String(value).trim();
  }

  function envSuffix(tenantSlug) {
    return String(tenantSlug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  }

  function bearerToken() {
    const header = headers.authorization || headers.Authorization || input.authorization || '';
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : String(input.access_token || '').trim();
  }

  function supabaseConfig() {
    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_ANON_KEY') || serviceKey;
    if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados no n8n');
    return { supabaseUrl, serviceKey, anonKey };
  }

  function serviceHeaders(prefer) {
    const { serviceKey } = supabaseConfig();
    return {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  async function httpJson(method, url, headers = {}, payload = null) {
    return await helpers.httpRequest({
      method,
      url,
      headers,
      ...(payload === null ? {} : { body: payload }),
      json: true,
      timeout: 15000,
    });
  }

  async function validateUserSession() {
    const token = bearerToken();
    if (!token) throw new Error('Authorization Bearer ausente');
    const { supabaseUrl, anonKey } = supabaseConfig();
    const user = await httpJson('GET', supabaseUrl + '/auth/v1/user', {
      apikey: anonKey,
      Authorization: 'Bearer ' + token,
    });
    if (!user?.id) throw new Error('Sessao Supabase invalida');
    return user;
  }

  async function loadTenant(tenantSlug) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/tenants?select=id,slug,name,industry,status&slug=eq.' + encodeURIComponent(tenantSlug) + '&limit=1',
      serviceHeaders(),
    );
    const tenant = Array.isArray(rows) ? rows[0] : null;
    if (!tenant) throw new Error('Tenant nao encontrado: ' + tenantSlug);
    if (tenant.status && !['active', 'trial', 'pilot', 'Piloto'].includes(String(tenant.status))) {
      throw new Error('Tenant inativo: ' + tenantSlug);
    }
    return tenant;
  }

  async function assertTenantMember(userId, tenantId, allowedRoles = ['owner', 'admin', 'manager', 'agent', 'operator']) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl
        + '/rest/v1/tenant_members?select=role,status&tenant_id=eq.' + encodeURIComponent(tenantId)
        + '&user_id=eq.' + encodeURIComponent(userId)
        + '&status=eq.active&limit=1',
      serviceHeaders(),
    );
    const membership = Array.isArray(rows) ? rows[0] : null;
    if (!membership) throw new Error('Usuario sem permissao para este tenant');
    if (!allowedRoles.includes(String(membership.role))) {
      throw new Error('Role sem permissao para enviar mensagens');
    }
    return membership;
  }

  function tokenFor(tenantSlug, channelType) {
    const suffix = envSuffix(tenantSlug);
    if (channelType === 'telegram') return env('TELEGRAM_BOT_TOKEN_' + suffix);
    if (channelType === 'instagram' || channelType === 'instagram_direct') return env('INSTAGRAM_PAGE_ACCESS_TOKEN_' + suffix);
    return '';
  }

  function evolutionFor(tenantSlug) {
    const suffix = envSuffix(tenantSlug);
    return {
      baseUrl: env('EVOLUTION_API_URL_' + suffix),
      apiKey: env('EVOLUTION_API_KEY_' + suffix),
      instance: env('EVOLUTION_INSTANCE_' + suffix),
    };
  }

  async function insertEvent(event) {
    const { supabaseUrl } = supabaseConfig();
    return await httpJson('POST', supabaseUrl + '/rest/v1/channel_events', serviceHeaders('return=representation'), event);
  }

  async function loadTenantSettings(tenantId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(tenantId) + '&limit=1',
      serviceHeaders(),
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row?.settings || {};
  }

  async function loadKanbanColumns(tenantId, boardId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/kanban_columns?select=id,name,automation_key,position&tenant_id=eq.' + encodeURIComponent(tenantId)
        + '&board_id=eq.' + encodeURIComponent(boardId) + '&order=position.asc',
      serviceHeaders(),
    );
    return Array.isArray(rows) ? rows : [];
  }

  function validateKanbanOrder(existing, orderedAutomationKeys) {
    const expected = existing.map((column) => String(column.automation_key || '')).filter(Boolean);
    const suggested = Array.isArray(orderedAutomationKeys) ? orderedAutomationKeys.map((key) => String(key || '').trim()).filter(Boolean) : [];
    return expected.length > 0 && suggested.length === expected.length
      && new Set(suggested).size === suggested.length
      && expected.every((key) => suggested.includes(key));
  }

  async function suggestKanbanFlowOrder(tenant, payload) {
    const columns = await loadKanbanColumns(tenant.id, required(payload.boardId, 'payload.boardId'));
    if (!columns.length) throw new Error('Kanban sem colunas configuradas');
    const settings = await loadTenantSettings(tenant.id);
    const contextColumns = columns.map((column) => ({
      name: column.name,
      automation_key: column.automation_key,
      kind: ['verificar_sinal', 'agendamentos', 'conversas_abandonadas', 'follow_ups'].includes(column.automation_key) ? 'special_view' : 'stage',
    }));
    const prompt = `Organize somente a ordem visual das colunas do Kanban para o tenant. Nao crie, remova, renomeie nem altere automation_key. Etapas sao operacionais; special_view sao visoes derivadas e podem ficar depois do fluxo principal. Responda APENAS JSON valido: {"orderedAutomationKeys":[...],"reasoning":"..."}. Tenant: ${tenant.name || tenant.slug}. Segmento: ${tenant.industry || settings.business_context || settings.industry || ''}. Colunas: ${JSON.stringify(contextColumns)}`;
    const model = env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
    const body = await httpJson('POST', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      'Content-Type': 'application/json',
      'x-goog-api-key': env('GEMINI_API_KEY'),
    }, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: 'application/json' } });
    const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini sem proposta de fluxo');
    let proposal;
    try { proposal = JSON.parse(text); } catch (error) { throw new Error('Gemini retornou proposta invalida'); }
    if (!validateKanbanOrder(columns, proposal?.orderedAutomationKeys)) throw new Error('Gemini retornou colunas invalidas');
    return { proposal: { orderedAutomationKeys: proposal.orderedAutomationKeys, reasoning: String(proposal.reasoning || '').trim() } };
  }

  async function applyKanbanFlowOrder(tenant, payload) {
    const boardId = required(payload.boardId, 'payload.boardId');
    const columns = await loadKanbanColumns(tenant.id, boardId);
    if (!validateKanbanOrder(columns, payload.orderedAutomationKeys)) throw new Error('Ordem de colunas invalida');
    const { supabaseUrl } = supabaseConfig();
    await httpJson('POST', supabaseUrl + '/rest/v1/rpc/reorder_kanban_columns', serviceHeaders(), {
      p_tenant_id: tenant.id,
      p_board_id: boardId,
      p_positions: payload.orderedAutomationKeys.map((automation_key, position) => ({ automation_key, position })),
    });
    return { ok: true, board_id: boardId, orderedAutomation_keys: payload.orderedAutomationKeys };
  }

  function paymentSignalConfirmationMessage(settings = {}) {
    const payment = settings.payment && typeof settings.payment === 'object' ? settings.payment : {};
    const configured = String(settings.payment_signal_confirmation_message || payment.confirmation_message || '').trim();
    if (configured) return configured;
    return 'Reserva confirmada! Recebemos a confirmacao do sinal. A equipe vai seguir com a confirmacao final por aqui.';
  }

  async function confirmAppointment(tenantId, appointmentId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/appointments?select=id,metadata,status&tenant_id=eq.' + encodeURIComponent(tenantId) + '&id=eq.' + encodeURIComponent(appointmentId) + '&limit=1',
      serviceHeaders(),
    );
    const appointment = Array.isArray(rows) ? rows[0] : null;
    if (!appointment) throw new Error('Agendamento nao encontrado: ' + appointmentId);
    const metadata = {
      ...(appointment.metadata || {}),
      payment_status: 'confirmed_by_operator',
      payment_confirmed_at: new Date().toISOString(),
    };
    const updated = await httpJson(
      'PATCH',
      supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenantId) + '&id=eq.' + encodeURIComponent(appointmentId),
      serviceHeaders('return=representation'),
      {
        status: 'confirmed',
        metadata,
        updated_at: new Date().toISOString(),
      },
    );
    return Array.isArray(updated) ? updated[0] : updated;
  }

  async function sendTelegram(token, chatId, text) {
    const body = await httpJson('POST', 'https://api.telegram.org/bot' + token + '/sendMessage', {
      'Content-Type': 'application/json',
    }, { chat_id: chatId, text, disable_web_page_preview: true });
    if (!body || body.ok === false) throw new Error(body?.description || 'Falha ao enviar mensagem no Telegram');
    return { provider: 'telegram', raw: body, messageId: body?.result?.message_id ? String(body.result.message_id) : '' };
  }

  async function sendInstagram(token, recipientId, text) {
    const body = await httpJson('POST', 'https://graph.facebook.com/v18.0/me/messages', {
      'Content-Type': 'application/json',
    }, { recipient: { id: recipientId }, message: { text } });
    if (!body || body.error) throw new Error(body?.error?.message || 'Falha ao enviar DM no Instagram');
    return { provider: 'instagram', raw: body, messageId: body?.message_id || '' };
  }

  async function sendWhatsApp(config, recipientId, text) {
    if (!config.baseUrl || !config.apiKey || !config.instance) {
      throw new Error('Credenciais Evolution especificas do tenant nao configuradas');
    }
    const body = await httpJson(
      'POST',
      config.baseUrl.replace(/\/$/, '') + '/message/sendText/' + encodeURIComponent(config.instance),
      { 'Content-Type': 'application/json', apikey: config.apiKey },
      { number: String(recipientId).replace(/@s\.whatsapp\.net$/, ''), text },
    );
    if (!body || body.error) throw new Error(body?.message || body?.error || 'Falha ao enviar mensagem no WhatsApp');
    return { provider: 'evolution_api', raw: body, messageId: body?.key?.id || body?.message?.key?.id || body?.id || '' };
  }

  function safeCatalogImage(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return '';
      if (/^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname)) return '';
      return url.href.slice(0, 1500);
    } catch (_) { return ''; }
  }

  function unwrapCatalogPayload(value) {
    let current = value;
    for (let depth = 0; depth < 4 && current && typeof current === 'object' && !Array.isArray(current); depth++) {
      if (Array.isArray(current.catalog) || Array.isArray(current.products) || Array.isArray(current.data)) break;
      if (current.data && typeof current.data === 'object') current = current.data;
      else if (current.result && typeof current.result === 'object') current = current.result;
      else break;
    }
    return current;
  }

  function productsFromPayload(value) {
    const payload = unwrapCatalogPayload(value);
    if (Array.isArray(payload)) return payload;
    for (const key of ['catalog', 'products', 'items', 'data']) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function evolutionFailure(error) {
    const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
    const message = String(error?.message || error?.description || error || 'Evolution request failed');
    if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid.?api.?key/i.test(message)) return 'CATALOG_PROVIDER_AUTH_FAILED';
    if (status === 404 || /not.?found|route.*not/i.test(message)) return 'CATALOG_PROVIDER_ENDPOINT_UNSUPPORTED';
    if (status === 408 || status === 429 || status >= 500 || /timeout|econn|network|unavailable/i.test(message)) return 'CATALOG_PROVIDER_UNAVAILABLE';
    return 'CATALOG_PROVIDER_ERROR';
  }

  async function fetchCatalogPages(evolution, instance, headers, number, productIds) {
    const base = evolution.baseUrl.replace(/\/$/, '');
    const found = new Map();
    let firstError = null;
    // Different Evolution builds accept either page/offset.  The stable limit
    // keeps a provider response bounded; never treat page one as exhaustive.
    for (let page = 1; page <= 20 && found.size < productIds.length; page++) {
      let response;
      try {
        response = await httpJson('POST', base + '/business/getCatalog/' + encodeURIComponent(instance), headers,
          { number, limit: 50, page, offset: (page - 1) * 50 });
      } catch (error) { firstError = firstError || error; break; }
      const payload = unwrapCatalogPayload(response);
      const products = productsFromPayload(payload);
      for (const product of products) {
        const id = String(product?.productId || product?.id || '');
        if (productIds.includes(id)) found.set(id, product);
      }
      const hasMore = payload?.hasNext === true || payload?.has_more === true || payload?.nextPage || payload?.next_page;
      if (!products.length || !hasMore && products.length < 50) break;
    }
    return { found, firstError };
  }

  async function refreshWhatsappCatalogProducts(tenant, tenantSlug, payload) {
    const instance = required(payload.instance_name, 'payload.instance_name');
    const productIds = [...new Set((Array.isArray(payload.product_ids) ? payload.product_ids : [])
      .map((value) => String(value || '').trim()).filter((value) => value && value.length <= 220))].slice(0, 20);
    if (!productIds.length) throw new Error('payload.product_ids obrigatorio');
    const { supabaseUrl } = supabaseConfig();
    const channels = await httpJson('GET', supabaseUrl + '/rest/v1/channels?select=external_id,config&tenant_id=eq.'
      + encodeURIComponent(tenant.id) + '&type=eq.whatsapp&status=eq.active&limit=50', serviceHeaders());
    const channel = (Array.isArray(channels) ? channels : []).find((row) => String(row.external_id || row.config?.instance_name || '') === instance);
    if (!channel) throw new Error('Instancia nao pertence ao tenant');
    const evolution = evolutionFor(tenantSlug);
    if (!evolution.baseUrl || !evolution.apiKey || evolution.instance !== instance) throw new Error('Evolution nao configurada para a instancia do tenant');
    const number = String(channel.config?.phone || '').replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(number)) throw new Error('Numero comercial da instancia indisponivel');
    const headers = { 'Content-Type': 'application/json', apikey: evolution.apiKey };
    const claim = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/claim_whatsapp_catalog_sync', serviceHeaders(), {
      p_tenant_id: tenant.id, p_instance_name: instance, p_cooldown_seconds: 120, p_lease_seconds: 180,
    });
    if (!claim?.claimed) return { ok: true, command: 'refresh_whatsapp_catalog_products', skipped: claim?.reason || 'cooldown' };
    const leaseToken = String(claim.lease_token || '');
    if (!leaseToken) throw new Error('CATALOG_SYNC_LEASE_INVALID');
    let catalog;
    try {
      catalog = await fetchCatalogPages(evolution, instance, headers, number, productIds);
      // getCollections is only a fallback: many versions return collection
      // metadata, not products. It must never make a partial catalog look empty.
      if (catalog.found.size < productIds.length) {
        try {
          const collectionsResponse = await httpJson('POST', evolution.baseUrl.replace(/\/$/, '') + '/business/getCollections/' + encodeURIComponent(instance), headers, { number, limit: 50 });
          const collectionsPayload = unwrapCatalogPayload(collectionsResponse);
          const collections = Array.isArray(collectionsPayload?.collections) ? collectionsPayload.collections : [];
          for (const collection of collections) for (const product of (Array.isArray(collection?.products) ? collection.products : [])) {
            const id = String(product?.productId || product?.id || '');
          if (!productIds.includes(id)) continue;
          const existing = catalog.found.get(id);
          // Collections may be a reduced projection of a product already
          // returned by getCatalog. Only fill gaps; never erase verified data.
          catalog.found.set(id, existing
            ? { ...product, ...existing, collection_id: existing.collection_id || collection.id || null,
              productImage: existing.productImage?.url ? existing.productImage : (product.productImage || existing.productImage) }
            : { ...product, collection_id: collection.id || null });
          }
        } catch (collectionsError) {
          // A partial valid catalog is authoritative for the IDs it contains.
          // Collection endpoints are version-dependent enrichment only.
          if (!catalog.found.size && !catalog.firstError) throw collectionsError;
        }
      }
      if (!catalog.found.size && catalog.firstError) throw catalog.firstError;
    } catch (error) {
      const errorCode = evolutionFailure(error);
      await httpJson('POST', supabaseUrl + '/rest/v1/rpc/finish_whatsapp_catalog_sync', serviceHeaders(), { p_tenant_id: tenant.id, p_instance_name: instance, p_lease_token: leaseToken, p_products: [], p_status: 'error', p_error_code: errorCode, p_endpoint: 'business/getCatalog' });
      throw new Error(errorCode);
    }
    const products = [...catalog.found.values()];
    const now = new Date().toISOString();
    const rows = products.filter((product) => productIds.includes(String(product?.productId || product?.id || ''))).map((product) => {
      const regular = Number(product.priceAmount1000); const sale = Number(product.salePriceAmount1000);
      const regularCents = Number.isSafeInteger(regular) && regular > 0 ? Math.round(regular / 10) : null;
      const saleCents = Number.isSafeInteger(sale) && sale > 0 ? Math.round(sale / 10) : null;
      const imageUrl = safeCatalogImage(product?.productImage?.url || product?.imageUrl || product?.image_url);
      return { tenant_id: tenant.id, instance_name: instance, product_id: String(product.productId || product.id), retailer_id: String(product.retailerId || ''), title: String(product.title || product.name || '').slice(0, 500), currency: String(product.currencyCode || product.currency || 'BRL').slice(0, 10), regular_price_cents: regularCents, sale_price_cents: saleCents, effective_price_cents: saleCents || regularCents, price_source: saleCents ? 'whatsapp_catalog_sale' : (regularCents ? 'whatsapp_catalog_current' : 'none'), price_evidence_source: 'evolution_getCatalog', price_observed_at: now, image_url: imageUrl || null, image_urls: imageUrl ? [imageUrl] : [], active: true, synced_at: now, updated_at: now };
    });
    const finish = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/finish_whatsapp_catalog_sync', serviceHeaders(), { p_tenant_id: tenant.id, p_instance_name: instance, p_lease_token: leaseToken, p_products: rows, p_status: 'ok', p_error_code: null, p_endpoint: 'business/getCatalog' });
    if (finish?.ok !== true) throw new Error('CATALOG_SYNC_LEASE_LOST');
    const missing = productIds.filter((id) => !catalog.found.has(id));
    return { ok: true, command: 'refresh_whatsapp_catalog_products', found: rows.length, requested: productIds.length, missing,
      outcome: rows.length ? 'products_found' : 'product_not_found' };
  }

  const command = required(input.command, 'command');
  const tenantSlug = required(input.tenant_slug, 'tenant_slug').toLowerCase();
  const payload = input.payload || {};
  if (!['manual_reply', 'broadcast_send', 'close_conversation', 'assign_conversation', 'confirm_payment_signal', 'suggest_kanban_flow_order', 'apply_kanban_flow_order', 'refresh_whatsapp_catalog_products'].includes(command)) throw new Error('command nao suportado: ' + command);

  const user = await validateUserSession();
  const tenant = await loadTenant(tenantSlug);
  await assertTenantMember(user.id, tenant.id, ['suggest_kanban_flow_order', 'apply_kanban_flow_order'].includes(command) ? ['owner', 'admin', 'manager'] : undefined);

  if (command === 'suggest_kanban_flow_order') return await suggestKanbanFlowOrder(tenant, payload);
  if (command === 'apply_kanban_flow_order') return await applyKanbanFlowOrder(tenant, payload);
  if (command === 'refresh_whatsapp_catalog_products') return await refreshWhatsappCatalogProducts(tenant, tenantSlug, payload);

  const channelType = required(payload.channel_type, 'payload.channel_type').toLowerCase();
  const externalConversationId = required(payload.external_conversation_id, 'payload.external_conversation_id');
  const messageText = command === 'close_conversation'
    ? String(payload.message_text || 'Atendimento encerrado').trim()
    : command === 'assign_conversation'
      ? String(payload.message_text || 'Conversa atribuida').trim()
      : command === 'confirm_payment_signal'
        ? String(payload.message_text || '').trim()
    : required(payload.message_text, 'payload.message_text');
  const token = tokenFor(tenantSlug, channelType);
  const evolution = channelType === 'whatsapp' ? evolutionFor(tenantSlug) : null;
  const commandId = payload.command_id || tenantSlug + ':' + channelType + ':' + externalConversationId + ':' + Date.now();

  if (!['telegram', 'instagram', 'instagram_direct', 'whatsapp'].includes(channelType)) {
    throw new Error('channel_type ainda nao suportado para envio manual: ' + channelType);
  }
  if (!['close_conversation', 'assign_conversation'].includes(command) && channelType !== 'whatsapp' && !token) {
    throw new Error('token nao configurado para tenant=' + tenantSlug + ' channel=' + channelType);
  }

  const normalizedChannel = channelType === 'instagram_direct' ? 'instagram' : channelType;
  if (command === 'close_conversation') {
    const event = {
      tenant_id: tenant.id,
      tenant_slug: tenantSlug,
      channel_type: normalizedChannel,
      external_conversation_id: externalConversationId,
      external_message_id: commandId,
      direction: 'outbound',
      sender_type: 'system',
      contact_name: payload.contact_name || 'Contato',
      message_text: messageText,
      service: 'conversation_closed',
      stage: 'Finalizado',
      handoff: false,
      response_text: null,
      ai_provider: 'conversation_closed',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      sent_by_user: payload.sent_by_user || user.email || 'Operador Mag.IA',
      delivery_status: 'closed',
      command_id: commandId,
      raw_payload: {
        command,
        closed_by: payload.sent_by_user || user.email || 'Operador Mag.IA',
        reason: payload.reason || 'Atendimento encerrado pela interface',
      },
    };
    const saved = await insertEvent(event);
    return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, saved };
  }

  if (command === 'confirm_payment_signal') {
    const appointmentId = required(payload.appointment_id, 'payload.appointment_id');
    const settings = await loadTenantSettings(tenant.id);
    // Opt-in only. Preserve the existing confirmation path for every other client.
    if (settings.whatsapp_processing_mode === 'conversation_core_v1') {
      if (normalizedChannel !== 'whatsapp') throw new Error('Canal incorreto para este agendamento');
      const { supabaseUrl } = supabaseConfig();
      const appointmentPath = supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenant.id)
        + '&id=eq.' + encodeURIComponent(appointmentId);
      const rows = await httpJson('GET', appointmentPath + '&select=*', serviceHeaders());
      const row = rows[0];
      if (!row || row.channel_type !== normalizedChannel || row.external_conversation_id !== externalConversationId) {
        throw new Error('Agendamento nao pertence a esta conversa/canal');
      }
      if (row.status === 'confirmed') return { ok: true, command, already_confirmed: true, appointment: row };
      if (row.status !== 'payment_reported') throw new Error('Aguardando cliente informar o sinal');
      if (row.metadata?.signal_confirmation_state) throw new Error('Confirmacao em andamento ou entrega incerta. Verifique antes de reenviar.');
      const claimedMetadata = { ...row.metadata, signal_confirmation_state: 'sending',
        signal_confirmation_command: commandId, payment_confirmed_by: user.id };
      const claimed = await httpJson('PATCH', appointmentPath + '&status=eq.payment_reported&updated_at=eq.'
        + encodeURIComponent(row.updated_at), serviceHeaders('return=representation'),
      { metadata: claimedMetadata, updated_at: new Date().toISOString() });
      if (claimed.length !== 1) throw new Error('Agendamento alterado por outro operador. Atualize o quadro.');
      let sent;
      try {
        sent = await sendWhatsApp(evolution, externalConversationId, paymentSignalConfirmationMessage(settings));
        if (!sent.messageId) throw new Error('Evolution nao retornou identificador da mensagem');
      } catch (error) {
        await httpJson('PATCH', appointmentPath, serviceHeaders(), { metadata: {
          ...claimedMetadata, signal_confirmation_state: 'uncertain' }, updated_at: new Date().toISOString() });
        throw new Error('Entrega da confirmacao nao comprovada. Verifique no WhatsApp antes de tentar novamente.');
      }
      const updated = await httpJson('PATCH', appointmentPath + '&status=eq.payment_reported', serviceHeaders('return=representation'), {
        status: 'confirmed', updated_at: new Date().toISOString(), metadata: { ...claimedMetadata,
          signal_confirmation_state: 'sent', confirmation_message_id: sent.messageId,
          payment_status: 'confirmed_by_operator', payment_confirmed_at: new Date().toISOString() },
      });
      if (updated.length !== 1) throw new Error('Mensagem enviada, mas registro alterado simultaneamente. Verifique o agendamento antes de repetir.');
      const event = { tenant_id: tenant.id, tenant_slug: tenantSlug, channel_type: normalizedChannel,
        external_conversation_id: externalConversationId, external_message_id: sent.messageId,
        direction: 'outbound', sender_type: 'system', contact_name: row.contact_name || 'Contato',
        message_text: paymentSignalConfirmationMessage(settings), service: 'appointment_payment_confirmed',
        stage: 'Agendamento confirmado', handoff: true, response_text: null, ai_provider: 'operator_confirmation',
        sent_by_user: user.email || user.id, delivery_status: 'sent', command_id: commandId,
        raw_payload: { command, appointment_id: appointmentId, confirmed_by: user.id, appointment: updated[0] } };
      const saved = await insertEvent(event);
      return { ok:true, command, appointment: updated[0], saved };
    }
    const confirmationText = messageText || paymentSignalConfirmationMessage(settings);

    const sent = normalizedChannel === 'telegram'
      ? await sendTelegram(token, externalConversationId, confirmationText)
      : normalizedChannel === 'whatsapp'
        ? await sendWhatsApp(evolution, externalConversationId, confirmationText)
        : await sendInstagram(token, externalConversationId, confirmationText);

    const appointment = await confirmAppointment(tenant.id, appointmentId);
    const event = {
      tenant_id: tenant.id,
      tenant_slug: tenantSlug,
      channel_type: normalizedChannel,
      external_conversation_id: externalConversationId,
      external_message_id: sent.messageId || commandId,
      direction: 'outbound',
      sender_type: 'system',
      contact_name: payload.contact_name || 'Contato',
      message_text: confirmationText,
      service: 'appointment_payment_confirmed',
      stage: 'Agendamento confirmado',
      handoff: true,
      response_text: null,
      ai_provider: 'operator_confirmation',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      sent_by_user: payload.sent_by_user || user.email || 'Operador Mag.IA',
      delivery_status: 'sent',
      command_id: commandId,
      raw_payload: {
        command,
        appointment_id: appointmentId,
        confirmed_by: payload.sent_by_user || user.email || 'Operador Mag.IA',
        appointment,
        sent,
      },
    };
    const saved = await insertEvent(event);
    return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, appointment, saved };
  }

  if (command === 'assign_conversation') {
    const assignee = payload.assignee || {};
    const assigneeName = assignee.name || payload.assignee_name || payload.sent_by_user || user.email || 'Atendimento humano';
    const event = {
      tenant_id: tenant.id,
      tenant_slug: tenantSlug,
      channel_type: normalizedChannel,
      external_conversation_id: externalConversationId,
      external_message_id: commandId,
      direction: 'outbound',
      sender_type: 'system',
      contact_name: payload.contact_name || 'Contato',
      message_text: messageText,
      service: 'conversation_assigned',
      stage: 'Atendimento humano',
      handoff: true,
      response_text: null,
      ai_provider: 'human_lock',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      sent_by_user: assigneeName,
      delivery_status: 'assigned',
      command_id: commandId,
      raw_payload: {
        command,
        assigned_by: user.email || 'Operador Mag.IA',
        assignee: {
          id: assignee.id || null,
          name: assigneeName,
          role: assignee.role || null,
        },
      },
    };
    const saved = await insertEvent(event);
    return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, saved };
  }

  const sent = normalizedChannel === 'telegram'
    ? await sendTelegram(token, externalConversationId, messageText)
    : normalizedChannel === 'whatsapp'
      ? await sendWhatsApp(evolution, externalConversationId, messageText)
      : await sendInstagram(token, externalConversationId, messageText);

  const event = {
    tenant_id: tenant.id,
    tenant_slug: tenantSlug,
    channel_type: normalizedChannel,
    external_conversation_id: externalConversationId,
    external_message_id: sent.messageId || commandId,
    direction: 'outbound',
    sender_type: 'agent',
    contact_name: payload.contact_name || 'Contato',
    message_text: messageText,
    service: payload.service || (command === 'broadcast_send' ? 'broadcast' : 'manual_reply'),
    stage: payload.stage || (command === 'broadcast_send' ? 'Disparo' : 'Atendimento humano'),
    handoff: command === 'manual_reply',
    response_text: null,
    sent_by_user: payload.sent_by_user || user.email || 'Operador Mag.IA',
    delivery_status: 'sent',
    command_id: commandId,
    raw_payload: { command, payload: { ...payload, message_text: undefined }, sent },
  };

  const saved = await insertEvent(event);
  return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, saved };
}

try {
  return { json: await main(this.helpers) };
} catch (error) {
  return { json: { ok: false, error: error.message || String(error) } };
}
