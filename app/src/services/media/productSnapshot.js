import { asObject } from '../../utils/asObject.js';
import { safeProductImageUrl, safeProductThumbnail } from './productImages.js';

export function productSnapshotMedia(snapshot = {}, fallback = {}) {
  const item = asObject(snapshot);
  const reference = asObject(fallback);
  const title = String(item.title || item.name || reference.title || reference.name || '').trim().slice(0, 500);
  const productId = String(item.product_id || item.productId || item.id || reference.product_id || reference.productId || '').trim().slice(0, 220);
  const retailerId = String(item.retailer_id || item.retailerId || item.sku || reference.retailer_id || reference.retailerId || '').trim().slice(0, 220);
  if (!title && !productId && !retailerId) return null;
  const verifiedPrice = item.verified_price === true || item.price_verified === true || /^whatsapp_catalog_/.test(String(item.price_source || ''));
  const rawCurrent = item.current_price_amount_1000 ?? item.price_amount_1000 ?? item.priceAmount1000;
  const rawPrevious = item.previous_price_amount_1000 ?? item.old_price_amount_1000 ?? item.previousPriceAmount1000;
  const toCents = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return verifiedPrice && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9e15 ? Math.round(parsed / 10) : null;
  };
  const validCents = (value) => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value));
  const currentPriceCents = verifiedPrice && validCents(item.effective_price_cents) ? Number(item.effective_price_cents) : toCents(rawCurrent);
  const previousPriceCents = verifiedPrice && validCents(item.regular_price_cents) ? Number(item.regular_price_cents) : toCents(rawPrevious);
  const imageUrl = safeProductImageUrl(item.image_url || item.imageUrl || item.productImage?.url || item.productImage?.imageUrl || item.image_urls?.[0]);
  const thumbnailUrl = safeProductThumbnail(item.thumbnail_base64 || item.jpegThumbnail || item.productImage?.jpegThumbnail);
  return {
    kind: 'product', category: 'product', title, productId, retailerId,
    currency: String(item.currency || item.currencyCode || 'BRL').trim().slice(0, 10),
    currentPriceCents, previousPriceCents,
    verifiedPrice, url: imageUrl, thumbnailUrl,
    priceLabel: verifiedPrice ? (item.price_observed_at || item.synced_at ? 'Preço atualizado do catálogo' : 'Preço confirmado no catálogo') : '',
  };
}
