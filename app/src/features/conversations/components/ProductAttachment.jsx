import React from 'react';
import { CircleDollarSign } from 'lucide-react';
import { formatProductPrice } from '../utils/mediaPresentation.js';
import { MediaMeta } from './MediaMeta.jsx';
import { MediaCaption } from './MediaCaption.jsx';

export function ProductAttachment({ media, caption, meta }) {
  const currentPrice = media.verifiedPrice ? formatProductPrice(media.currentPriceCents, media.currency) : '';
  const previousPrice = media.verifiedPrice && media.previousPriceCents > media.currentPriceCents
    ? formatProductPrice(media.previousPriceCents, media.currency)
    : '';
  const image = media.thumbnailUrl || media.url || '';
  return (
    <div className="product-attachment" aria-label={media.title ? `Produto: ${media.title}` : 'Produto compartilhado'}>
      <div className={`product-attachment-image ${image ? 'has-image' : ''}`}>
        {image ? <img src={image} alt="" decoding="async" /> : <CircleDollarSign size={30} aria-hidden="true" />}
      </div>
      <div className="product-attachment-content">
        <strong className="product-attachment-title">{media.title || 'Produto compartilhado'}</strong>
        {previousPrice && <span className="product-attachment-old-price">{previousPrice}</span>}
        {currentPrice && <span className="product-attachment-current-price">{currentPrice}</span>}
        {currentPrice && media.priceLabel && <span className="product-attachment-price-label">{media.priceLabel}</span>}
        {!currentPrice && <span className="product-attachment-price-unavailable">Produto do catálogo</span>}
      </div>
      {caption && <MediaCaption caption={caption} meta={meta} />}
      {!caption && <MediaMeta meta={meta} />}
    </div>
  );
}
