// GUARD: this workflow must never execute for another customer. No side effects here.
// NORIA EXT | Gênesis Commercial Domain & Policy v2
const input = $json || {};
const expectedSlug = 'wesley_automoveis';
if (input.tenant_slug !== expectedSlug || (input.noria_extension && input.noria_extension !== 'genesis')) {
  throw new Error('NORIA_EXTENSION_POLICY_TENANT_MISMATCH');
}

const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
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
'use strict';

/**
 * NORIA — EXT Gênesis (wesley_automoveis) Commercial Domain Engine
 *
 * Encapsulates all commercial domain rules, catalog parsing, pricing,
 * auction evaluation, selection resolution, and Google Sheets integration
 * for Wesley Automóveis.
 *
 * Implements contracts:
 * - noria_business_operation_v1
 * - noria_business_result_v1
 */

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * 6.3 Centralized Brazilian Currency Parser
 * Handles:
 * - "R$ 34.980,00" -> 34980
 * - "R$ 45 mil" -> 45000
 * - "45k" -> 45000
 * - "17.980" -> 17980
 * - "R$ 17.980,00" -> 17980
 * - "R$ 3 mil de entrada" -> 3000
 * - "R$ 1.200 de parcela" -> 1200
 */
function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, ' ').replace(/^R\$\s*/i, '').trim();
  const abbreviated = compact.match(/^(\d+(?:[.,]\d+)?)\s*(?:mil|k)\b/i);
  if (abbreviated) return Number(abbreviated[1].replace(',', '.')) * 1000;
  const normalized = compact.replace(/\./g, '').replace(',', '.');
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) && Number.isFinite(Number(normalized)) && Number(normalized) > 0
    ? Number(normalized)
    : null;
}

function parseBrazilianCurrency(text) {
  const norm = normalizeText(text);
  const result = {
    total_price: null,
    total_price_cents: null,
    deposit: null,
    deposit_cents: null,
    installment: null,
    installment_cents: null,
    appraisal: null,
    appraisal_cents: null,
  };

  const isQuestion = /[?]/.test(String(text || '')) || /\b(?:e\s+se|sera\s+que|fazem|faz|consegue|conseguem|tem\s+como|possivel|da\s+pra)\b/i.test(norm);
  if (!isQuestion && /\b(?:sem\s+entrada|zero\s+(?:de\s+)?entrada|entrada\s+(?:zero|0)|nao\s+tenho\s+(?:nada\s+(?:de\s+)?)?entrada|vou\s+dar\s+zero)\b/i.test(norm)) {
    result.deposit = 0;
    result.deposit_cents = 0;
  }

  const depositMatch = text.match(/(?:entrada|sinal)(?:\s+de)?\s*(?:R\$\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:mil|k))?|\d+(?:\.\d{3})*(?:,\d{1,2})?)/i)
    || text.match(/(?:R\$\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:mil|k))?|\d+(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:de\s+)?(?:entrada|sinal)/i);
  if (depositMatch) {
    const val = parsePrice(depositMatch[1]);
    if (val !== null) {
      result.deposit = val;
      result.deposit_cents = Math.round(val * 100);
    }
  }

  const installmentMatch = text.match(/(?:parcela|prestacao|mensalidade)(?:s)?(?:\s+de)?\s*(?:R\$\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:mil|k))?|\d+(?:\.\d{3})*(?:,\d{1,2})?)/i)
    || text.match(/(?:R\$\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:mil|k))?|\d+(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:de\s+)?(?:parcela|prestacao)/i);
  if (installmentMatch) {
    const val = parsePrice(installmentMatch[1]);
    if (val !== null) {
      result.installment = val;
      result.installment_cents = Math.round(val * 100);
    }
  }

  const priceMatch = text.match(/(?:preco|valor|custa|sai|anunciad[oa])(?:\s+por)?\s*(?:R\$\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:mil|k))?|\d+(?:\.\d{3})*(?:,\d{1,2})?)/i)
    || text.match(/R\$\s*(\d+(?:[.,]\d+)?(?:\s*(?:mil|k))?|\d+(?:\.\d{3})*(?:,\d{1,2})?)/i);
  if (priceMatch && !depositMatch && !installmentMatch) {
    const val = parsePrice(priceMatch[1]);
    if (val !== null) {
      result.total_price = val;
      result.total_price_cents = Math.round(val * 100);
    }
  }

  return result;
}

