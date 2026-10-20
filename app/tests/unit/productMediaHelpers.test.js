import test from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitOutboundMedia } from '../../src/services/media/mediaDirection.js';
import { safeProductImageUrl, safeProductThumbnail } from '../../src/services/media/productImages.js';
import { productSnapshotMedia } from '../../src/services/media/productSnapshot.js';

test('media direction preserves origin, event ID, message ID, and fromMe precedence', () => {
  assert.equal(isExplicitOutboundMedia({ origin: 'manual_reply' }), true);
  assert.equal(isExplicitOutboundMedia({ event_id: 'e1' }, {}, { id: 'e1' }), true);
  assert.equal(isExplicitOutboundMedia({ message_id: 'm1' }, {}, { external_message_id: 'm1' }), true);
  assert.equal(isExplicitOutboundMedia({}, { data: { key: { fromMe: true } } }), true);
  assert.equal(isExplicitOutboundMedia({}, {}, {}), false);
});

test('product image helpers preserve URL filtering, thumbnails, and verified price rules', () => {
  assert.equal(safeProductImageUrl('https://cdn.example.com/car.jpg'), 'https://cdn.example.com/car.jpg');
  assert.equal(safeProductImageUrl('http://cdn.example.com/car.jpg'), '');
  assert.equal(safeProductImageUrl('https://127.0.0.1/car.jpg'), '');
  assert.equal(safeProductThumbnail('AQI='), 'data:image/jpeg;base64,AQI=');
  assert.equal(safeProductThumbnail([0, 1, 2]), 'data:image/jpeg;base64,AAEC');
  assert.equal(safeProductThumbnail([256]), '');
  assert.deepEqual(productSnapshotMedia({ title: 'Carro', price_amount_1000: 199990, verified_price: true, image_url: 'https://cdn.example.com/car.jpg' }), {
    kind: 'product', category: 'product', title: 'Carro', productId: '', retailerId: '', currency: 'BRL', currentPriceCents: 19999, previousPriceCents: null, verifiedPrice: true, url: 'https://cdn.example.com/car.jpg', thumbnailUrl: '', priceLabel: 'Preço confirmado no catálogo',
  });
  assert.equal(productSnapshotMedia({ title: 'Carro', price_amount_1000: 199990 }).currentPriceCents, null);
});
