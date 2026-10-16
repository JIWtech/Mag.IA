const fs = require('fs');
const path = 'd:/Users/gowen/Desktop/MagIA-Projeto-Oficial/n8n/workflows/magia_whatsapp_evolution_mvp.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

let updated = false;
for (const node of data.nodes) {
  if (node.name === 'Normalizar Entrada WhatsApp') {
    let jsCode = node.parameters.jsCode;
    
    // Check if already modified
    if (jsCode.includes('[Produto selecionado do')) {
      console.log('Already modified.');
      updated = true;
      break;
    }

    const target = 'if (!messageText && templateText) messageText = String(templateText).trim();';
    
    const replacement = target + `

if (!messageText && message.productMessage?.product) {
  const p = message.productMessage.product;
  const preco = p.priceAmount1000 ? (Number(p.priceAmount1000) / 1000).toFixed(2) : 'Não informado';
  messageText = \`[Produto selecionado do Catálogo]: \${p.title} (Preço: R$ \${preco})\`;
}

if (messageText && messageText.includes('wa.me/p/')) {
  contentType = 'product';
}`;
    
    if (jsCode.includes(target)) {
      node.parameters.jsCode = jsCode.replace(target, replacement);
      updated = true;
      console.log('Modified successfully.');
    } else {
      console.log('Target string not found in jsCode');
    }
  }
}

if (updated) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
} else {
  console.log('Node Normalizar Entrada WhatsApp not found or target not matched.');
}