function capitalizeWord(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * 6.4 Clean Commercial Display Name
 * Never displays technical keys like honda|cb 600rr|2007|
 * Displays: "Honda CB 600RR 2007"
 */
function formatCommercialName(brand, model, year) {
  const parts = [];
  if (brand) parts.push(capitalizeWord(String(brand).trim()));
  if (model) parts.push(String(model).trim());
  if (year && Number.isInteger(Number(year))) parts.push(String(year).trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 6.1 Status normalization & inventory parsing
 * States:
 * - ANUNCIADO -> announced (offerable = true, availability_verified = false)
 * - DISPONIVEL / LISTED -> listed (offerable = true, availability_verified = true)
 * - VENDIDO -> sold (offerable = false, historical = true)
 * - RESERVADO -> reserved (offerable = false, historical = true)
 * - INDISPONIVEL -> unavailable (offerable = false, historical = true)
 * - NAO VERIFICADO -> unverified (offerable = false, historical = true)
 */
function normalizeStatus(rawStatus) {
  const norm = normalizeText(rawStatus);
  if (['anunciado', 'announced'].includes(norm)) return { status: 'announced', offerable: true, verified: false };
  if (['disponivel', 'listed'].includes(norm)) return { status: 'listed', offerable: true, verified: true };
  if (['vendido', 'sold'].includes(norm)) return { status: 'sold', offerable: false, verified: false };
  if (['reservado', 'reserved'].includes(norm)) return { status: 'reserved', offerable: false, verified: false };
  if (['indisponivel', 'unavailable'].includes(norm)) return { status: 'unavailable', offerable: false, verified: false };
  if (['nao verificado', 'nao_verificado', 'unverified'].includes(norm)) return { status: 'unverified', offerable: false, verified: false };
  return null;
}

function parseSheetValues(values) {
  if (!Array.isArray(values) || values.length < 2 || values.length > 201) {
    throw new Error('INVALID_INVENTORY_TABLE');
  }
  const columns = values[0].map(v => normalizeText(v));
  for (const col of ['modelo', 'marca', 'preco', 'cor', 'km', 'ano', 'combustivel', 'status']) {
    if (columns.filter(v => v === col).length !== 1) {
      throw new Error('INVALID_INVENTORY_HEADERS');
    }
  }

  const ids = new Set();
  const value = (row, name) => row[columns.indexOf(name)];
  const str = (row, name) => String(value(row, name) ?? '').trim();

  return values.slice(1)
    .filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== ''))
    .map(row => {
      const statusObj = normalizeStatus(str(row, 'status'));
      if (!statusObj) throw new Error('INVALID_INVENTORY_STATUS');

      const model = str(row, 'modelo');
      const brand = str(row, 'marca');
      const year = Number(value(row, 'ano'));
      const rawPrice = value(row, 'preco');
      const price = parsePrice(rawPrice);
      const rawKm = value(row, 'km');
      const km = rawKm === null || rawKm === undefined || String(rawKm).trim() === ''
        ? null
        : Number(String(rawKm).replace(/\./g, '').replace(',', '.'));

      const hasPrice = rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== '';
      const priceCents = hasPrice && price !== null ? Math.round(price * 100) : null;

      if (!model || !brand || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 2
          || (hasPrice && (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(priceCents)))
          || (km !== null && (!Number.isFinite(km) || km < 0))) {
        throw new Error('INVALID_INVENTORY_ROW');
      }

      const technicalId = str(row, 'id_veiculo') || [brand, model, year, str(row, 'cor')].map(normalizeText).join('|');
      if (technicalId.length > 200 || ids.has(technicalId)) {
        throw new Error('AMBIGUOUS_INVENTORY_ID');
      }
      ids.add(technicalId);

      const commercialName = formatCommercialName(brand, model, year);

      return {
        id: technicalId,
        name: brand + ' ' + model,
        commercial_name: commercialName,
        model,
        brand,
        year,
        category: normalizeVehicleCategory(str(row, 'categoria') || str(row, 'category')),
        color: str(row, 'cor'),
        km,
        fuel: str(row, 'combustivel'),
        observations: columns.includes('observacoes') ? str(row, 'observacoes') : '',
        price_cents: priceCents,
        canonical_price_cents: priceCents,
        price_source: 'genesis_sheet',
        status: statusObj.status,
        offerable: statusObj.offerable,
        availability_verified: statusObj.verified,
      };
    });
}

/**
 * 6.2 Motorcycle vs Car Identification
 */
function isMotorcycle(rowOrText) {
  const category = normalizeVehicleCategory(rowOrText?.category);
  return category === 'unknown' ? null : category === 'motorcycle';
}

function normalizeVehicleCategory(value) {
  const category = normalizeText(value);
  // These are exact inventory field values, never intent/model-name heuristics.
  if (['motorcycle', 'motorcycles', 'moto', 'motocicleta'].includes(category)) return 'motorcycle';
  if (['car', 'cars', 'carro', 'automovel'].includes(category)) return 'car';
  return 'unknown';
}

// Maps the tenant-scoped Supabase snapshot to the same internal contract used
// by catalog selection, pricing and auction checks. This is intentionally a
// reader only: Sheets remains the synchronisation authority.
function parseSupabaseInventoryRows(rows) {
  if (!Array.isArray(rows) || rows.length > 200) throw new Error('INVENTORY_SNAPSHOT_INVALID');
  const ids = new Set();
  return rows.map(row => {
    const id = String(row?.vehicle_id || '').trim();
    const statusObj = normalizeStatus(row?.status);
    const brand = String(row?.brand || '').trim(), model = String(row?.model || '').trim();
    const year = Number(row?.model_year), cents = row?.price_cents === null || row?.price_cents === undefined ? null : Number(row.price_cents);
    const category = normalizeVehicleCategory(row?.category);
    if (!id || ids.has(id) || !statusObj || !brand || !model || !Number.isInteger(year)
      || (cents !== null && (!Number.isSafeInteger(cents) || cents <= 0))) {
      throw new Error('INVENTORY_SNAPSHOT_INVALID');
    }
    ids.add(id);
    return {
      id, name: `${brand} ${model}`, commercial_name: formatCommercialName(brand, model, year),
      brand, model, year, category, color: String(row.color || '').trim(),
      km: row.mileage_km === null || row.mileage_km === undefined ? null : Number(row.mileage_km),
      fuel: String(row.fuel || '').trim(), observations: String(row.observations || '').trim(),
      price_cents: cents, canonical_price_cents: cents, price_source: String(row.price_source || 'genesis_supabase_snapshot'),
      status: statusObj.status, offerable: statusObj.offerable,
      availability_verified: row.availability_confirmed === true && statusObj.verified,
      source_observed_at: row.source_observed_at || null, synced_at: row.synced_at || null,
    };
  });
}

async function loadSupabaseInventory({ tenantId, supabaseUrl, serviceRoleKey, httpRequest } = {}) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(tenantId || '')) || !supabaseUrl || !serviceRoleKey || !httpRequest) {
    throw new Error('INVENTORY_SNAPSHOT_CONFIG_INVALID');
  }
  const select = 'vehicle_id,sheet_row,brand,model,model_year,color,mileage_km,fuel,category,status,price_cents,availability_confirmed,price_source,observations,source_observed_at,synced_at';
  const rows = await httpRequest({ method:'GET', url:String(supabaseUrl).replace(/\/$/,'')+'/rest/v1/genesis_inventory_vehicles?select='+encodeURIComponent(select)+'&tenant_id=eq.'+encodeURIComponent(tenantId)+'&order=sheet_row.asc&limit=200', headers:{apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey}, json:true, timeout:7000 });
  return parseSupabaseInventoryRows(rows);
}

