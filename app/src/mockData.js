export const clientStatus = {
  client: 'JIW - Solucoes tecnologicas',
  tenantSlug: 'jiw',
  channel: 'Telegram',
  botUsername: '@jiwtech_bot',
  n8nWorkflow: 'Mag.ia/JIW - Telegram Atendimento MOCK',
  webhookPath: '/webhook/telegram-jiw',
  mode: 'Regras MOCK',
  aiStatus: 'Sem IA paga',
  persistence: 'Supabase pendente',
  publicTunnel: 'Localtunnel temporario',
};

export const tenants = [
  {
    id: 'tenant-jiw',
    name: 'JIW - Solucoes tecnologicas',
    slug: 'jiw',
    industry: 'Tecnologia e servicos digitais',
  plan: 'Piloto',
    channels: ['Telegram', 'Instagram'],
  },
];

export const agents = [
  { id: 'agent-1', name: 'Assistente JIW', type: 'mock', status: 'online', load: 6 },
  { id: 'agent-2', name: 'Equipe JIW', type: 'team', status: 'standby', load: 2 },
  { id: 'agent-3', name: 'Especialista tecnico', type: 'human', status: 'standby', load: 1 },
  { id: 'agent-4', name: 'Comercial JIW', type: 'human', status: 'standby', load: 1 },
];

export const conversations = [
  {
    id: 'conv-jiw-1',
    contact: 'Renata Martins',
    company: 'Comercial Delta',
    channel: 'Telegram',
    status: 'ia_ativa',
    stage: 'Briefing necessario',
    owner: 'Assistente JIW',
    unread: 1,
    lastMessage: 'Preciso criar um sistema para controlar minha equipe comercial.',
    lastAt: 'Agora',
    tags: ['software_house', 'briefing'],
    sentiment: 'positivo',
    value: 18000,
    messages: [
      { from: 'contact', text: 'Oi, voces desenvolvem sistema sob medida?', at: 'Agora' },
      { from: 'ai', text: 'Sim. A JIW pode ajudar com sistemas, dashboards, integracoes e automacoes. Qual processo voce quer controlar?', at: 'Agora' },
      { from: 'contact', text: 'Preciso criar um sistema para controlar minha equipe comercial.', at: 'Agora' },
    ],
    events: ['Mensagem Telegram recebida', 'Servico classificado como software_house', 'Movido para Briefing necessario'],
  },
  {
    id: 'conv-jiw-2',
    contact: 'Eduardo Salles',
    company: 'Loja Norte',
    channel: 'Telegram',
    status: 'atendimento_humano',
    stage: 'Suporte tecnico',
    owner: 'Equipe JIW',
    unread: 0,
    lastMessage: 'Meu computador esta sem internet e preciso de suporte urgente.',
    lastAt: '08:55',
    tags: ['suporte_ti', 'urgente'],
    sentiment: 'neutro',
    value: 450,
    messages: [
      { from: 'contact', text: 'Meu computador esta sem internet e preciso de suporte urgente.', at: '08:55' },
      { from: 'ai', text: 'Certo. Para suporte de TI, me envie o equipamento, impacto e urgencia. Vou encaminhar se for critico. [HUMANO_SOLICITADO]', at: '08:55' },
      { from: 'system', text: 'Conversa movida para Suporte tecnico e atribuida para Equipe JIW.', at: '08:56' },
    ],
    events: ['Urgencia detectada', 'Handoff solicitado', 'Movido para Suporte tecnico'],
  },
  {
    id: 'conv-jiw-3',
    contact: 'Paula Freitas',
    company: 'Studio Paula Freitas',
    channel: 'Telegram',
    status: 'aguardando_cliente',
    stage: 'Qualificacao',
    owner: 'Assistente JIW',
    unread: 0,
    lastMessage: 'Quero trafego pago e social media para minha loja.',
    lastAt: 'Ontem',
    tags: ['trafego_pago', 'social_media'],
    sentiment: 'positivo',
    value: 3200,
    messages: [
      { from: 'contact', text: 'Quero trafego pago e social media para minha loja.', at: 'Ontem' },
      { from: 'ai', text: 'A JIW pode ajudar com campanhas e conteudo. Qual produto voce vende, qual regiao atende e qual objetivo principal?', at: 'Ontem' },
    ],
    events: ['Servico classificado como marketing_digital', 'Movido para Qualificacao'],
  },
  {
    id: 'conv-jiw-4',
    contact: 'Marcos Vieira',
    company: 'MV Consultoria',
    channel: 'Telegram',
    status: 'atendimento_humano',
    stage: 'Orcamento solicitado',
    owner: 'Comercial JIW',
    unread: 0,
    lastMessage: 'Quanto custa para fazer uma landing page?',
    lastAt: 'Segunda',
    tags: ['orcamento', 'landing_page'],
    sentiment: 'positivo',
    value: 2500,
    messages: [
      { from: 'contact', text: 'Quanto custa para fazer uma landing page?', at: 'Segunda' },
      { from: 'ai', text: 'Para preparar um orcamento, preciso entender objetivo, prazo, referencias e dados da empresa. Vou sinalizar um especialista. [HUMANO_SOLICITADO]', at: 'Segunda' },
    ],
    events: ['Pedido de orcamento detectado', 'Oportunidade criada', 'Handoff comercial solicitado'],
  },
  {
    id: 'conv-jiw-5',
    contact: 'Teste Fora de Contexto',
    company: 'Sem empresa',
    channel: 'Telegram',
    status: 'erro',
    stage: 'Fora de contexto',
    owner: 'Assistente JIW',
    unread: 0,
    lastMessage: 'Me passa uma receita de bolo',
    lastAt: 'Teste',
    tags: ['fora_contexto'],
    sentiment: 'neutro',
    value: 0,
    messages: [
      { from: 'contact', text: 'Me passa uma receita de bolo', at: 'Teste' },
      { from: 'ai', text: 'Nao consegui relacionar sua mensagem aos servicos da JIW. Posso ajudar com software, suporte de TI, trafego pago, social media, sites, automacoes ou consultoria digital.', at: 'Teste' },
    ],
    events: ['Fallback acionado', 'Sem movimentacao comercial'],
  },
];

