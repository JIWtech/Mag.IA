import test from 'node:test';
import assert from 'node:assert/strict';
import { salesFinancingSummary, eventsToKanban } from './dataService.js';
const q={rule:'deposit_30_and_financing_documents_v1',status:'documents_pending',deposit_cents:1500000,minimum_deposit_cents:1500000};
test('Genesis cards distinguish missing documents, insufficient and unknown entry without exposing documents',()=>{
  const lead=status=>({state:{financing_qualification:{...q,status}}});
  assert.match(salesFinancingSummary(lead('documents_pending'),'wesley_automoveis'),/Documenta\u00e7\u00e3o pendente/);
  assert.match(salesFinancingSummary(lead('deposit_insufficient'),'wesley_automoveis'),/abaixo de 30%/);
  assert.match(salesFinancingSummary(lead('deposit_unknown'),'wesley_automoveis'),/n\u00e3o informada/);
  assert.match(salesFinancingSummary(lead('ready'),'wesley_automoveis'),/Entrada e documentos/);
  assert.equal(salesFinancingSummary(lead('ready'),'clinica_nubia_oficial'),'');
  assert.equal(salesFinancingSummary({state:{}},'wesley_automoveis'),'');
  assert.match(salesFinancingSummary({state:{financing_qualification:{...q,deposit_cents:0}}},'wesley_automoveis'),/0,00/);
});
test('persisted hot stage selects the hot column with human control',()=>{
  const event={id:'event',channel_type:'whatsapp',external_conversation_id:'test',direction:'inbound',message_text:'test',created_at:'2026-10-06T10:00:00Z'};
  const lead={id:'lead',channel_type:'whatsapp',chat_id:'test',stage_key:'sales_hot',hot:true,ai_locked:true,
    state:{intent:'buy',financing_qualification:{...q,status:'ready'}}};
  const columns=eventsToKanban([event],'wesley_automoveis',[],{columns:[
    {id:'hot',name:'Leads quentes',automation_key:'sales_hot',position:1},
    {id:'qualifying',name:'Qualificacao',automation_key:'sales_qualifying',position:2},
  ]},[],[lead]);
  const card=columns.find(c=>c.automationKey==='sales_hot').cards[0];
  assert.equal(card.salesHot,true);assert.equal(card.salesAiLocked,true);
  assert.match(card.subtitle,/Entrada e documentos/);
  assert.equal(columns.find(c=>c.automationKey==='sales_qualifying').cards.length,0);
});