function classifyCatalogAudience(value = 'all') {
  if (['all', 'motorcycles', 'cars'].includes(value)) return value;
  if (value?.valid === true && ['all', 'motorcycles', 'cars'].includes(value.catalog?.category)) return value.catalog.category;
  return 'unspecified';
}

function commercialEligibility(product) {
  if (!product) return { eligible: false, reason: 'not_found', availability_confirmed: false };
  const status = normalizeText(product.status);
  const blocked = ['sold', 'vendido', 'reserved', 'reservado', 'unavailable', 'indisponivel', 'unverified', 'nao_verificado'].includes(status);
  const offerable = product.offerable === true
    || (product.offerable !== false && ['announced', 'anunciado', 'listed', 'disponivel'].includes(status));
  return {
    eligible: offerable && !blocked,
    reason: blocked ? (['sold', 'vendido'].includes(status) ? 'sold' : 'not_offerable') : (offerable ? 'eligible' : 'not_offerable'),
    availability_confirmed: product.availability_verified === true,
  };
}

/**
 * 6.2 Fix: Always filter ONLY offerable vehicles when presenting catalog!
 */
function filterOfferableCatalog(inventory = [], audienceOrText = 'all') {
  const offerable = inventory.filter(row => commercialEligibility(row).eligible);
  const audience = classifyCatalogAudience(audienceOrText);

  if (audience === 'all') return offerable;
  if (audience === 'unspecified') return [];
  return offerable.filter(item => isMotorcycle(item) === (audience === 'motorcycles'));
}

