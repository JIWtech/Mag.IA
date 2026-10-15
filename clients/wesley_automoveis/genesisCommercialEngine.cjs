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
  if (rowOrText && typeof rowOrText === 'object') {
    const category = normalizeText(rowOrText.category);
    if (category === 'motorcycle') return true;
    if (category === 'car') return false;
  }
  const text = typeof rowOrText === 'string'
    ? rowOrText
    : [rowOrText?.brand, rowOrText?.model].filter(Boolean).join(' ');
  const norm = normalizeText(text);
  return /\b(?:pcx|crosser|tornado|cb\s*600rr|cb\s*600\s*rr|cb\s*500|cb\s*300|cg\s*160|factor|fazer|yamaha\s*r3|xj6|z400|mt-?03|biz|pop\s*110|bros|motos?|motocicletas?|scooters?)\b/.test(norm);
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
    const category = normalizeText(row?.category);
    if (!id || ids.has(id) || !statusObj || !brand || !model || !Number.isInteger(year)
      || !['motorcycle','car'].includes(category) || (cents !== null && (!Number.isSafeInteger(cents) || cents <= 0))) {
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

function classifyCatalogAudience(text = '') {
  const norm = normalizeText(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(?:motos?|motocicletas?|scooters?)\b/.test(norm)) return 'motorcycles';
  if (/\b(?:carros?|automoveis?)\b/.test(norm)) return 'cars';
  return 'all';
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
  const audience = ['all', 'motorcycles', 'cars'].includes(audienceOrText)
    ? audienceOrText
    : classifyCatalogAudience(audienceOrText);

  if (audience === 'all') return offerable;
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
  const offerable = filterOfferableCatalog(inventory, 'all');
  const pool = products.length ? products.filter(Boolean) : offerable;

  const matches = [];
  for (const item of pool) {
    const modelNorm = normalizeText(item.model);
    const brandNorm = normalizeText(item.brand);
    const nameNorm = normalizeText(item.name || item.commercial_name);
    const modelTokens = modelNorm.split(/\s+/).filter(token => token.length >= 3);

    // Exact or keyword match
    // Empty optional display fields must never match every input (`text.includes('')`).
    // The authoritative parser always provides model, but tolerate a persisted
    // catalog snapshot that only has a stable id or partial display data.
    if ((nameNorm && normText.includes(nameNorm)) || (modelNorm && normText.includes(modelNorm))) {
      matches.push(item);
    } else if (normText.includes('cb') && (modelNorm.includes('cb') || modelNorm.includes('600rr'))) {
      matches.push(item);
    } else if (normText.includes('crosser') && modelNorm.includes('crosser')) {
      matches.push(item);
    } else if (normText.includes('sandero') && modelNorm.includes('sandero')) {
      matches.push(item);
    } else if (normText.includes('pcx') && modelNorm.includes('pcx')) {
      matches.push(item);
    } else if (/\b(?:motos?|motocicletas?)\b/.test(normText) && isMotorcycle(item)) {
      matches.push(item);
    } else if (/\b(?:carros?|automoveis?)\b/.test(normText) && !isMotorcycle(item)) {
      matches.push(item);
    } else if (modelTokens.some(token => new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(normText))) {
      // A short natural reference such as "esse Versa" can be sufficient only
      // when it leaves exactly one candidate after the ambiguity check below.
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
function classifyAuctionIntent(text = '', state = {}, inventory = [], currentProduct = null) {
  const norm = normalizeText(text);
  const auctionMentioned = /\b(?:leilao|leiloado)\b/.test(norm);
  const sinistroMentioned = /\b(?:sinistro|batido|recuperado)\b/.test(norm);

  if (!auctionMentioned && !sinistroMentioned) return null;

  // Rejection of auction vehicle: "Não quero carro de leilão", "Não aceito leilão"
  const isRejection = /(?:\bnao\s+(?:e|foi)\s+(?:de\s+)?leilao\b|\bnao\s+quero\b|\bnunca\s+foi\s+leiloado\b|\bsem\s+leilao\b)/.test(norm);
  if (isRejection) {
    return {
      intent: 'rejection',
      reason: 'auction_rejection',
      handoff_required: false,
      origin: 'none',
    };
  }

  // Sinistro mentioned without auction: not treated as auction
  if (!auctionMentioned && sinistroMentioned) {
    return {
      intent: 'sinistro_inquiry',
      reason: 'sinistro_check',
      handoff_required: false,
      origin: 'customer',
    };
  }

  // Customer offers customer vehicle or asks if Wesley buys auction vehicles:
  const isCustomerVehicle = /(?:\b(?:voce|voces|vcs)\s+(?:compram|pegam|aceitam)\b|\b(?:meu|minha)\s+(?:carro|veiculo|moto)\b|\b(?:quero|pretendo)\s+vender\b|\b(?:aceitam|pegam|compram)\s+(?:carro|veiculo|moto)\s+de\s+leilao\b)/.test(norm);
  if (isCustomerVehicle) {
    return {
      intent: 'customer_vehicle_offer',
      reason: 'auction_vehicle_purchase',
      handoff_required: true,
      origin: 'customer',
      message: 'Sim, a Gênesis compra veículos de leilão mediante avaliação. Vou encaminhar seu caso para a equipe seguir com você.',
    };
  }

  // Customer asks about dealer stock vehicle:
  const productKey = (row) => row?.id || [row?.brand, row?.model, row?.year, row?.color].map(x => String(x || '').toLowerCase()).join('|');
  const targetProdId = state?.product_id || (typeof currentProduct === 'string' ? currentProduct : currentProduct?.id);
  const product = (currentProduct && typeof currentProduct === 'object') ? currentProduct
    : ((targetProdId ? inventory.find(row => productKey(row) === targetProdId) : null)
        || (norm ? resolveSelection(norm, inventory).product : null));
  const isInterest = !!product && /(?:\btenho\s+interesse\b|\bquero\s+(?:esse|este)\b|\bcomprar\s+(?:esse|este)\b)/.test(norm);
  if (isInterest) {
    return {
      intent: 'inventory_interest',
      reason: 'auction_inventory_interest',
      handoff_required: true,
      origin: 'inventory',
      product,
      message: 'Entendi seu interesse nesse veículo. Vou pedir para a equipe confirmar o histórico de leilão e as condições da negociação.',
    };
  }

  const isHistoryQuestion = /(?:\b(?:passou|foi|era|tem)\b.{0,32}\b(?:leilao|leiloado)\b|\bhistorico\b)/.test(norm);
  if (product && isHistoryQuestion) {
    const obsNorm = normalizeText(product.observations || '');
    const documented = /\b(?:leilao|leiloado|sinistro\s+de\s+leilao)\b/.test(obsNorm);
    return {
      intent: 'inventory_history',
      reason: 'auction_inventory_history',
      handoff_required: true,
      origin: 'inventory',
      product,
      inventory_history: {
        documented,
        observation: documented ? (product.observations || '') : '',
      },
      message: documented
        ? 'Na ficha desse veículo consta histórico de leilão. Vou encaminhar para a equipe confirmar os detalhes com você.'
        : 'Não tenho essa informação confirmada na ficha do veículo. Vou encaminhar para a equipe verificar com você.',
    };
  }

  return {
    intent: 'unclear',
    reason: 'auction_intent_unclear',
    handoff_required: true,
    origin: product ? 'inventory' : 'unknown',
    product,
    message: 'Entendi sua dúvida sobre leilão. Vou encaminhar para a equipe confirmar esse detalhe com você.',
  };
}

function evaluateAuctionHandoff(text = '', state = {}, inventory = [], currentProduct = null) {
  const classification = classifyAuctionIntent(text, state, inventory, currentProduct);
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
function isFinancingQuestion(text = '', priorPending = '') {
  const norm = normalizeText(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return false;
  const isGeneral = /\b(?:financiam|financiamento|fazem\s+financiamento|como\s+(?:funciona|e)\s+o\s+financiamento|aceita\s+financiar|trabalha\s+com\s+financiamento)\b/.test(norm);
  const minimum = /\b(?:minimo|menor|menor\s+valor|quanto\s+(?:precisa|seria|fica)|qual\s+(?:seria|e|o)\s+(?:valor|minimo)|a\s+partir\s+de\s+quanto)\b/.test(norm);
  const deposit = /\b(?:entrada|sinal)\b/.test(norm);
  const installments = /\b(?:parcelas?|prestac(?:ao|oes)|juros|taxa\s+de\s+financiamento)\b/.test(norm);
  const questioning = /\b(?:qual|quais|quanto|quantas|como|simulacao|simular|fica|seria|valor|taxa|minimo|menor)\b/.test(norm);

  return isGeneral || (deposit && minimum) || (installments && questioning)
    || (priorPending === 'deposit' && minimum && !/\b(?:vou\s+dar|tenho|pretendo\s+dar|quero\s+dar)\b/.test(norm));
}

function formatFinancingReply(text = '', product = null) {
  const norm = normalizeText(text);
  if (/\b(?:financiam|fazem\s+financiamento|como\s+(?:funciona|e)\s+o\s+financiamento|trabalha\s+com\s+financiamento)\b/.test(norm)) {
    return 'Trabalhamos com financiamento, sujeito à análise da financeira\nQuanto você pretende dar de entrada?';
  }
  return 'A entrada mínima e as parcelas dependem da análise da financeira\nQuer que o Wesley confira uma simulação pra você?';
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
      const filtered = payload.semantic_catalog
        ? filterCatalogBySemantic(inventory, payload.semantic_catalog)
        : { items: filterOfferableCatalog(inventory, payload.query || payload.audience || 'all'), applied: [], unsupported: [], requires_clarification: false };
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: { ...filtered, count: filtered.items.length },
        handoff: { required: false, reason: null, message: null },
      };
    }

    case 'auction.classify_intent': {
      const classification = classifyAuctionIntent(payload.text, payload.state, inventory, payload.product);
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
      const handoff = evaluateAuctionHandoff(payload.text, payload.state, inventory, payload.product);
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
      const isFin = isFinancingQuestion(payload.text, payload.prior_pending);
      const reply = isFin ? formatFinancingReply(payload.text, payload.product) : null;
      return {
        contract: 'noria_business_result_v1',
        operation,
        status: 'ok',
        data: {
          is_financing_question: isFin,
          reply,
          pending_requirement: isFin && !payload.product ? 'deposit' : '',
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
      let reply = '';
      if (state.payment_mode === 'financing') {
        if (state.deposit_cents === null || state.deposit_cents === undefined) {
          reply = 'Obrigado, ' + state.customer_name + '! Quanto você pretende dar de entrada?';
        }
      } else {
        reply = 'Obrigado, ' + state.customer_name + '! Você pretende pagar à vista ou financiar?';
      }
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
      const auction = evaluateAuctionHandoff(text, payload.state, inventory, selection.product || payload.product);
      const financing = isFinancingQuestion(text, payload.prior_pending)
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

module.exports = {
  normalizeText,
  parsePrice,
  parseBrazilianCurrency,
  formatCommercialName,
  normalizeStatus,
  parseSheetValues,
  isMotorcycle,
  classifyCatalogAudience,
  filterOfferableCatalog,
  commercialEligibility,
  filterCatalogBySemantic,
  parseCatalogOrdinal,
  resolveSelection,
  classifyAuctionIntent,
  evaluateAuctionHandoff,
  isFinancingQuestion,
  formatFinancingReply,
  loadInventory,
  parseSupabaseInventoryRows,
  loadSupabaseInventory,
  executeBusinessOperation,
};