export const kanbanColumns = [
  {
    id: 'novo',
    title: 'Novo contato',
    cards: [
      { id: 'card-1', title: 'Teste Fora de Contexto', subtitle: 'Mensagem fora do escopo', channel: 'Telegram', value: 'R$0', owner: 'Assistente JIW' },
    ],
  },
  {
    id: 'qualificacao',
    title: 'Qualificacao',
    cards: [
      { id: 'card-2', title: 'Paula Freitas', subtitle: 'Trafego pago + social media', channel: 'Telegram', value: 'R$3.200', owner: 'Assistente JIW' },
    ],
  },
  {
    id: 'briefing',
    title: 'Briefing necessario',
    cards: [
      { id: 'card-3', title: 'Renata Martins', subtitle: 'Sistema comercial sob medida', channel: 'Telegram', value: 'R$18.000', owner: 'Assistente JIW' },
    ],
  },
  {
    id: 'suporte',
    title: 'Suporte tecnico',
    cards: [
      { id: 'card-4', title: 'Eduardo Salles', subtitle: 'Internet indisponivel', channel: 'Telegram', value: 'R$450', owner: 'Equipe JIW' },
    ],
  },
  {
    id: 'orcamento',
    title: 'Orcamento solicitado',
    cards: [
      { id: 'card-5', title: 'Marcos Vieira', subtitle: 'Landing page', channel: 'Telegram', value: 'R$2.500', owner: 'Comercial JIW' },
    ],
  },
];