// Applies only machine-readable constraints emitted by the validated semantic
// contract. Free prose is deliberately reported as unsupported instead of
// guessing vehicle qualities that do not exist in the authorised snapshot.
function filterCatalogBySemantic(inventory = [], semanticCatalog = {}) {
  const audience = ['all', 'cars', 'motorcycles'].includes(semanticCatalog.category)
    ? semanticCatalog.category : 'all';
  let items = filterOfferableCatalog(inventory, audience);
  const applied = [];
  const unsupported = [];
  const min = semanticCatalog.price_min_cents;
  const max = semanticCatalog.price_max_cents;
  if (Number.isSafeInteger(min) && min >= 0) {
    items = items.filter(item => Number.isSafeInteger(item.price_cents) && item.price_cents >= min);
    applied.push({ field: 'price_min_cents', value: min });
  }
  if (Number.isSafeInteger(max) && max >= 0) {
    items = items.filter(item => Number.isSafeInteger(item.price_cents) && item.price_cents <= max);
    applied.push({ field: 'price_max_cents', value: max });
  }
  const match = (item, field, rawValue) => {
    const value = normalizeText(rawValue).trim();
    if (!value) return false;
    if (field === 'year_min') return Number.isInteger(Number(rawValue)) && Number(item.year) >= Number(rawValue);
    if (field === 'year_max') return Number.isInteger(Number(rawValue)) && Number(item.year) <= Number(rawValue);
    if (field === 'product_id') return String(item.id || '') === String(rawValue).trim();
    if (!['brand', 'model', 'color', 'fuel'].includes(field)) return null;
    return normalizeText(item[field] || '') === value;
  };
  const applyConstraints = (values, exclude) => {
    for (const raw of Array.isArray(values) ? values : []) {
      const parsed = String(raw || '').match(/^([a-z_]+)=(.+)$/i);
      if (!parsed) { unsupported.push(String(raw)); continue; }
      const field = normalizeText(parsed[1]), value = parsed[2].trim();
      const supported = match({}, field, value);
      if (supported === null) { unsupported.push(String(raw)); continue; }
      items = items.filter(item => exclude ? !match(item, field, value) : match(item, field, value));
      applied.push({ field, value, mode: exclude ? 'exclude' : 'include' });
    }
  };
  applyConstraints(semanticCatalog.preferences, false);
  applyConstraints(semanticCatalog.exclusions, true);
  return { items, count: items.length, applied, unsupported,
    requires_clarification: unsupported.length > 0 };
}

/**
 * 7. Resolution of Catalog Selection (Fixes Caso Jeferson)
 * Parses:
 * - Ordinals: "6", "o sexto", "essa sexta", "opcao 6", "6.", etc.
 * - Textual references: "a CB", "essa moto", "a CB 600", "o Sandero"
 * Resolves against catalog context products, preserving commercial name, price, and status.
 */
function parseCatalogOrdinal(text = '') {
  const norm = normalizeText(text).replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return null;
  if (/\b\d+\s*(?:mil|k|reais|km|por cento)\b|r\$/.test(norm)) return null;

  const patterns = [
    /^(?:o|a|opcao|item|numero)?\s*([1-9]\d?)$/,
    /\b(?:esse|essa|este|esta|aquele|aquela)\s+(?:(?:item|numero|modelo|opcao)\s+)?([1-9]\d?)\b/,
    /\b(?:quero|queria|vou|prefiro|gostei|pego|pegar|escolho|escolhi|comprar|compro|levar)\s+(?:(?:pegar|comprar|levar|ficar\s+com|saber\s+sobre)\s+)?(?:(?:o|a|item|opcao|numero|modelo)\s+)?([1-9]\d?)\b/,
    /\b(?:me\s+fala\s+(?:mais\s+)?(?:sobre|do|da)|fala\s+(?:mais\s+)?(?:sobre|do|da)|sobre\s+(?:o|a)|item|opcao|numero)\s+(?:o\s+|a\s+)?([1-9]\d?)\b/
  ];

  for (const pattern of patterns) {
    const match = norm.match(pattern);
    if (match) return Number(match[1]);
  }

  const ordinalWords = {
    primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3,
    quarto: 4, quarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6,
    setimo: 7, setima: 7, oitavo: 8, oitava: 8, nono: 9, nona: 9, decimo: 10, decima: 10
  };
  for (const [word, num] of Object.entries(ordinalWords)) {
    if (new RegExp('\\b' + word + '\\b').test(norm) && !/\b(?:feira|marcha|parcela|prestacao)\b/.test(norm)) {
      return num;
    }
  }

  return null;
}

