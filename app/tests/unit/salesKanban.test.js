import test from 'node:test';
import assert from 'node:assert/strict';
import {salesBoardEnabled,salesCards} from '../../src/services/kanban/salesKanban.js';
test('commercial board is opt-in and legacy board unchanged',()=>{
  assert.equal(salesBoardEnabled({board:{}}),false);
  assert.equal(salesBoardEnabled({board:{settings:{capability:'sales_v1'}}}),true);
});
test('sales card preserves server revision, stage and no scheduling link',()=>{
  const columns=[{automationKey:'sales_hot',title:'Hot',cards:[]}];
  salesCards(columns,[{id:'lead',revision:5,stage_key:'sales_hot',ai_locked:true,chat_id:'551111@s.whatsapp.net',
    state:{customer_name:'Teste'},product:{name:'Carro',year:2020,color:'Preto'},deposit_cents:1000000,updated_at:'2026-09-30T12:00:00Z'}]);
  assert.equal(columns[0].cards[0].salesRevision,5);
  assert.equal(columns[0].cards[0].hasSchedulingLink,false);
  assert.match(columns[0].cards[0].subtitle,/Entrada/);
});
