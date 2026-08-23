const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', 'n8n', 'workflows', 'magia_telegram_multitenant_v4_3_2_media_context_hidden.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = workflow.nodes.find((item) => item.name === 'Processar Tenant e Responder' && item.parameters?.jsCode);
if (!node) throw new Error('Nó "Processar Tenant e Responder" não encontrado.');

const replacements = [
  {
    old: 'async function callGemini(context, classification, fallback, history, catalog, appointments) {',
    next: 'async function callGemini(context, classification, fallback, history, catalog, appointments, currentMedia = {}) {',
  },
  {
    old: "  const appointmentContext = JSON.stringify({\n",
    next: "  const currentMediaDescription = String(currentMedia?.extracted_text || '').trim();\n  const currentMediaContext = currentMediaDescription\n    ? `\\nMÍDIA ATUAL (contexto confiável produzido pelo sistema):\\n${currentMediaDescription}\\n`\n    : '';\n\n  const appointmentContext = JSON.stringify({\n",
  },
  {
    old: "STATUS DE AGENDAMENTO:\n${appointmentContext}\n\nREGRAS DE CONVERSA:",
    next: "STATUS DE AGENDAMENTO:\n${appointmentContext}\n${currentMediaContext}\nREGRAS DE CONVERSA:",
  },
  {
    old: '- Se a pessoa mandar uma imagem sem legenda, responda diretamente ao conteúdo relevante da imagem de forma natural.',
    next: '- Se houver MÍDIA ATUAL e a pessoa não enviar legenda, a primeira frase DEVE mencionar naturalmente pelo menos um elemento concreto da descrição visual. Resposta comercial genérica sem referência à mídia é inválida.\n- Se a pessoa mandar uma imagem sem legenda, responda diretamente ao conteúdo relevante da imagem de forma natural.',
  },
  {
    old: "        catalog,\n        appointments\n      );",
    next: "        catalog,\n        appointments,\n        mediaProcessing\n      );",
  },
];

let code = node.parameters.jsCode;
for (const { old, next } of replacements) {
  if (code.includes(next)) continue;
  if (!code.includes(old)) throw new Error(`Âncora não encontrada: ${old.slice(0, 70)}`);
  code = code.replace(old, next);
}
node.parameters.jsCode = code;
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(`Updated ${workflowPath}`);