function resolveSelection(text = '', inventory = [], catalogContext = null) {
  const ordinal = parseCatalogOrdinal(text);
  const products = catalogContext?.products || [];

  if (ordinal !== null) {
    if (products.length >= ordinal && products[ordinal - 1]) {
      const reference = products[ordinal - 1];
      const product = inventory.find(item => String(item?.id || '') === String(reference?.id || '')) || null;
      const eligibility = commercialEligibility(product);
      return {
        product,
        identified_product: product || reference,
        invalid: !product,
        ambiguous: false,
        contextual: true,
        resolved_via: 'ordinal',
        ordinal,
        commercial_eligible: eligibility.eligible,
        ineligible_reason: eligibility.reason,
        availability_confirmed: eligibility.availability_confirmed,
      };
    }
    // If ordinal exists but out of bounds of recent context:
    if (products.length > 0 && ordinal > products.length) {
      return { product: null, invalid: true, ambiguous: false, contextual: true, ordinal };
    }
  }

  // Textual reference resolution
  const normText = normalizeText(text);

  // General category/inventory exploration queries belong to filter_catalog, never ambiguous SKU selection
  const isCategoryListingQuery = /\b(?:motos?|motocicletas?|scooters?|carros?|automoveis?|veiculos?)\b/i.test(normText)
    && /\b(?:quais|tem|têm|ver|mostr(?:a|ar|e)|lista|listar|catalogo|estoque|disponive(?:l|is)|opcoes|opções)\b/i.test(normText)
    && !products.length;
  if (isCategoryListingQuery) {
    return { product: null, invalid: false, ambiguous: false, contextual: false };
  }

  const offerable = filterOfferableCatalog(inventory, 'all');
  const pool = products.length ? products.filter(Boolean) : offerable;

  const matches = [];
  for (const item of pool) {
    const modelNorm = normalizeText(item.model);
    const brandNorm = normalizeText(item.brand);
    const nameNorm = normalizeText(item.name || item.commercial_name);
    const modelTokens = modelNorm.split(/[\s/-]+/).filter(token => token.length >= 2);

    // Exact or keyword match
    // Empty optional display fields must never match every input (`text.includes('')`).
    // The authoritative parser always provides model, but tolerate a persisted
    // catalog snapshot that only has a stable id or partial display data.
    if ((nameNorm && normText.includes(nameNorm)) || (modelNorm && normText.includes(modelNorm))) {
      matches.push(item);
    } else if (modelTokens.some(token => new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(normText))) {
      matches.push(item);
    }
  }

  if (matches.length === 1) {
    const reference = matches[0];
    const product = inventory.find(item => String(item?.id || '') === String(reference?.id || '')) || reference;
    const eligibility = commercialEligibility(product);
    return { product, identified_product: product, invalid: false, ambiguous: false, contextual: true, resolved_via: 'textual',
      commercial_eligible: eligibility.eligible, ineligible_reason: eligibility.reason,
      availability_confirmed: eligibility.availability_confirmed };
  }
  if (matches.length > 1) {
    return { product: null, invalid: false, ambiguous: true, candidates: matches, contextual: true };
  }

  return { product: null, invalid: false, ambiguous: false, contextual: false };
}

/**
 * 8. Auction / Leilão Domain Rules (Gênesis exclusive)
 *
 * Distinguishes:
 * 1. Customer selling auction vehicle / trade-in with auction history:
 *    -> Handoff required ("auction_vehicle_purchase")
 * 2. Customer asks about dealer's announced vehicle auction history:
 *    -> Checks documented observations from sheet. If documented, states factual history. No handoff.
 * 3. Customer rejects auction vehicle ("Não quero carro de leilão"):
 *    -> No handoff!
 * 4. Sinistro without auction:
 *    -> No handoff!
 * 5. Ambiguous intent:
 *    -> No handoff!
 */
function classifyAuctionIntent(text = '', state = {}, inventory = [], currentProduct = null, semantic = null) {
  // The primary dialogue model interprets the request. The EXT executes the
  // validated decision and exposes source facts; prose is never an intent flag.
  const decision = semantic?.valid === true ? semantic.auction : null;
  const allowed = ['none', 'policy_inquiry', 'customer_vehicle_offer', 'inventory_interest', 'inventory_history', 'rejection', 'sinistro_inquiry', 'unclear'];
  if (!decision || !allowed.includes(decision.intent) || decision.intent === 'none') return null;
  if (!Array.isArray(decision.evidence_ids) || !decision.evidence_ids.length) return null;
  const targetId = decision.product_id || state?.product_id || (typeof currentProduct === 'string' ? currentProduct : currentProduct?.id);
  const product = inventory.find(row => String(row.id) === String(targetId || '')) || null;
  const intent = decision.intent;
  const origin = ['inventory_history', 'inventory_interest'].includes(intent) ? 'inventory'
    : intent === 'customer_vehicle_offer' ? 'customer' : 'none';
  const reason = {
    policy_inquiry: 'auction_policy_inquiry', customer_vehicle_offer: 'auction_vehicle_purchase',
    inventory_interest: 'auction_inventory_interest', inventory_history: 'auction_inventory_history',
    rejection: 'auction_rejection', sinistro_inquiry: 'sinistro_check', unclear: 'auction_intent_unclear',
  }[intent];
  // Only a concrete offer or selected stock negotiation follows the business
  // handoff rule. A question about buying policy never constitutes an offer.
  const handoffRequired = intent === 'customer_vehicle_offer'
    || (intent === 'inventory_interest' && commercialEligibility(product).eligible);
  const structuredHistory = typeof product?.auction_history === 'boolean' ? product.auction_history : null;
  return {
    intent, reason, handoff_required: handoffRequired, origin, product,
    message: null,
    inventory_history: {
      documented: structuredHistory === true,
      auction_history: structuredHistory,
      status: structuredHistory === null ? 'requires_interpretation' : 'confirmed',
      observation: String(product?.observations || ''),
    },
  };
}
function evaluateAuctionHandoff(text = '', state = {}, inventory = [], currentProduct = null, semantic = null) {
  const classification = classifyAuctionIntent(text, state, inventory, currentProduct, semantic);
  if (!classification) {
    return { required: false, reason: null, message: null };
  }
  return {
    required: classification.handoff_required === true,
    reason: classification.reason,
    message: classification.message || null,
    intent: classification.intent,
    origin: classification.origin || 'unknown',
    vehicle: classification.product ? {
      product_id: classification.product.id || '',
      name: [classification.product.brand, classification.product.model].filter(Boolean).join(' ') || classification.product.name || '',
      model: classification.product.model || '',
      year: classification.product.year || null,
    } : null,
    inventory_history: classification.inventory_history || { documented: false, observation: '' },
    classification,
  };
}

