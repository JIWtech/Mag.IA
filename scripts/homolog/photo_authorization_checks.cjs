// Photo authorisation through the real EXT and CORE, with the authorised snapshots (real stock, real image registry metadata) and a
// CANNED model interpretation. It verifies what the EXT/CORE do with a photo request; it says nothing about how Gemini interprets one.
//
//   node scripts/homolog/photo_authorization_checks.cjs
//
// The snapshots live outside the repository (see README_HOMOLOGACAO.md). Without them every check FAILS: nothing is skipped as passed.
// Nothing leaves the process: the provider is simulated, media URLs are recorded and never fetched.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const exec = require('./genesis_executor.cjs');

const dir = process.env.HOMOLOG_SNAPSHOT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.noria-homolog');
const load = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

const ID = { pcx2023: 'honda|pcx|2023|branca', pcx2018: 'honda|pcx|2018|prata', crosserSold: 'yamaha|crosser|2021|preto', montana: 'chevrolet|montana|2013|branca' };

// A canned interpretation of "the customer asks for photos of <product>" (or of nothing specific).
// A canned semantic auditor: it echoes the request's scope key and finds nothing to object to. The auditor itself is a model call and is
// not exercised here. When the EXT authorised attachments, the caption segment names the first one, as the auditor contract asks.
const auditor = body => {
  const input = JSON.parse(body.contents[0].parts[0].text);
  const attachment = (input.attachments || [])[0];
  const segment = attachment
    ? { text: input.reply, kind: 'attachment_caption', attachment: { id: attachment.id, product_id: attachment.product?.id, mode: 'presentation' }, evidence: [] }
    : { text: input.reply, kind: 'non_factual', evidence: [] };
  const report = { scope_key: input.scope_key, complete: true, segments: [segment] };
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(report) }] } }] };
};

function photoRequest(reply, productId) {
  const references = productId
    ? { mentioned_product_ids: [productId], evidence_ids: ['in-1'], product_role: 'asked_info', product_references: [{ product_id: productId, role: 'asked_info', evidence_ids: ['in-1'] }] }
    : { mentioned_product_ids: [], evidence_ids: [], product_role: 'none', product_references: [] };
  return {
    reply, semantic_intent: { primary_intent: 'product_details', topics: ['photos'], confidence: 'high', references },
    dialogue_plan: { requests: [{ id: 'r1', topic: 'photos', subject: productId ? 'specific_product' : 'unspecified' }] },
    // The model states the product it identified, with the inbound event as evidence, as the contract asks. This is the model side only.
    ...(productId ? { state: { product_id: productId, product_evidence: 'in-1' } } : {}),
    // The CORE renumbers request ids and requires each request to be answered with a literal excerpt of the reply.
    response_contract: { answers: [{ request_id: 'request_1', excerpt: reply }] },
  };
}

// buy_interest is an empty-shaped object until a purchase interest is recorded with a product and evidence.
const noInterest = value => !value || (!value.product_id && !(value.evidence_ids || []).length);

async function main() {
  const results = [];
  let settings, inventory, images;
  try { settings = load('genesis_settings_snapshot.json'); inventory = load('genesis_inventory_snapshot.json'); images = load('genesis_images_snapshot.json'); } catch (error) {
    console.log('FAIL snapshots unavailable in ' + dir + ': ' + String(error.message).slice(0, 120));
    process.exitCode = 1; return;
  }
  const run = async (text, gemini, registry = images) => {
    const r = await exec.runScenario({ name: 'photo', turns: [{ text, gemini }], auditor_responses: [auditor, auditor] }, { mode: 'fixtures', geminiKey: null, settings, inventory, images: registry });
    const step = r.steps[0] || {};
    const lead = r.world.tables.sales_leads[0] || null;
    // `ran` is true only when the turn completed normally: a fallback reply or a stopped turn is not evidence that a photo was refused.
    const ran = !step.stopped && step.final?.error_code == null && r.world.log.failures.length === 0;
    return { ran, media: r.world.log.simulated_media.map(item => item.media), product: step.state?.lead_product_id ?? null, interest: step.state?.lead_interest_registered ?? null,
      buy_interest: lead?.state?.buy_interest ?? null, stage: lead?.stage_key ?? null, error: step.final?.error_code ?? step.stopped ?? null, reply: step.state?.outbound_texts?.at(-1) || null, missing: r.missing };
  };
  const expected = id => 'https://homolog-supabase.invalid/storage/v1/object/public/product-catalog/genesis/' + exec.TENANT_ID + '/' + id + '/principal.jpg';
  const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

  const eligible = await run('Queria ver a PCX branca', photoRequest('Segue a foto.', ID.pcx2023));
  check('photo of an identified, eligible vehicle with a registered image is authorised and recorded (never fetched or sent)',
    eligible.ran && eligible.media.length === 1 && eligible.media[0] === expected('honda-pcx-2023-branca'), eligible);
  // The product identified for the photo is remembered as the focus (the model stated it with evidence); it is not a purchase interest.
check('a photo request is not a purchase interest or selection', eligible.ran && eligible.interest === false && noInterest(eligible.buy_interest) && eligible.stage !== 'sales_hot', { interest: eligible.interest, buy_interest: eligible.buy_interest, stage: eligible.stage, focus_product: eligible.product });

  const noRegistry = await run('Queria ver a Montana', photoRequest('Vou conferir.', ID.montana), images.filter(item => item.vehicle_id !== ID.montana));
  check('an eligible vehicle without a registered image gets no photo', noRegistry.ran && noRegistry.media.length === 0, noRegistry);

  const sold = await run('Mostra a Crosser preta aí', photoRequest('Esse já foi vendido.', ID.crosserSold));
  check('a sold vehicle gets no photo even though an image row exists', sold.ran && sold.media.length === 0, sold);

  const unverified = await run('Tem foto da PCX prata?', photoRequest('Preciso confirmar.', ID.pcx2018));
  check('an unverified vehicle (no image row) gets no photo', unverified.ran && unverified.media.length === 0, unverified);

  const unspecified = await run('Tem foto?', photoRequest('De qual veículo?', null));
  check('a photo request with no identified vehicle sends nothing and selects nothing', unspecified.ran && unspecified.media.length === 0 && unspecified.product === '' && noInterest(unspecified.buy_interest), unspecified);

  // The registry is not a way around the settings: with photos disabled for the tenant nothing is authorised.
  const off = JSON.parse(JSON.stringify(settings)); off.sales.vehicle_photos_enabled = false; off.sales.whatsapp_catalog_photo_enabled = false;
  const offRun = await exec.runScenario({ name: 'photo-off', turns: [{ text: 'Queria ver a PCX branca', gemini: photoRequest('Segue.', ID.pcx2023) }], auditor_responses: [auditor, auditor] }, { mode: 'fixtures', geminiKey: null, settings: off, inventory, images });
  const offStep = offRun.steps[0] || {};
  check('photos disabled in the tenant settings authorise nothing despite the registry', !offStep.stopped && offStep.final?.error_code == null && offRun.world.log.simulated_media.length === 0, { media: offRun.world.log.simulated_media.length });

  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed += 1;
    console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name);
    if (!item.ok) console.log('       ' + JSON.stringify(item.detail).slice(0, 600));
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' photo authorisation checks pass.');
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });
