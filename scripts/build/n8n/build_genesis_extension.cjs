'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const extFile = path.join(root, 'n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2.json');
const engineFile = path.join(root, 'clients/wesley_automoveis/genesisCommercialEngine.cjs');

if (!fs.existsSync(extFile)) throw new Error(`Workflow file missing: ${extFile}`);
if (!fs.existsSync(engineFile)) throw new Error(`Engine file missing: ${engineFile}`);

const workflow = JSON.parse(fs.readFileSync(extFile, 'utf8'));
const policyNode = workflow.nodes.find(n => n.name.startsWith('EXT | Política'));
const validationNode = workflow.nodes.find(n => n.name === 'Validar identidade e capacidade do tenant');
if (!policyNode) throw new Error('Genesis policy node not found in workflow');
if (!validationNode) throw new Error('Genesis validation node not found in workflow');

// Read the engine source to embed its functions cleanly in the Code node
const engineSource = fs.readFileSync(engineFile, 'utf8');

// Strip module.exports from engine source
const engineBody = engineSource
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};?/, '')
  .trim();

const validationJsCode = `// Tenant-scoped settings: commercial fields are explicitly allowlisted.
const input = $json || {};
const expectedSlug = 'wesley_automoveis';
if (String(input.tenant_slug || '') !== expectedSlug || String(input.noria_extension || '') !== 'genesis' || String(input.noria_contract_version || '') !== '1.0') throw new Error('NORIA_EXTENSAO_TENANT_INCORRETO');
const uuid = String(input.tenant_id || ''), instance = String(input.instance || ''), chatId = String(input.remoteJid || '');
if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uuid) || !instance || !chatId) throw new Error('NORIA_IDENTIDADE_INCOMPLETA');
const base = String($env.SUPABASE_URL || '').replace(/\\/$/, ''), key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_CREDENCIAIS_SUPABASE_AUSENTES');
const headers = {apikey:key,Authorization:'Bearer '+key};
const get = endpoint => this.helpers.httpRequest({method:'GET',url:base+'/rest/v1/'+endpoint,headers,json:true,timeout:7000});
const tenants = await get('tenants?select=id,slug,status&id=eq.'+encodeURIComponent(uuid)+'&slug=eq.'+encodeURIComponent(expectedSlug)+'&limit=1');
if (!Array.isArray(tenants) || tenants.length!==1 || tenants[0].status!=='active') throw new Error('NORIA_TENANT_INVALIDO');
const settingsRows = await get('tenant_settings?select=settings&tenant_id=eq.'+encodeURIComponent(uuid)+'&limit=1');
const s = settingsRows?.[0]?.settings || {};
if (s.whatsapp_processing_mode!=='conversation_core_v1') throw new Error('NORIA_MOTOR_INATIVO_TENANT');
if (s.conversation_capability!=='sales_v1') throw new Error('NORIA_CAPACIDADE_DIVERGENTE');
const channels = await get('channels?select=external_id,config,status&tenant_id=eq.'+encodeURIComponent(uuid)+'&type=eq.whatsapp&status=eq.active&limit=25');
if (!Array.isArray(channels) || !channels.some(c => [c.external_id,c.config?.instance_name,c.config?.instance,c.config?.evolution_instance,c.config?.instance_id].filter(Boolean).includes(instance))) throw new Error('NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT');
const sourceSales = s.sales && typeof s.sales==='object' ? s.sales : {}, sales = {};
for (const field of ['sheet_id','sheet_tab','google_sheets_access_token_env','google_sheets_refresh_token_env','google_sheets_client_id_env','google_sheets_client_secret_env','stages','stage_keys','conversation_contract','ad_campaign_routing','required_financing_documents','whatsapp_catalog_price_mode','catalog','commercial_rules']) if (Object.prototype.hasOwnProperty.call(sourceSales,field)) sales[field]=sourceSales[field];
const verified = {tenant_id:uuid,whatsapp_processing_mode:s.whatsapp_processing_mode,conversation_capability:s.conversation_capability,whatsapp_audio_enabled:s.whatsapp_audio_enabled===true,appointment_scheduling:{enabled:s.appointment_scheduling?.enabled===true},approved_messages:{enabled:s.approved_messages?.enabled===true},vehicle_sheet_id:typeof s.vehicle_sheet_id==='string'?s.vehicle_sheet_id:'',sales};
return {json:{...input,noria_verified_settings:verified}};`;