/**
 * Financing Rules (Gênesis exclusive)
 */
function isFinancingQuestion(text = '', priorPending = '', semantic = null) {
  if (semantic?.valid === true) {
    return semantic.primary_intent === 'financing'
      || semantic.secondary_intents?.includes('financing') === true;
  }
  const norm = normalizeText(text);
  return /\b(?:financi(?:amento|ar|am|a)|fazem\s+financiamento|como\s+(?:funciona|e|fica)\s+o\s+financiamento|trabalha\s+com\s+financiamento|simulac(?:ao|oes)|simular)\b/.test(norm);
}

function formatFinancingReply(text = '', product = null) {
  const norm = normalizeText(text);
  if (/\b(?:financi(?:amento|ar|am|a)|fazem\s+financiamento|como\s+(?:funciona|e|fica)\s+o\s+financiamento|trabalha\s+com\s+financiamento|simulac(?:ao|oes)|simular)\b/.test(norm)) {
    return 'Trabalhamos com financiamento, sujeito à análise da financeira\nQuanto você pretende dar de entrada?';
  }
  return 'A entrada mínima e as parcelas dependem da análise da financeira\nQuer que um atendente confira uma simulação pra você?';
}

/**
 * 5. Google Sheets Authenticated Inventory Loader
 */
async function loadInventory({ settings = {}, env = () => null, httpRequest = null, forceRefresh = false, cache = null } = {}) {
  if (!forceRefresh && cache && Array.isArray(cache.inventory)) {
    return cache.inventory;
  }

  // The tenant configuration is the only authority for the inventory source.
  // `vehicle_sheet_id` remains supported for the deployed settings contract,
  // but never fall back to a public/default spreadsheet.
  const sheetId = settings.sales?.sheet_id || settings.vehicle_sheet_id;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetId)) {
    throw new Error('INVENTORY_NOT_CONFIGURED');
  }

  const tab = String(settings.sales?.sheet_tab || 'Página1').trim();
  const tokenEnv = String(settings.sales?.google_sheets_access_token_env || 'GOOGLE_SHEETS_ACCESS_TOKEN').trim();
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(tokenEnv)) {
    throw new Error('INVENTORY_CREDENTIAL_CONFIG_INVALID');
  }

  let token = env(tokenEnv);

  // Optional OAuth refresh token flow:
  const refreshEnv = String(settings.sales?.google_sheets_refresh_token_env || '').trim();
  const clientIdEnv = String(settings.sales?.google_sheets_client_id_env || '').trim();
  const clientSecretEnv = String(settings.sales?.google_sheets_client_secret_env || '').trim();

  if (refreshEnv || clientIdEnv || clientSecretEnv) {
    if (![refreshEnv, clientIdEnv, clientSecretEnv].every(name => /^[A-Z][A-Z0-9_]{2,127}$/.test(name))) {
      throw new Error('INVENTORY_CREDENTIAL_CONFIG_INVALID');
    }
    const refreshToken = env(refreshEnv);
    const clientId = env(clientIdEnv);
    const clientSecret = env(clientSecretEnv);
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error('INVENTORY_CREDENTIALS_UNAVAILABLE');
    }
    if (httpRequest) {
      const form = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
        + '&client_id=' + encodeURIComponent(clientId)
        + '&client_secret=' + encodeURIComponent(clientSecret);
      const refreshed = await httpRequest({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        json: true,
        timeout: 7000,
      });
      token = String(refreshed?.access_token || '');
      if (!token) throw new Error('INVENTORY_CREDENTIAL_REFRESH_FAILED');
    }
  }

  if (!token) throw new Error('INVENTORY_CREDENTIALS_UNAVAILABLE');

  if (!httpRequest) {
    throw new Error('HTTP_REQUEST_HELPER_UNAVAILABLE');
  }

  const range = encodeURIComponent(tab + '!A:Z');
  const response = await httpRequest({
    method: 'GET',
    url: 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId) + '/values/' + range + '?majorDimension=ROWS',
    headers: { Authorization: 'Bearer ' + token },
    json: true,
    timeout: 10000,
  });

  return parseSheetValues(response?.values);
}

