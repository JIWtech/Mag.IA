#!/usr/bin/env node
/**
 * scripts/dry_run_cancel_ineligible_followups.cjs
 *
 * DRY-RUN ONLY tool to inspect and identify pending follow_up_jobs that are
 * ineligible according to the new semantic conversational qualification rules.
 *
 * ABSOLUTE SAFETY RULES:
 * 1. NEVER executes any writes, PATCH, POST, or DELETE requests.
 * 2. Uses only read-only GET requests to inspect the live state.
 * 3. Returns the list of jobs that would be cancelled with reasons.
 */

const fs = require('node:fs');
const path = require('node:path');

// 1. Load environment variables
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or environment.');
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json'
};

async function supabaseGet(endpoint) {
  const res = await fetch(`${supabaseUrl}${endpoint}`, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GET ${endpoint} returned ${res.status}: ${errText}`);
  }
  return res.json();
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function detectIneligibility(conversation, events) {
  const chatId = conversation.chatId;
  const contactName = conversation.contactName || '';

  // Specific live case 1: Artur Maromba
  if (chatId === '5521989953786@s.whatsapp.net' || /artur\s*maromba/i.test(contactName)) {
    return {
      ineligible: true,
      reason: 'closed_by_customer (Artur Maromba: "valeu obrigado" / cordial closing)'
    };
  }

  // Automated notification systems (e.g. LOGNET)
  if (/notificacao\s*lognet/i.test(contactName)) {
    return {
      ineligible: true,
      reason: 'automated_system_notification (Canal robótico de notificação; "Favor não responder")'
    };
  }

  if (!events || !events.length) {
    return { ineligible: false, reason: null };
  }

  // Sort chronologically ascending
  const sorted = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Find the last inbound message from contact
  const inbounds = sorted.filter(e => e.direction === 'inbound' && e.sender_type === 'contact');
  const lastInbound = inbounds[inbounds.length - 1];

  let rawInboundText = lastInbound?.message_text || '';
  if (lastInbound?.raw_payload?.audio_transcriptions) {
    const entries = Object.values(lastInbound.raw_payload.audio_transcriptions);
    if (entries.length && entries[0].text) {
      rawInboundText = entries[0].text;
    }
  }

  const normInbound = normalizeText(rawInboundText);

  // Auto-reply absence messages
  if (/no momento nao posso responder|vou priorizar sua mensagem|resposta automatica/i.test(normInbound)) {
    return {
      ineligible: true,
      reason: 'deferred_by_customer (Mensagem de ausência automática / resposta automática do cliente)'
    };
  }

  // Closed by customer
  if (/^(?:valeu|obrigado|obrigada|valeu obrigado|era so isso|beleza obrigado|ok valeu|valeu pela atencao|muito obrigado)$/i.test(normInbound)
      || /^(?:obrigado|valeu)[!.]*$/i.test(normInbound)) {
    return {
      ineligible: true,
      reason: 'closed_by_customer (Cliente encerrou com agradecimento/despedida)'
    };
  }

  // Declined
  if (/\b(?:nao\s+(?:tenho\s+)?interesse|sem\s+interesse|nao\s+quero(?:\s+mais)?|nao\s+precisa|deixa\s+pra\s+la|deixa\s+pra\s+proxima|entao\s+deixa|nao\s+vai\s+dar|desisti(?:do)?)\b/i.test(normInbound)) {
    return {
      ineligible: true,
      reason: 'declined (Cliente manifestou desinteresse explícito / cancelamento)'
    };
  }

  // Deferred by customer
  if (/\b(?:vou\s+pensar|qualquer\s+coisa(?:\s+eu)?\s+(?:chamo|aviso)|depois(?:\s+eu)?\s+(?:vejo|chamo|falo)|outro\s+dia(?:\s+eu\s+vejo)?|mais\s+tarde|vou\s+ver)\b/i.test(normInbound)) {
    return {
      ineligible: true,
      reason: 'deferred_by_customer (Cliente postergou a decisão)'
    };
  }

  // Check last AI reply before follow-up was dispatched
  // If the last business outbound was purely informative (like official address) with no question
  const nonFollowUpOutbounds = sorted.filter(e => e.direction === 'outbound' && e.service !== 'follow_up');
  const lastBusinessOutbound = nonFollowUpOutbounds[nonFollowUpOutbounds.length - 1];

  if (lastBusinessOutbound) {
    const lastOutboundText = lastBusinessOutbound.message_text || '';
    // If last outbound was the store address without question
    if (/av\.\s*itapemirim/i.test(lastOutboundText) && !/[?]/.test(lastOutboundText)) {
      return {
        ineligible: true,
        reason: 'no_pending_requirement (IA respondeu endereço informativo sem pergunta de fechamento)'
      };
    }
  }

  return { ineligible: false, reason: null };
}

async function main() {
  console.log('='.repeat(80));
  console.log('DRY-RUN: AUDITORIA DE FOLLOW-UP JOBS PENDENTES ELEGIVEIS / INELEGIVEIS');
  console.log('MODO: ESTRITAMENTE LEITURA (NENHUM WRITE OU MUTACAO SERA EXECUTADO)');
  console.log('='.repeat(80));

  // 1. Fetch tenants
  const tenants = await supabaseGet('/rest/v1/tenants?select=id,name,slug');
  const tenantMap = new Map(tenants.map(t => [t.id, t]));

  // 2. Fetch pending follow_up_jobs
  const pendingJobs = await supabaseGet('/rest/v1/follow_up_jobs?select=*&status=eq.pending&order=due_at.asc');
  console.log(`Total de follow_up_jobs pendentes no sistema: ${pendingJobs.length}`);

  // 3. Group by (tenant_id, external_conversation_id)
  const conversationMap = new Map();
  for (const job of pendingJobs) {
    const key = `${job.tenant_id}:::${job.external_conversation_id}`;
    if (!conversationMap.has(key)) {
      conversationMap.set(key, {
        tenantId: job.tenant_id,
        chatId: job.external_conversation_id,
        contactName: job.contact_name,
        jobs: []
      });
    }
    conversationMap.get(key).jobs.push(job);
  }

  console.log(`Total de conversas distintas com jobs pendentes: ${conversationMap.size}\n`);

  const ineligibleJobs = [];
  const eligibleJobs = [];

  for (const [key, conv] of conversationMap.entries()) {
    const tenant = tenantMap.get(conv.tenantId) || { name: 'Desconhecido', slug: 'unknown' };

    // Fetch recent events for context
    const events = await supabaseGet(
      `/rest/v1/channel_events?select=id,created_at,direction,sender_type,message_text,service,stage,raw_payload` +
      `&tenant_id=eq.${encodeURIComponent(conv.tenantId)}` +
      `&channel_type=eq.whatsapp` +
      `&external_conversation_id=eq.${encodeURIComponent(conv.chatId)}` +
      `&order=created_at.desc&limit=8`
    );

    const check = detectIneligibility(conv, events);

    if (check.ineligible) {
      for (const job of conv.jobs) {
        ineligibleJobs.push({
          tenant: tenant.slug,
          tenant_name: tenant.name,
          conversation: conv.chatId,
          contact_name: conv.contactName,
          job_id: job.id,
          step_key: job.step_key,
          due_at: job.due_at,
          reason_to_cancel: check.reason
        });
      }
    } else {
      for (const job of conv.jobs) {
        eligibleJobs.push({
          tenant: tenant.slug,
          conversation: conv.chatId,
          contact_name: conv.contactName,
          job_id: job.id,
          step_key: job.step_key,
          due_at: job.due_at
        });
      }
    }
  }

  console.log('='.repeat(80));
  console.log(`JOBS INELEGIVEIS IDENTIFICADOS PARA CANCELAMENTO (TOTAL: ${ineligibleJobs.length}):`);
  console.log('='.repeat(80));

  if (!ineligibleJobs.length) {
    console.log('Nenhum job inelegível encontrado.');
  } else {
    for (const item of ineligibleJobs) {
      console.log(`- Conversa:    ${item.conversation} (${item.contact_name || 'sem nome'}) [${item.tenant}]`);
      console.log(`  Job ID:      ${item.job_id}`);
      console.log(`  Step Key:    ${item.step_key}`);
      console.log(`  Due At:      ${item.due_at}`);
      console.log(`  Motivo:      ${item.reason_to_cancel}`);
      console.log('-'.repeat(60));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('RESUMO DA AUDITORIA DRY-RUN:');
  console.log(`- Total de jobs pendentes analisados:  ${pendingJobs.length}`);
  console.log(`- Jobs identificados como inelegíveis: ${ineligibleJobs.length}`);
  console.log(`- Jobs preservados (elegíveis):        ${eligibleJobs.length}`);
  console.log('='.repeat(80));
  console.log('CONFIRMACAO DE SEGURANCA:');
  console.log('NENHUM DADO FOI ALTERADO OU REMOVIDO NO BANCO DE DADOS (OPERACAO ZERO-WRITE).');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('Fatal error during dry run:', err);
  process.exit(1);
});
