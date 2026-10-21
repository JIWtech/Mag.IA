const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// 1. Read sources
const coreSourcePath = path.join(root, 'n8n/sources/noria_core.js');
const extSourcePath = path.join(root, 'n8n/sources/genesis_extension.js');
const genesisIdentitySourcePath = path.join(root, 'n8n/sources/genesis_tenant_identity.js');
let coreCode = fs.readFileSync(coreSourcePath, 'utf8');
const extCode = fs.readFileSync(extSourcePath, 'utf8');
const genesisIdentityCode = fs.readFileSync(genesisIdentitySourcePath, 'utf8');
// The Núbia v2 EXT remains an isolated, inactive workflow for future work; it is no longer embedded in the CORE.
const nubiaExtCode = fs.readFileSync(path.join(root, 'n8n/sources/nubia_extension.js'), 'utf8');
const routerSourceCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_router.js'), 'utf8');
const recoveryCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_recover_core.js'), 'utf8');
const routerCode = fs.readFileSync(path.join(root, 'n8n/code/command_router.js'), 'utf8').replace(/\r\n/g, '\n');
const routerInsertStart = routerCode.indexOf('  async function insertEvent(event) {');
const routerInsertEnd = routerCode.indexOf('  async function loadTenantSettings(', routerInsertStart);
if (routerInsertStart < 0 || routerInsertEnd < 0) throw new Error('CONTROL_ORIGIN_SOURCE_MISSING');
const routerInsertCode = routerCode.slice(routerInsertStart, routerInsertEnd).trimEnd();

// 2. Compute SHA-256 hashes and build metadata
const extSha256 = crypto.createHash('sha256').update(extCode).digest('hex');
const now = new Date();
const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '_');
const coreRevision = `conversation_core_v2_1_34_core_ext_decision_identity_${todayStr}`;
const builtAt = now.toISOString();

// To avoid circular hash dependency, compute coreSha256 over canonical code with fixed placeholder
const normalizedForHash = coreCode.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, 'const coreBuildMetadata = { revision: "", built_at: "", core_sha256: "", ext_sha256: "" };');
const coreSha256 = crypto.createHash('sha256').update(normalizedForHash).digest('hex');

const updatedMetadataBlock = `const coreBuildMetadata = {
  revision: '${coreRevision}',
  built_at: '${builtAt}',
  core_sha256: '${coreSha256}',
  ext_sha256: '${extSha256}',
};`;

coreCode = coreCode.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, updatedMetadataBlock);
fs.writeFileSync(coreSourcePath, coreCode);

// 3. Validate syntax of both sources
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', genesisIdentityCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', nubiaExtCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerSourceCode);
new AsyncFunction('$env', recoveryCode);
new AsyncFunction('$json', '$env', '$vars', routerCode);