/**
 * 3. Contract: executeBusinessOperation
 * Handles operations:
 * - inventory.list
 * - inventory.lookup
 * - inventory.resolve_selection
 * - inventory.filter_catalog
 * - auction.classify_intent
 * - auction.evaluate_handoff
 * - financing.evaluate
 * - commercial.build_context
 */
async function executeBusinessOperation(operation, payload = {}, context = {}) {
  const opContract = payload.contract || context.contract || 'noria_business_operation_v1';
  const tenantSlug = payload.tenant_slug || context.tenant_slug;

  if (tenantSlug !== 'wesley_automoveis') {
    return {
      contract: 'noria_business_result_v1',
      operation,
      status: 'error',
      data: null,
      error: 'CROSS_TENANT_OPERATION_DISALLOWED',
      handoff: { required: false, reason: null, message: null },
    };
  }

  let inventory = payload.inventory || context.inventory;
  if (!inventory && context.httpRequest) {
    try {
      inventory = await loadInventory({
        settings: context.settings,
        env: context.env,
        httpRequest: context.httpRequest,
        forceRefresh: payload.force_refresh || false,
      });
    } catch (e) {
      if (operation === 'inventory.list') {
        throw e;
      }
      inventory = [];
    }
  }
  inventory = inventory || [];

  switch (operation) {
    case 'inventory.list': {
      const offerableOnly = payload.offerable_only === true;
      const items = offerableOnly ? filterOfferableCatalog(inventory, 'all') : inventory;
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: {
          items,
          count: items.length,
          total_count: inventory.length,
        },
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'inventory.lookup': {
      const query = payload.query || payload.product_id || '';
      const normQuery = normalizeText(query);
      const found = inventory.find(row => row.id === query || normalizeText(row.name).includes(normQuery) || normalizeText(row.model).includes(normQuery));
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: found ? 'ok' : 'not_found',
        data: found ? {
          product_id: found.id,
          name: found.name,
          model: found.model,
          brand: found.brand,
          year: found.year,
          price: found.price_cents ? found.price_cents / 100 : null,
          price_cents: found.price_cents,
          currency: 'BRL',
          price_source: found.price_source || 'genesis_sheet',
          availability_status: found.status,
          availability_confirmed: found.availability_verified === true,
          observations: found.observations || '',
        } : null,
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'inventory.resolve_selection': {
      const resolved = resolveSelection(payload.text, inventory, payload.catalog_context);
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: resolved.product ? 'ok' : (resolved.ambiguous ? 'ambiguous' : (resolved.invalid ? 'invalid' : 'not_found')),
        data: resolved,
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'inventory.filter_catalog': {
      const audience = classifyCatalogAudience(payload.semantic_intent || payload.audience || (payload.query ? 'unspecified' : 'all'));
      const filtered = payload.semantic_catalog
        ? filterCatalogBySemantic(inventory, payload.semantic_catalog)
        : { items: filterOfferableCatalog(inventory, audience), applied: [], unsupported: [], requires_clarification: audience === 'unspecified' || (!!payload.query && !payload.audience && !payload.semantic_intent) };
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: { ...filtered, count: filtered.items.length },
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'auction.classify_intent': {
      const classification = classifyAuctionIntent(payload.text, payload.state, inventory, payload.product, payload.semantic_intent);
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: classification,
        handoff: {
          required: classification?.handoff_required === true,
          reason: classification?.reason || null,
          message: classification?.message || null,
        },
      };
    }

    case 'auction.evaluate_handoff': {
      const handoff = evaluateAuctionHandoff(payload.text, payload.state, inventory, payload.product, payload.semantic_intent);
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: handoff,
        handoff: {
          required: handoff.required,
          reason: handoff.reason,
          message: handoff.message,
        },
      };
    }

    case 'financing.evaluate': {
      const isFin = isFinancingQuestion(payload.text, payload.prior_pending, payload.semantic_intent);
      const reply = isFin ? formatFinancingReply(payload.text, payload.product) : null;
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: {
          is_financing_question: isFin,
          reply,
          pending_requirement: isFin ? 'deposit' : '',
        },
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'vehicle.trade_in': {
      const messages = payload.messages || [];
      const current = (messages || []).map(m => ({ id: String(m.event_id || m.id || ''), text: String(m.text || '') }));
      const text = normalizeText(current.map(m => m.text).join(' '));
      if (/\b(?:nao|nunca)\s+(?:quero\s+|vou\s+|pretendo\s+)?(?:dar|usar|colocar|trocar)\b/.test(text)
        || /\b(?:so|apenas)\s+(?:quero\s+)?vender\b/.test(text)) {
        return { contract: 'noria_business_result_v1', operation, status: 'ok', data: null, handoff: { required: false, reason: null, message: null } };
      }
      const owner = /\b(?:meu|minha)\s+(?:carro|moto|veiculo)\b/.test(text)
        || /\b(?:meu|minha)\s+[a-z][a-z0-9]*(?:\s+[a-z0-9]+){0,3}\s+(?:19|20)\d{2}\b/.test(text);
      const entry = /\b(?:de|como|na|pela|pra|para)\s+(?:(?:a|uma|parte\s+da)\s+)?entrada\b/.test(text);
      const vehicleMention = owner || /\b(?:moto|carro|veiculo)\b/.test(text);
      const policyQuestion = entry && vehicleMention
        && /\b(?:aceita|aceitam|aceitaria|aceitariam|pega|pegam|recebe|recebem|posso|pode|podem|da\s+pra)\b/.test(text)
        && !/\b(?:quero|queria|vou|pretendo)\b.{0,25}\b(?:dar|da|usar|colocar|trocar)\b/.test(text);
      if (policyQuestion) {
        return {
          contract: 'noria_business_result_v1',
          operation,
          status: 'ok',
          data: { kind: 'policy_inquiry', evidence_ids: current.filter(m => m.id).map(m => m.id), raw_mention: current.map(m => m.text).join('\n') },
          handoff: { required: false, reason: null, message: null },
        };
      }
      const explicit = owner && entry;
      const contextual = owner && payload.prior_pending === 'deposit';
      if (!explicit && !contextual) {
        return { contract: 'noria_business_result_v1', operation, status: 'ok', data: null, handoff: { required: false, reason: null, message: null } };
      }
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: { kind: 'offer', evidence_ids: current.filter(m => m.id).map(m => m.id), raw_mention: current.map(m => m.text).join('\n') },
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'customer.name_progress': {
      const text = payload.text || '';
      const state = payload.state || {};
      const product = payload.product;
      const received = normalizeText(text).replace(/\s+/g, ' ').trim();
      const name = normalizeText(state.customer_name).replace(/\s+/g, ' ').trim();
      if (!product || !name || received !== name) {
        return { contract: 'noria_business_result_v1', operation, status: 'ok', data: { reply: '' }, handoff: { required: false, reason: null, message: null } };
      }
      const reply = '';
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: { reply },
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'commercial.build_context': {
      const text = payload.text || '';
      const offerable = filterOfferableCatalog(inventory, 'all');
      const selection = resolveSelection(text, inventory, payload.catalog_context);
      const auction = evaluateAuctionHandoff(text, payload.state, inventory, selection.product || payload.product, payload.semantic_intent);
      const financing = isFinancingQuestion(text, payload.prior_pending, payload.semantic_intent)
        ? { active: true, reply: formatFinancingReply(text, selection.product || payload.product) }
        : { active: false, reply: null };

      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: {
          offerable_catalog: offerable,
          resolved_selection: selection,
          auction,
          financing,
        },
        handoff: auction.required
          ? { required: true, reason: auction.reason, message: auction.message }
          : { required: false, reason: null, message: null },
      };
    }

    default:
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'error',
        data: null,
        error: `UNKNOWN_OPERATION: ${operation}`,
        handoff: { required: false, reason: null, message: null },
      };
  }
}

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
    financing_collection: {
      enabled: settings.sales?.collect_documents === true,
      required_documents: settings.sales?.required_financing_documents || [],
      require_full_name: true,
      redact_document_values: true,
      source: 'tenant_settings.sales',
    },
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
const snapshotBase = String($env.SUPABASE_URL || '').replace(/\/$/, '');
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
      const turnSemantic = dispatch?.semantic_intent || input.semantic_intent || input.payload?.semantic_intent;
      businessContext.auction = evaluateAuctionHandoff(turnText, dispatch?.commercial_state?.state || input.conversation_state, inventory, effectiveProduct, turnSemantic);
      businessContext.financing = isFinancingQuestion(turnText, dispatch?.commercial_state?.state?.dialogue_context?.pending_requirement || '', turnSemantic)
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
