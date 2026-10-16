const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const targets=[['noria_core.js','NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json','CORE | Motor conversacional'],['genesis_extension.js','NORIA EXT _ Gênesis _ Política comercial v2 (1).json','EXT | Política Gênesis']];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const [source,file,prefix] of targets){
 const code=fs.readFileSync(path.join(root,'n8n/sources',source),'utf8');
 new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code);
 const target=path.join(root,'n8n/workflows',file);const workflow=JSON.parse(fs.readFileSync(target,'utf8'));
 const nodes=workflow.nodes.filter(n=>n.name.startsWith(prefix));if(nodes.length!==1)throw Error('AMBIGUOUS_WORKFLOW_NODE');
 nodes[0].parameters.jsCode=code;fs.writeFileSync(target,JSON.stringify(workflow,null,2)+'\n');
 if(source==='noria_core.js')fs.writeFileSync(path.join(root,'n8n/code/whatsapp_conversation_core.generated.js'),code);
}
console.log('Built current NORIA CORE and Genesis EXT from canonical sources.');

const ts=require('../app/node_modules/typescript');
const core=fs.readFileSync(path.join(root,'n8n/sources/noria_core.js'),'utf8');
const ast=ts.createSourceFile('core.js',core,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const sales=ast.statements.filter(ts.isFunctionDeclaration).filter(n=>/^(sales|runSales|executeCommercial|commercialResult)/.test(n.name.text)).map(n=>n.getText(ast)).join('\n\n');
fs.writeFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'// NORIA sales source projection; canonical source: n8n/sources/noria_core.js\n'+sales+'\n');