const extJsCode = `// GUARD: this workflow must never execute for another customer. No side effects here.
// NORIA EXT | Gênesis Commercial Domain & Policy v2
const input = $json || {};
const expectedSlug = 'wesley_automoveis';
if (input.tenant_slug !== expectedSlug || (input.noria_extension && input.noria_extension !== 'genesis')) {
  throw new Error('NORIA_EXTENSION_POLICY_TENANT_MISMATCH');
}

const base = String($env.SUPABASE_URL || '').replace(/\\/$/, '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_EXTENSION_POLICY_NO_DB');

let rows = [];
if (input.noria_verified_settings?.tenant_id !== input.tenant_id) {
  rows = await this.helpers.httpRequest({
    method: 'GET',
    url: base + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.'
      + encodeURIComponent(input.tenant_id) + '&limit=1',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    json: true,
    timeout: 7000,
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('NORIA_EXTENSION_POLICY_SETTINGS_MISSING');
}

const settings = (input.noria_verified_settings?.tenant_id === input.tenant_id
  ? input.noria_verified_settings : (rows[0].settings || {}));
const capability = settings.conversation_capability === 'sales_v1' ? 'sales_v1' : 'standard';
if (capability !== 'sales_v1' || settings.whatsapp_processing_mode !== 'conversation_core_v1') {
  throw new Error('NORIA_EXTENSION_POLICY_SETTINGS_MISMATCH');
}

// Embedded Gênesis Commercial Domain Engine
${engineBody}

// Check if this is an explicit business operation call (noria_business_operation_v1).
// conversation.evaluate is the bounded turn dispatch: retain its trusted
// envelope and let the standard context builder below produce the response.
if ((input.contract === 'noria_business_operation_v1' || input.operation)
  && input.operation !== 'conversation.evaluate') {
  const op = input.operation;
  const result = await executeBusinessOperation(op, input.payload || input, {
    tenant_slug: expectedSlug,
    settings,
    env: name => $env[name],
    httpRequest: this.helpers.httpRequest.bind(this.helpers),
  });
  return { json: result };
}

// Standard policy generation with commercial capabilities
const profile = 'vehicle_sales_v1';
const policy = {
  contract: 'noria_policy_v2',
  tenant_id: input.tenant_id,
  tenant_slug: expectedSlug,
  profile,
  capability,
  audio_enabled: settings.whatsapp_audio_enabled === true,
  scheduling_enabled: settings.appointment_scheduling?.enabled === true,
  modules: {
    qualification: true,
    vehicle_inventory: true,
    financing: true,
    appraisal: true,
    auction_rules: 'genesis_evaluated_v2',
    kanban_source: 'tenant_settings.sales.stage_keys',
    policies_source: 'tenant_settings.sales + tenant_settings.sdr_rules',
    commercial_engine: 'genesis_v2',
  },
};

// Bootstrap validates policy only. The authenticated Sheets request belongs to
// the second, post-claim dispatch and therefore sees the real grouped turn.
if (input.noria_dispatch_phase === 'bootstrap') {
  return { json: { ...input, noria_client_policy: policy,
    noria_business_context: { contract:'noria_business_result_v1', tenant_slug:expectedSlug,
      phase:'bootstrap', inventory:null, offerable_catalog:null, resolved_selection:null,
      auction:null, financing:null, catalog_filters:null } } };
}

// A claimed but human-owned turn, or an empty claim, must continue through the
// same bounded graph without reading commercial systems or reopening the AI.
// The Core will make the final ownership/queue decision with this typed result.
if (input.noria_dispatch_skip) {
  const skippedDispatch = input.payload && typeof input.payload === 'object' ? input.payload : {};
  return { json: { ...input, noria_client_policy: policy,
    noria_business_context: { contract:'noria_business_result_v1', tenant_slug:expectedSlug,
      phase:'turn_skipped', skipped:String(input.noria_dispatch_skip),
      session_id:skippedDispatch.session_id || null, request_id:skippedDispatch.request_id || null,
      inventory:null, offerable_catalog:null, resolved_selection:null, auction:null, financing:null, catalog_filters:null } } };
}

// Pre-evaluate commercial context for this turn if messages are present
let businessContext = {
  contract: 'noria_business_result_v1',
  tenant_slug: expectedSlug,
  status: 'ok',
  inventory: null,
  offerable_catalog: null,
  resolved_selection: null,
  auction: null,
  financing: null,
  catalog_filters: null,
};

const turnMessages = Array.isArray(input.messages) ? input.messages : [];
const dispatch = input.operation === 'conversation.evaluate' && input.payload && typeof input.payload === 'object'
  ? input.payload : null;
if (dispatch && (dispatch.tenant_id !== input.tenant_id || dispatch.tenant_slug !== expectedSlug
  || !(String(dispatch.session_id || '') === 'initial' || /^[A-Za-z0-9_-]{8,200}$/.test(String(dispatch.session_id || '')))
  || !/^[A-Za-z0-9:_-]{8,240}$/.test(String(dispatch.request_id || '')))) {
  throw new Error('NORIA_BUSINESS_DISPATCH_INVALID');
}
// Preserve the authorized turn identity before Google Sheets or any other
// commercial dependency can fail. CORE uses this to reject only true staleness.
if (dispatch) {
  businessContext.operation = 'conversation.evaluate';
  businessContext.session_id = dispatch.session_id;
  businessContext.request_id = dispatch.request_id;
  businessContext.provenance = 'genesis_extension_turn_dispatch_v1';
}
const effectiveMessages = dispatch ? (Array.isArray(dispatch.turn?.grouped_messages) ? dispatch.turn.grouped_messages : []) : turnMessages;
const turnText = effectiveMessages.map(m => typeof m === 'string' ? m : (m?.text || '')).join(' ').trim();

// The authenticated Sheets source is synchronised separately. Conversation
// reads use the tenant-scoped Supabase snapshot and never require Google OAuth.
const snapshotBase = String($env.SUPABASE_URL || '').replace(/\\/$/, '');
const snapshotKey = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (snapshotBase && snapshotKey) {
  try {
    const inventory = await loadSupabaseInventory({
      tenantId: input.tenant_id, supabaseUrl: snapshotBase, serviceRoleKey: snapshotKey,
      httpRequest: this.helpers.httpRequest.bind(this.helpers),
    });
    const offerable = filterOfferableCatalog(inventory, 'all');
    businessContext.inventory = inventory;
    businessContext.offerable_catalog = offerable;
    businessContext.catalog_filters = {
      all: offerable,
      cars: filterOfferableCatalog(inventory, 'cars'),
      motorcycles: filterOfferableCatalog(inventory, 'motorcycles'),
    };

    if (turnText) {
      businessContext.resolved_selection = resolveSelection(turnText, inventory, dispatch?.catalog_context || input.catalog_context);
      // A numeric choice is resolved against the list that was actually sent,
      // but price/availability must always come from the freshly authorised
      // inventory.  Keep the stable displayed id; never reinterpret "6" using
      // the current spreadsheet ordering.
      const selectedId = businessContext.resolved_selection?.product?.id;
      const currentProduct = selectedId ? inventory.find(item => item.id === selectedId) : null;
      if (currentProduct) {
        businessContext.resolved_selection = {
          ...businessContext.resolved_selection,
          product: currentProduct,
          current_product: currentProduct,
          current_status: currentProduct.status,
          changed_since_catalog: currentProduct.offerable !== true,
        };
      } else if (selectedId) {
        businessContext.resolved_selection = {
          ...businessContext.resolved_selection,
          product: null,
          unavailable: true,
          reason: 'CATALOG_PRODUCT_NO_LONGER_AUTHORIZED',
        };
      }
      // commercial_state is read by the Core from the tenant's persisted
      // lead. Resolve its product id again against current authorised stock;
      // never use the stored product object as commercial evidence.
      const persistedProductId = String(dispatch?.commercial_state?.state?.product_id
        || dispatch?.commercial_state?.product?.id || '');
      const persistedProduct = persistedProductId
        ? inventory.find(item => item.id === persistedProductId) || null : null;
      const unresolvedSelection = businessContext.resolved_selection?.ambiguous === true
        || businessContext.resolved_selection?.invalid === true
        || businessContext.resolved_selection?.unavailable === true;
      const selectedNow = businessContext.resolved_selection?.product || null;
      const selectedNotOfferable = selectedNow && (selectedNow.offerable !== true
        || businessContext.resolved_selection?.commercial_eligible === false);
      const persistedNotOfferable = !selectedNow && persistedProduct && persistedProduct.offerable !== true;
      // A previously selected SKU that disappeared from the authorised snapshot
      // is no longer a resolvable product, not a fresh conversation without focus.
      const persistedMissing = !selectedNow && !!persistedProductId && !persistedProduct;
      const unavailableSelection = selectedNotOfferable || persistedNotOfferable || persistedMissing;
      const effectiveProduct = unresolvedSelection || unavailableSelection ? null : selectedNow || persistedProduct;
      // Facts for Gemini are keyed to the authoritative inventory row, never
      // to a stale lead/product object. No customer-vehicle details live here.
      businessContext.conversation_facts = {
        contract: 'noria_genesis_conversation_facts_v1',
        selection_status: unresolvedSelection ? 'unresolved'
          : unavailableSelection ? 'unavailable'
          : effectiveProduct ? 'resolved' : 'none',
        selection_source: unresolvedSelection ? 'ambiguous_or_invalid'
          : unavailableSelection ? 'no_longer_offerable'
          : selectedNow ? 'current_turn' : persistedProduct ? 'persisted_lead' : 'none',
        selected_product: effectiveProduct ? {
          id: effectiveProduct.id, name: effectiveProduct.name,
          brand: effectiveProduct.brand, model: effectiveProduct.model,
          year: effectiveProduct.year, category: effectiveProduct.category,
          color: effectiveProduct.color || null, km: effectiveProduct.km ?? null,
          fuel: effectiveProduct.fuel || null,
          observations: effectiveProduct.observations || null,
          price_cents: effectiveProduct.price_cents ?? null,
          price_source: effectiveProduct.price_source,
          status: effectiveProduct.status,
          availability_verified: effectiveProduct.availability_verified === true,
          source_observed_at: effectiveProduct.source_observed_at || null,
        } : null,
      };
      businessContext.auction = evaluateAuctionHandoff(turnText, dispatch?.commercial_state?.state || input.conversation_state, inventory, effectiveProduct);
      businessContext.financing = isFinancingQuestion(turnText)
        ? { active: true, reply: formatFinancingReply(turnText, effectiveProduct) }
        : { active: false, reply: null };
      if (dispatch) {
        businessContext.operations = {};
        businessContext.operations['vehicle.trade_in'] = await executeBusinessOperation('vehicle.trade_in', {
          tenant_slug: expectedSlug, messages: effectiveMessages, previous: dispatch.commercial_state?.state || {},
          prior_pending: dispatch.commercial_state?.state?.dialogue_context?.pending_requirement || '', inventory,
        }, { tenant_slug: expectedSlug, inventory });
        businessContext.operations['customer.name_progress'] = await executeBusinessOperation('customer.name_progress', {
          tenant_slug: expectedSlug, text: turnText, state: dispatch.commercial_state?.state || {},
          product: effectiveProduct, inventory,
        }, { tenant_slug: expectedSlug, inventory });
      }
    }
  } catch (err) {
    const rawCode = String(err?.message || 'INVENTORY_SNAPSHOT_UNAVAILABLE');
    const authFailure = /CREDENTIAL|AUTH|401|403|TOKEN|REFRESH/i.test(rawCode);
    businessContext.status = 'error';
    businessContext.error = {
      code: authFailure ? 'INVENTORY_SNAPSHOT_AUTH_UNAVAILABLE' : 'INVENTORY_SNAPSHOT_UNAVAILABLE',
      retryable: authFailure || /TIMEOUT|HTTP|NETWORK|ECONN|FETCH/i.test(rawCode),
      message: 'Não foi possível consultar o estoque no momento',
    };
  }
} else {
  businessContext.status = 'error';
  businessContext.error = { code: 'INVENTORY_SNAPSHOT_NOT_CONFIGURED', retryable: false, message: 'Não foi possível consultar o estoque no momento' };
}

return {
  json: {
    ...input,
    noria_client_policy: policy,
    noria_business_context: businessContext,
  }
};
`;

// Validate syntax
new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', extJsCode);

policyNode.parameters.jsCode = extJsCode;
validationNode.parameters.jsCode = validationJsCode;
fs.writeFileSync(extFile, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Successfully built NORIA EXT Gênesis (NORIA EXT _ Gênesis _ Política comercial v2.json).');
