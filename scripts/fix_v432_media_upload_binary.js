const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', 'n8n', 'workflows', 'magia_telegram_multitenant_v4_3_2_media_context_hidden.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = workflow.nodes.find((item) => item.name === 'Processar Tenant e Responder' && item.parameters?.jsCode);
if (!node) throw new Error('Nó "Processar Tenant e Responder" não encontrado.');

const oldBlock = String.raw`    await helpers.httpRequest({
      method: 'POST',
      url: supabaseUrl('/storage/v1/object/' + encodeURIComponent(bucket) + '/' + path),
      headers: {
        apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
        'Content-Type': base.mimeType,
        'x-upsert': 'true',
      },
      body: Buffer.from(downloaded.base64, 'base64'),
      json: false,
      timeout: 45000,
    });`;

const newBlock = String.raw`    const uploadResponse = await fetch(
      supabaseUrl('/storage/v1/object/' + encodeURIComponent(bucket) + '/' + path),
      {
        method: 'POST',
        headers: {
          apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
          Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
          'Content-Type': base.mimeType,
          'x-upsert': 'true',
        },
        body: Buffer.from(downloaded.base64, 'base64'),
      },
    );
    if (!uploadResponse.ok) {
      throw new Error('Falha no upload para Storage: HTTP ' + uploadResponse.status + ' ' + (await uploadResponse.text()).slice(0, 180));
    }`;

if (node.parameters.jsCode.includes(newBlock)) {
  console.log('Workflow já usa upload binário. Nenhuma alteração feita.');
  process.exit(0);
}
if (!node.parameters.jsCode.includes(oldBlock)) {
  throw new Error('Bloco de upload esperado não encontrado no workflow.');
}
node.parameters.jsCode = node.parameters.jsCode.replace(oldBlock, newBlock);
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(`Updated ${workflowPath}`);