// 4. Update workflow JSON files
const targets = [
  ['noria_core.js', 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', 'CORE | Motor conversacional único', "const NORIA_NODE_PHASE = 'single';\n" + coreCode],
  ['noria_core.js', 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', 'CORE | Preparar resposta', "const NORIA_NODE_PHASE = 'prepare';\n" + coreCode],
  ['noria_core.js', 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json', 'CORE | Finalizar resposta', "const NORIA_NODE_PHASE = 'finalize';\n" + coreCode],
  ['genesis_extension.js', 'NORIA EXT _ Gênesis _ Política comercial v2 (1).json', 'EXT | Política Gênesis', extCode],
];

function ensureGenesisTerminalBypass(workflow) {
  const dispatchPrepareName = 'CORE | Preparar dispatch Genesis';
  const dispatchExtensionName = 'CORE | Executar EXT Genesis por turno';
  const prepareName = 'CORE | Preparar resposta';
  const extensionName = 'CORE | Executar EXT Genesis comercial';
  const finalizeName = 'CORE | Finalizar resposta';
  const preDispatchGateName = 'CORE | Turno terminal Genesis?';
  const postPrepareGateName = 'CORE | Turno terminal Genesis após prepare?';
  if (![dispatchPrepareName, dispatchExtensionName, prepareName, extensionName, finalizeName]
    .every(name => workflow.nodes.some(node => node.name === name))) {
    throw new Error('MISSING_GENESIS_TERMINAL_ROUTE_NODE');
  }
  const dispatchPrepareNode = workflow.nodes.find(node => node.name === dispatchPrepareName);
  const claimCall = "const claimResult=await post('rpc/magia_claim_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid});";
  const deploymentPreflight = `// lifecycle-deployment-preflight: read-only and before any claim.
let readiness;
if (!String($env['NORIA_INGRESS_FORWARD_TOKEN_'+String(input.tenant_slug||'').toUpperCase().replace(/[^A-Z0-9]/g,'_')]||'')) throw new Error('TURN_INGRESS_CONFIG_REQUIRED');
try { readiness=await get('rpc/magia_turn_lifecycle_status'); }
catch (error) { throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED:'+String(error?.message||error).slice(0,160)); }
if (readiness?.ready!==true || readiness.contract!=='noria_turn_lifecycle_v1') throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED');
`;
  if (!dispatchPrepareNode.parameters.jsCode.includes('// lifecycle-deployment-preflight:')) {
    if (!dispatchPrepareNode.parameters.jsCode.includes(claimCall)) throw new Error('MISSING_DISPATCH_CLAIM_ANCHOR');
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(claimCall, deploymentPreflight + claimCall);
  }
  if (!dispatchPrepareNode.parameters.jsCode.includes('TURN_INGRESS_CONFIG_REQUIRED')) {
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(
      'let readiness;\ntry {',
      "let readiness;\nif (!String($env['NORIA_INGRESS_FORWARD_TOKEN_'+String(input.tenant_slug||'').toUpperCase().replace(/[^A-Z0-9]/g,'_')]||'')) throw new Error('TURN_INGRESS_CONFIG_REQUIRED');\ntry {"
    );
  }
  const skippedClaim = "if (!claim?.claimed) return {json:{...input,noria_preclaimed_turn:claim,noria_dispatch_phase:'turn',noria_dispatch_skip:'queue_empty'}};";
  const terminalClaim = "if (!claim?.claimed) return {json:{...input,ok:true,skipped:true,noria_terminal:true,reason:String(claim?.reason || 'queue_empty'),noria_preclaimed_turn:claim,noria_dispatch_phase:'turn',noria_dispatch_skip:'queue_empty'}};";
  if (dispatchPrepareNode?.parameters?.jsCode?.includes(skippedClaim)) {
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(skippedClaim, terminalClaim);
  } else if (!dispatchPrepareNode?.parameters?.jsCode?.includes(terminalClaim)) {
    throw new Error('MISSING_GENESIS_PRE_DISPATCH_TERMINALIZATION');
  }
  const lifecycleGuard = "if (claim.contract !== 'noria_turn_lifecycle_v1') throw new Error('TURN_LIFECYCLE_RPC_MISMATCH');";
  if (!dispatchPrepareNode.parameters.jsCode.includes(lifecycleGuard)) {
    const sessionAnchor = "const sessionId=String(claim.boundary_id||'');";
    if (!dispatchPrepareNode.parameters.jsCode.includes(sessionAnchor)) throw new Error('MISSING_DISPATCH_SESSION_ANCHOR');
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(sessionAnchor, lifecycleGuard + '\n' + sessionAnchor);
  }
  const oldDispatchCatch = `} catch (error) {
  // Return the claim through the existing queue contract. This makes a failed
  // pre-dispatch retryable instead of leaving a processing lease behind.
  if (claim?.claimed && String(claim.token||'')) {
    try { await post('rpc/magia_finish_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid,p_token:claim.token,p_outcome:'retry'}); } catch (_) {}
  }
  return {json:{...input,noria_preclaimed_turn:{claimed:false,reason:'dispatch_preparation_failed'},noria_dispatch_phase:'turn',noria_dispatch_skip:'preparation_failed',noria_dispatch_error:{code:'TURN_DISPATCH_PREPARATION_FAILED',retryable:true}}};
}`;
  const safeDispatchCatch = `} catch (error) {
  // turn-dispatch-lifecycle-v1: no blind retry or swallowed persistence error.
  const status=Number(error?.statusCode||error?.response?.status||error?.response?.statusCode||0);
  const retryable=status===429 || (status>=500 && status<=599)
    || ['ETIMEDOUT','ESOCKETTIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(String(error?.code||''));
  let finish={retry_queued:false,finish_persisted:false};
  if (claim?.claimed && String(claim.token||'')) {
    try {
      const result=await post('rpc/magia_fail_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid,p_token:claim.token,p_error:String(error?.message||'dispatch_preparation_failed').slice(0,300),p_retryable:retryable});
      if (result?.finished!==true || result.contract!=='noria_turn_lifecycle_v1') throw new Error('TURN_FAILURE_NOT_PERSISTED');
      finish={...result,finish_persisted:true};
    } catch (finishError) { finish.finish_error=String(finishError?.message||finishError).slice(0,300); }
  }
  return {json:{...input,ok:false,skipped:true,noria_terminal:true,noria_preclaimed_turn:claim||{claimed:false,reason:'dispatch_preparation_failed'},noria_dispatch_phase:'turn',noria_dispatch_skip:'preparation_failed',requires_technical_intervention:finish.retry_queued!==true,noria_dispatch_error:{code:'TURN_DISPATCH_PREPARATION_FAILED',retryable,...finish}}};
}`;
  const diagnosedDispatchCatch = safeDispatchCatch.replace(
    "code:'TURN_DISPATCH_PREPARATION_FAILED',retryable,...finish",
    "code:'TURN_DISPATCH_PREPARATION_FAILED',retryable,message:String(error?.message||error).slice(0,300),...finish"
  );
  if (dispatchPrepareNode.parameters.jsCode.includes(oldDispatchCatch)) {
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(oldDispatchCatch, safeDispatchCatch);
  } else if (!dispatchPrepareNode.parameters.jsCode.includes(safeDispatchCatch)
    && !dispatchPrepareNode.parameters.jsCode.includes(diagnosedDispatchCatch)) {
    throw new Error('MISSING_DISPATCH_FAILURE_LIFECYCLE');
  }
  // Preserve the infrastructure diagnosis instead of reporting queue_empty.
  dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(safeDispatchCatch, diagnosedDispatchCatch);
  const configureTerminalGate = (name, position) => {
    let gate = workflow.nodes.find(node => node.name === name);
    if (!gate) {
      gate = { name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position, parameters: {} };
      workflow.nodes.push(gate);
    }
    gate.parameters = {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: "={{ ($json.noria_terminal === true || $json.skipped === true) && $json.tenant_slug === 'wesley_automoveis' && $json.noria_extension === 'genesis' }}",
          rightValue: true,
          operator: { type: 'boolean', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    };
  };
  configureTerminalGate(preDispatchGateName, [158032, -10624]);
  configureTerminalGate(postPrepareGateName, [158816, -10624]);

  // Separate pre-dispatch and post-prepare gates prevent skipped/debounced
  // turns from reaching either EXT phase without reconnecting the phases.
  workflow.connections[dispatchPrepareName] = { main: [[{ node: preDispatchGateName, type: 'main', index: 0 }]] };
  workflow.connections[preDispatchGateName] = { main: [
    [{ node: finalizeName, type: 'main', index: 0 }],
    [{ node: dispatchExtensionName, type: 'main', index: 0 }],
  ] };
  workflow.connections[dispatchExtensionName] = { main: [[{ node: prepareName, type: 'main', index: 0 }]] };
  workflow.connections[prepareName] = { main: [[{ node: postPrepareGateName, type: 'main', index: 0 }]] };
  workflow.connections[postPrepareGateName] = { main: [
    [{ node: finalizeName, type: 'main', index: 0 }],
    [{ node: extensionName, type: 'main', index: 0 }],
  ] };
  workflow.connections[extensionName] = { main: [[{ node: finalizeName, type: 'main', index: 0 }]] };

  const hasConnection = (from, to, branch) => (workflow.connections[from]?.main?.[branch] || [])
    .some(connection => connection.node === to);
  if (!hasConnection(dispatchPrepareName, preDispatchGateName, 0)
    || !hasConnection(preDispatchGateName, finalizeName, 0)
    || !hasConnection(preDispatchGateName, dispatchExtensionName, 1)
    || !hasConnection(dispatchExtensionName, prepareName, 0)
    || !hasConnection(prepareName, postPrepareGateName, 0)
    || !hasConnection(postPrepareGateName, finalizeName, 0)
    || !hasConnection(postPrepareGateName, extensionName, 1)
    || !hasConnection(extensionName, finalizeName, 0)) {
    throw new Error('INVALID_GENESIS_TERMINAL_ROUTE');
  }
}

const NUBIA_EXT_WORKFLOW_FILE = 'NORIA EXT _ NB Bronze _ Serviços v2.json';
const nubiaV2NodeNames = new Set([
  'CORE | Serviços | Executar EXT bootstrap',
  'CORE | Serviços | Preparar dispatch',
  'CORE | Serviços | Turno terminal?',
  'CORE | Serviços | Preparar resposta',
  'CORE | Serviços | Turno terminal após prepare?',
  'CORE | Serviços | Executar EXT decisão',
  'CORE | Serviços | Verificar disponibilidade',
  'CORE | Serviços | Executar EXT reavaliação',
  'CORE | Serviços | Finalizar resposta',
  'CORE | Serviços | Núbia v2?',
]);

function removeNubiaV2CoreNodes(workflow) {
  const resolver = 'CORE - Resolver extensão do tenant';
  const legacyNext = 'CORE - É Núbia?';
  const resolverNode = workflow.nodes.find(node => node.name === resolver);
  if (!resolverNode) throw new Error('MISSING_ROUTER_NODE');

  workflow.nodes = workflow.nodes.filter(node => !nubiaV2NodeNames.has(node.name));
  for (const nodeName of nubiaV2NodeNames) delete workflow.connections[nodeName];
  for (const entry of Object.values(workflow.connections)) {
    for (const branch of entry?.main || []) {
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        if (nubiaV2NodeNames.has(branch[index].node)) branch.splice(index, 1);
      }
    }
  }
  // Restore the original Núbia v1 route; no tenant can reach v2 from the shared CORE.
  workflow.connections[resolver] = { main: [[{ node: legacyNext, type: 'main', index: 0 }]] };
  if (!workflow.nodes.some(node => node.name === legacyNext)) throw new Error('MISSING_LEGACY_NUBIA_ROUTE');
  if (workflow.nodes.some(node => nubiaV2NodeNames.has(node.name))) throw new Error('NUBIA_V2_CORE_NODES_REMAIN');
}

function deterministicNubiaExtId(name) {
  const h = crypto.createHash('sha1').update('noria-services-pipeline:' + name).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

function writeNubiaV2ExtWorkflow() {
  const target = path.join(root, 'n8n/workflows', NUBIA_EXT_WORKFLOW_FILE);
  const trigger = 'Entrada do NORIA CORE | Núbia serviços v2';
  const policy = 'EXT | Serviços Núbia v2';
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  const workflow = {
    name: 'NORIA EXT | NB Bronze | Serviços v2', pinData: {}, active: false,
    nodes: [
      { parameters: { inputSource: 'passthrough' }, id: previous?.nodes?.find(node => node.name === trigger)?.id || deterministicNubiaExtId(trigger), name: trigger, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [416, -64] },
      { parameters: { jsCode: nubiaExtCode }, id: previous?.nodes?.find(node => node.name === policy)?.id || deterministicNubiaExtId(policy), name: policy, type: 'n8n-nodes-base.code', typeVersion: 2, position: [704, -64] },
    ],
    connections: { [trigger]: { main: [[{ node: policy, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', callerPolicy: 'workflowsFromSameOwner' },
  };
  fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
}

for (const [source, file, prefix, code] of targets) {
  const target = path.join(root, 'n8n/workflows', file);
  const workflow = JSON.parse(fs.readFileSync(target, 'utf8'));
  const nodes = workflow.nodes.filter(n => n.name === prefix || n.name.startsWith(prefix));
  if (nodes.length !== 1) throw new Error('AMBIGUOUS_WORKFLOW_NODE: ' + prefix);
  nodes[0].parameters.jsCode = code;

  if (source === 'genesis_extension.js') {
    const identityNode = workflow.nodes.find(n => n.name === 'Validar identidade e capacidade do tenant');
    if (!identityNode || !identityNode.parameters?.jsCode) throw new Error('MISSING_GENESIS_IDENTITY_NODE');
    identityNode.parameters.jsCode = genesisIdentityCode;
  }

  // If shared core workflow, also update the intake node 'Registrar Mensagem na Fila'
  if (source === 'noria_core.js') {
    // Project only this helper: the existing embedded router has independent
    // local changes and must not be replaced wholesale with another version.
    const commandNode = workflow.nodes.find(n => n.name === 'Executar Comando1');
    const embeddedRouter = commandNode?.parameters?.jsCode?.replace(/\r\n/g, '\n');
    const insertStart = embeddedRouter?.indexOf('  async function insertEvent(event) {') ?? -1;
    const insertEnd = embeddedRouter?.indexOf('  async function loadTenantSettings(', insertStart) ?? -1;
    if (insertStart < 0 || insertEnd < 0) throw new Error('CONTROL_ORIGIN_ROUTER_MISSING');
    commandNode.parameters.jsCode = embeddedRouter.slice(0, insertStart) + routerInsertCode + '\n\n' + embeddedRouter.slice(insertEnd);
    new AsyncFunction('$json', '$env', '$vars', commandNode.parameters.jsCode);
    const recoveryNode = workflow.nodes.find(n => n.name === 'Ler Fila WhatsApp');
    if (!recoveryNode || recoveryNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_TURN_RECOVERY_NODE');
    recoveryNode.parameters.jsCode = recoveryCode;
    const enqueueNode = workflow.nodes.find(n => n.name === 'Registrar Mensagem na Fila');
    if (enqueueNode && enqueueNode.parameters?.jsCode) {
      enqueueNode.parameters.jsCode = enqueueNode.parameters.jsCode.replace(
        /core_revision:\s*'[^']+'/,
        `core_revision: '${coreRevision}'`
      );
    }
    if (prefix === 'CORE | Finalizar resposta') {
      ensureGenesisTerminalBypass(workflow);
      removeNubiaV2CoreNodes(workflow);
    }
  }

  fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
  if (source === 'noria_core.js' && prefix === 'CORE | Motor conversacional único') {
    fs.writeFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), code);
  }
}

writeNubiaV2ExtWorkflow();

// 5. Generate whatsapp_sales.js projection
const ts = require('../app/node_modules/typescript');
const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const sales = ast.statements
  .filter(ts.isFunctionDeclaration)
  .filter(n => /^(sales|runSales|executeCommercial|commercialResult)/.test(n.name.text))
  .map(n => n.getText(ast))
  .join('\n\n');
fs.writeFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), '// NORIA sales source projection; canonical source: n8n/sources/noria_core.js\n' + sales + '\n');

const rawDiskSha256 = crypto.createHash('sha256').update(fs.readFileSync(coreSourcePath, 'utf8')).digest('hex');
const manifest = {
  deployment: {
    contract: 'noria_turn_lifecycle_v1',
    preflight_rpc: 'magia_turn_lifecycle_status',
    migration: 'supabase/migrations_pending_review/turn_queue_lifecycle_v1.sql',
    requires_coordinated_deployment: true,
    production_approved: false,
  },
  core_revision: coreRevision,
  built_at: builtAt,
  core_sha256: coreSha256,
  raw_disk_sha256: rawDiskSha256,
  hash_explanation: 'core_sha256 is the deterministic normalized hash embedded into the runtime code block; raw_disk_sha256 is the direct sha256 of the generated source file on disk after metadata embedding.',
  ext_sha256: extSha256,
  // The EXT identity node filters runtime flags before the policy executes.
  // Its changes must be distinguishable from an unchanged commercial policy.
  ext_identity_sha256: crypto.createHash('sha256').update(genesisIdentityCode).digest('hex'),
  ext_bundle_sha256: crypto.createHash('sha256').update(JSON.stringify({
    identity: genesisIdentityCode, policy: extCode,
  })).digest('hex'),
  recovery_sha256: crypto.createHash('sha256').update(recoveryCode).digest('hex'),
  control_origin_adapter_sha256: crypto.createHash('sha256').update(routerInsertCode).digest('hex'),
  operations_bridge_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'scripts/turn_queue_operational_bridge.cjs'))).digest('hex'),
  artifacts: [
    'n8n/sources/noria_core.js',
    'n8n/sources/genesis_extension.js',
    'n8n/sources/genesis_tenant_identity.js',
    'n8n/sources/nubia_extension.js',
    'n8n/workflows/' + NUBIA_EXT_WORKFLOW_FILE,
    'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json',
    'n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json',
    'n8n/code/whatsapp_conversation_core.generated.js',
    'n8n/code/whatsapp_sales.js',
    'n8n/code/whatsapp_recover_core.js',
    'n8n/code/command_router.js',
    'scripts/turn_queue_operational_bridge.cjs',
  ],
};
fs.writeFileSync(path.join(root, 'n8n/build_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log('Built current NORIA CORE and Genesis EXT from canonical sources.');
console.log('Build manifest:', JSON.stringify(manifest, null, 2));