export const funnelStages = [
  { id: 'lead', name: 'Lead recebido', count: 5, value: 24150, conversion: 100 },
  { id: 'diagnostico', name: 'Diagnostico', count: 3, value: 21650, conversion: 60 },
  { id: 'proposta', name: 'Proposta', count: 1, value: 2500, conversion: 20 },
  { id: 'negociacao', name: 'Negociacao', count: 0, value: 0, conversion: 0 },
  { id: 'fechado', name: 'Cliente fechado', count: 0, value: 0, conversion: 0 },
];

export const automationRules = [
  {
    id: 'rule-1',
    name: 'Pedido de orcamento',
    trigger: 'Palavra-chave',
    condition: 'orcamento, proposta, quanto custa, valor ou preco',
    actions: ['Mover para Orcamento solicitado', 'Criar oportunidade', 'Solicitar humano'],
    active: true,
    runs: 4,
  },
  {
    id: 'rule-2',
    name: 'Suporte de TI urgente',
    trigger: 'Palavra-chave',
    condition: 'urgente, fora do ar, sem internet, sistema caiu ou erro',
    actions: ['Mover para Suporte tecnico', 'Solicitar humano'],
    active: true,
    runs: 3,
  },
  {
    id: 'rule-3',
    name: 'Software, site ou automacao',
    trigger: 'Palavra-chave',
    condition: 'sistema, software, site, landing page, automacao, integracao',
    actions: ['Mover para Briefing necessario', 'Classificar software_house'],
    active: true,
    runs: 6,
  },
  {
    id: 'rule-4',
    name: 'Trafego pago e social media',
    trigger: 'Palavra-chave',
    condition: 'trafego, anuncio, instagram, social media, conteudo',
    actions: ['Mover para Qualificacao', 'Classificar marketing_digital'],
    active: true,
    runs: 2,
  },
  {
    id: 'rule-5',
    name: 'Fora de contexto',
    trigger: 'Palavra-chave',
    condition: 'mensagem nao relacionada aos servicos digitais da JIW',
    actions: ['Responder fallback', 'Aplicar tag fora_contexto'],
    active: true,
    runs: 1,
  },
];

export const aiConfig = {
  name: 'Assistente JIW',
  model: 'mock-telegram-dev',
  provider: 'Regras MOCK',
  temperature: 0.35,
  maxTokens: 700,
  activePromptVersion: 1,
  prompt:
    'Atendimento atual sem IA paga. O workflow do n8n usa regras deterministicas para identificar software/site/automacao, suporte de TI, trafego pago, social media, pedido de orcamento, pedido de humano e fora de contexto. Quando ativarmos Gemini/OpenAI, este prompt sera usado como base para o assistente real da JIW.',
  guardrails: [
    'Nao prometer resultado garantido em trafego pago ou social media.',
    'Nao informar preco fechado sem briefing.',
    'Encaminhar para humano em orcamento, contrato ou urgencia tecnica.',
    'Manter foco em tecnologia, suporte de TI e servicos digitais.',
  ],
  tools: ['classificar_servico_mock', 'responder_telegram', 'solicitar_humano_mock', 'mover_kanban_mock'],
};

export const channelAccounts = [
  { id: 'ch-1', name: 'Bot Telegram JIW', type: 'Telegram', status: 'conectado', tenant: 'JIW - Solucoes tecnologicas', messages: 12 },
  { id: 'ch-2', name: 'WhatsApp', type: 'WhatsApp', status: 'nao contratado', tenant: 'JIW - Solucoes tecnologicas', messages: 0 },
  { id: 'ch-3', name: 'Instagram DM JIW', type: 'Instagram', status: 'preparado', tenant: 'JIW - Solucoes tecnologicas', messages: 0 },
  { id: 'ch-4', name: 'WebChat', type: 'WebChat', status: 'planejado', tenant: 'JIW - Solucoes tecnologicas', messages: 0 },
];
