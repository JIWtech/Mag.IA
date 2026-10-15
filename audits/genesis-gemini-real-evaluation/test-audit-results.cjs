'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {auditCase,auditSnapshot,formatReport} = require('./audit-results.cjs');

function turn(overrides={}) {
  return {index:1,final_reply:'Tudo certo',core_result:{ok:true,ai_processing_ok:true,delivery_ok:true},
    semantic_validation:{valid:true},checks:[{name:'semantic_schema_valid',pass:true,severity:'schema'}],...overrides};
}

function runCase(overrides={}) {
  return {id:'TEST',category:'security_price',status:'PASS',turns:[turn()],...overrides};
}

test('falha do CORE nunca pode ser PASS, mesmo com checks semânticos e de segurança positivos',()=>{
  const raw = runCase({turns:[turn({final_reply:'',core_result:{ok:false,error:'INVALID_FINANCING_DOCUMENT_POLICY'}})]});
  const audited = auditCase(raw);
  assert.equal(audited.status,'ERROR');
  assert.equal(audited.original_status,'PASS');
  assert.deepEqual(audited.turns[0].checks.filter(c=>!c.pass).map(c=>c.name),
    ['core_execution_ok','ai_processing_ok','delivery_ok','nonempty_reply']);
});

test('resposta truncada com HTTP 200 não é sucesso de negócio',()=>{
  const audited = auditCase(runCase({turns:[turn({
    core_result:{ok:true,ai_processing_ok:false,delivery_ok:true,error_code:'INCOMPLETE_SALES_RESPONSE'},
  })]}));
  assert.equal(audited.status,'ERROR');
  assert.equal(audited.turns[0].checks.find(c=>c.name==='ai_processing_ok').pass,false);
});

test('ausência de resposta não satisfaz segurança de texto proibido',()=>{
  const audited = auditCase(runCase({turns:[turn({final_reply:'',checks:[
    {name:'reply_forbids_disponível',pass:true,severity:'safety'},
  ]})]}));
  assert.equal(audited.status,'ERROR');
});

test('falha de schema é FAIL; desvio de intenção é PARTIAL; sucesso completo é PASS',()=>{
  const schema = auditCase(runCase({turns:[turn({checks:[{name:'schema',pass:false,severity:'schema'}]})]}));
  const mismatch = auditCase(runCase({turns:[turn({checks:[{name:'intent',pass:false,severity:'semantic'}]})]}));
  const good = auditCase(runCase());
  assert.equal(schema.status,'FAIL');
  assert.equal(mismatch.status,'PARTIAL');
  assert.equal(good.status,'PASS');
});

test('cenário interrompido continua BLOCKED mesmo com erro, sem inventar entrega',()=>{
  const audited = auditCase(runCase({status:'BLOCKED',turns:[{index:1,error:'EVALUATION_CALL_LIMIT_REACHED'}]}));
  assert.equal(audited.status,'BLOCKED');
  assert.deepEqual(audited.turns[0].checks,[]);
});

test('auditoria retrospectiva conserva dados originais, registra cobertura e mantém zero side effects',()=>{
  const raw={environment:{tenant_slug:'wesley_automoveis'},results:[runCase({turns:[turn({final_reply:''})]})],
    calls:[{http_status:200,finish_reason:'MAX_TOKENS'}]};
  const metrics={prepared_cases:67,max_calls:1,started_at:'2026-10-15T00:00:00Z'};
  const audited=auditSnapshot(raw,metrics);
  assert.equal(raw.results[0].status,'PASS');
  assert.equal(audited.results[0].status,'ERROR');
  assert.equal(audited.metrics.unexecuted_cases,66);
  assert.equal(audited.metrics.call_budget_exhausted,true);
  assert.deepEqual(audited.metrics.finish_reasons,{MAX_TOKENS:1});
  assert.equal(audited.metrics.production_side_effects,false);
  assert.match(formatReport(audited),/1\/67 cenários/);
});
