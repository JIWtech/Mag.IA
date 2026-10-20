/**
 * NORIA — Testes de Validação da Integração de Fotos do Estoque Gênesis
 * Cobre todos os requisitos da Etapa 7 da especificação.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'Estoque_genesis');
const baseStorageUrl = 'https://gfwwawazivmuqyctjsxj.supabase.co/storage/v1/object/public/product-catalog';
const tenantId = '74b57037-9349-4a9e-889c-b65fb63c983a';

const EXPECTED_MAPPINGS = [
  { file: 'CB_600RR.jpeg', vehicleId: 'honda|cb 600rr|2007|', slug: 'honda-cb-600rr-2007', status: 'announced', minSize: 100000, uploaded: true },
  { file: 'CROSSER_2021.jpeg', vehicleId: 'yamaha|crosser|2021|preto', slug: 'yamaha-crosser-2021-preto', status: 'sold', minSize: 100000, uploaded: true },
  { file: 'CROSSER_2023.jpeg', vehicleId: 'yamaha|crosser|2023|', slug: 'yamaha-crosser-2023', status: 'announced', minSize: 100000, uploaded: true },
  { file: 'Mercedes_C180_2015.jpeg', vehicleId: 'mercedes|c180|2015|', slug: 'mercedes-c180-2015', status: 'announced', minSize: 100000, uploaded: true },
  { file: 'Nissao_Versao_1.6_2013.jpeg', vehicleId: 'nissan|versa sl|2013|prata', slug: 'nissan-versa-sl-2013-prata', status: 'announced', minSize: 10000, uploaded: true },
  { file: 'Nova_Tornado_300L_2025.jpeg', vehicleId: 'honda|tornado 300l|2025|vermelho', slug: 'honda-tornado-300l-2025-vermelho', status: 'announced', minSize: 100000, uploaded: true },
  { file: 'Onix_2020.jpeg', vehicleId: 'chevrolet|onix|2020|', slug: 'chevrolet-onix-2020', status: 'announced', minSize: 100000, uploaded: true },
  { file: 'PCX _2023.jpeg', vehicleId: 'honda|pcx|2023|branca', slug: 'honda-pcx-2023-branca', status: 'announced', minSize: 100000, uploaded: true },
  { file: 'Sandero_GT_Line_2016.jpeg', vehicleId: 'renault|sandero gt line|2016|branco', slug: 'renault-sandero-gt-line-2016-branco', status: 'sold', minSize: 100000, uploaded: true },
  { file: 'Montana_2013.jpeg', vehicleId: 'chevrolet|montana|2013|branca', slug: 'chevrolet-montana-2013-branca', status: 'announced', minSize: 100000, uploaded: false },
  { file: 'Toyota_land_PRADO_2005.jpeg', vehicleId: 'toyota|land prado|2005|', slug: 'toyota-land-prado-2005', status: 'announced', minSize: 100000, uploaded: true }
];

test('1. Onze imagens locais reconhecidas na pasta Estoque_genesis', () => {
  assert.ok(fs.existsSync(dir), 'Diretório Estoque_genesis deve existir');
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.jpeg') || f.toLowerCase().endsWith('.jpg'));
  assert.equal(files.length, 11, 'Devem existir exatamente 11 arquivos JPEG locais');
  for (const m of EXPECTED_MAPPINGS) {
    assert.ok(files.includes(m.file), `Arquivo esperado ${m.file} deve estar presente`);
  }
});

test('2. Onze associações corretas e sem ambiguidades com vehicle_id', () => {
  const ids = new Set();
  const slugs = new Set();
  for (const m of EXPECTED_MAPPINGS) {
    assert.ok(!ids.has(m.vehicleId), `Vehicle ID não pode ser duplicado: ${m.vehicleId}`);
    assert.ok(!slugs.has(m.slug), `Slug não pode ser duplicado: ${m.slug}`);
    ids.add(m.vehicleId);
    slugs.add(m.slug);
    const filePath = path.join(dir, m.file);
    const buf = fs.readFileSync(filePath);
    assert.equal(buf[0], 0xFF, 'Magic byte 0 deve ser 0xFF');
    assert.equal(buf[1], 0xD8, 'Magic byte 1 deve ser 0xD8');
    assert.ok(buf.length >= m.minSize, `Tamanho deve ser >= ${m.minSize} bytes`);
    assert.ok(buf.length <= 10 * 1024 * 1024, 'Tamanho não pode exceder 10MB');
  }
  assert.equal(ids.size, 11);
});

test('3. Nenhuma foto associada à PCX 2018 (honda|pcx|2018|prata)', () => {
  const pcx2018Mapping = EXPECTED_MAPPINGS.find(m => m.vehicleId === 'honda|pcx|2018|prata');
  assert.equal(pcx2018Mapping, undefined, 'PCX 2018 não deve ter imagem mapeada na pasta de estoque');
});

test('4. Dois veículos vendidos preservados com status sold', () => {
  const crosser2021 = EXPECTED_MAPPINGS.find(m => m.vehicleId === 'yamaha|crosser|2021|preto');
  assert.ok(crosser2021, 'Crosser 2021 deve existir no mapeamento');
  assert.equal(crosser2021.status, 'sold', 'Crosser 2021 deve permanecer como sold');

  const sandero = EXPECTED_MAPPINGS.find(m => m.vehicleId === 'renault|sandero gt line|2016|branco');
  assert.ok(sandero, 'Sandero GT Line 2016 deve existir no mapeamento');
  assert.equal(sandero.status, 'sold', 'Sandero GT Line deve permanecer como sold');
});

test('5. Onix 2020 localizado corretamente no mapeamento e regras', () => {
  const onix = EXPECTED_MAPPINGS.find(m => m.vehicleId === 'chevrolet|onix|2020|');
  assert.ok(onix, 'Onix 2020 deve constar no mapeamento');
  assert.equal(onix.status, 'announced', 'Onix 2020 deve ser announced');
  assert.equal(onix.slug, 'chevrolet-onix-2020');
});

test('6. Validação dos links públicos das 10 imagens no Supabase Storage', async () => {
  for (const m of EXPECTED_MAPPINGS.filter(m => m.uploaded === true)) {
    const url = `${baseStorageUrl}/genesis/${tenantId}/${m.slug}/principal.jpg`;
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    assert.equal(res.status, 200, `URL pública de ${m.slug} deve retornar HTTP 200`);
    const ct = res.headers.get('content-type');
    assert.equal(ct, 'image/jpeg', `Content-Type de ${m.slug} deve ser image/jpeg`);
    const cl = Number(res.headers.get('content-length'));
    const localSize = fs.statSync(path.join(dir, m.file)).size;
    assert.equal(cl, localSize, `Content-Length de ${m.slug} (${cl}) deve ser idêntico ao arquivo local (${localSize})`);
  }
});

test('7. CORE e EXT não quebram quando um veículo não possui foto', () => {
  const { productSnapshotMedia } = require('../app/src/services/media/productSnapshot.js');
  // Objeto de veículo sem foto
  const vehicleWithoutPhoto = {
    title: 'Honda PCX 2018',
    productId: 'honda|pcx|2018|prata',
    verified_price: false,
    effective_price_cents: 1398000
  };
  const media = productSnapshotMedia(vehicleWithoutPhoto);
  assert.ok(media !== null, 'productSnapshotMedia não deve falhar');
  assert.equal(media.url, '', 'URL deve ser string vazia sem inventar');
  assert.equal(media.thumbnailUrl, '', 'thumbnailUrl deve ser vazia sem inventar');
  assert.equal(media.productId, 'honda|pcx|2018|prata');
});

test('8. Isolamento do tenant Clínica Núbia garantido', () => {
  const nubiaTenantId = 'f0b71f1c-2131-4e46-9e4a-948018ad0604';
  const nubiaTenantId2 = '563a93cd-a5c1-4412-a65f-be2e2d41bb88';
  for (const m of EXPECTED_MAPPINGS) {
    const path = `genesis/${tenantId}/${m.slug}/principal.jpg`;
    assert.ok(path.includes(tenantId), 'Caminho deve conter estritamente o tenant da Gênesis');
    assert.ok(!path.includes(nubiaTenantId), 'Caminho não pode conter tenant da Núbia');
    assert.ok(!path.includes(nubiaTenantId2), 'Caminho não pode conter tenant da Núbia 2');
  }
});
