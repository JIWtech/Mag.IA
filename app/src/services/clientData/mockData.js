export const clientStatus = {
  client: 'JIW - Soluções Tecnológicas',
  tenantSlug: 'jiw',
  channel: 'Telegram',
  botUsername: '@jiwtech_bot',
  n8nWorkflow: 'NORIA - Telegram Atendimento',
  webhookPath: '/webhook/telegram-jiw',
  mode: 'Regras de Automação',
  aiStatus: 'Sem IA paga',
  persistence: 'Supabase configurado',
  publicTunnel: 'Túnel local ativo',
};

export const tenants = [
  {
    id: 'clinica_nubia',
    name: 'Clínica Núbia',
    slug: 'clinica_nubia',
    industry: 'Saúde e Estética',
    plan: 'Piloto',
    channels: ['Telegram'],
  },
  {
    id: 'tenant-jiw',
    name: 'JIW - Soluções Tecnológicas',
    slug: 'jiw',
    industry: 'Tecnologia e serviços digitais',
    plan: 'Piloto',
    channels: ['Telegram', 'Instagram'],
  },
];


export const agents = [
  { id: 'agent-1', name: 'Assistente JIW', type: 'mock', status: 'online', load: 6 },
  { id: 'agent-2', name: 'Equipe JIW', type: 'team', status: 'standby', load: 2 },
  { id: 'agent-3', name: 'Especialista técnico', type: 'human', status: 'standby', load: 1 },
  { id: 'agent-4', name: 'Comercial JIW', type: 'human', status: 'standby', load: 1 },
];

export const conversations = [
  {
    id: 'conv-jiw-1',
    contact: 'Renata Martins',
    company: 'Comercial Delta',
    channel: 'Telegram',
    status: 'ia_ativa',
    stage: 'Briefing necessário',
    owner: 'Assistente JIW',
    unread: 1,
    lastMessage: 'Preciso criar um sistema para controlar minha equipe comercial.',
    lastAt: 'Agora',
    tags: ['software_house', 'briefing'],
    sentiment: 'positivo',
    value: 18000,
    messages: [
      { from: 'contact', text: 'Oi, vocês desenvolvem sistema sob medida?', at: 'Agora' },
      { from: 'ai', text: 'Sim. A JIW pode ajudar com sistemas, dashboards, integrações e automações. Qual processo você quer controlar?', at: 'Agora' },
      { from: 'contact', text: 'Preciso criar um sistema para controlar minha equipe comercial.', at: 'Agora' },
    ],
    events: ['Mensagem Telegram recebida', 'Serviço classificado como software_house', 'Movido para Briefing necessário'],
  },
  {
    id: 'conv-jiw-2',
    contact: 'Eduardo Salles',
    company: 'Loja Norte',
    channel: 'Telegram',
    status: 'atendimento_humano',
    stage: 'Suporte técnico',
    owner: 'Equipe JIW',
    unread: 0,
    lastMessage: 'Meu computador está sem internet e preciso de suporte urgente.',
    lastAt: '08:55',
    tags: ['suporte_ti', 'urgente'],
    sentiment: 'neutro',
    value: 450,
    messages: [
      { from: 'contact', text: 'Meu computador está sem internet e preciso de suporte urgente.', at: '08:55' },
      { from: 'ai', text: 'Certo. Para suporte de TI, me envie o equipamento, impacto e urgência. Vou encaminhar para um especialista. [HUMANO_SOLICITADO]', at: '08:55' },
      { from: 'system', text: 'Conversa movida para Suporte técnico e atribuída para Equipe JIW.', at: '08:56' },
    ],
    events: ['Urgência detectada', 'Transferência solicitada', 'Movido para Suporte técnico'],
  },
  {
    id: 'conv-jiw-3',
    contact: 'Paula Freitas',
    company: 'Studio Paula Freitas',
    channel: 'Telegram',
    status: 'aguardando_cliente',
    stage: 'Qualificação',
    owner: 'Assistente JIW',
    unread: 0,
    lastMessage: 'Quero tráfego pago e social media para minha loja.',
    lastAt: 'Ontem',
    tags: ['trafego_pago', 'social_media'],
    sentiment: 'positivo',
    value: 3200,
    messages: [
      { from: 'contact', text: 'Quero tráfego pago e social media para minha loja.', at: 'Ontem' },
      { from: 'ai', text: 'A JIW pode ajudar com campanhas e conteúdo. Qual produto você vende, qual região atende e qual o objetivo principal?', at: 'Ontem' },
    ],
    events: ['Serviço classificado como marketing_digital', 'Movido para Qualificação'],
  },
  {
    id: 'conv-jiw-4',
    contact: 'Marcos Vieira',
    company: 'MV Consultoria',
    channel: 'Telegram',
    status: 'atendimento_humano',
    stage: 'Orçamento solicitado',
    owner: 'Comercial JIW',
    unread: 0,
    lastMessage: 'Quanto custa para fazer uma landing page?',
    lastAt: 'Segunda',
    tags: ['orcamento', 'landing_page'],
    sentiment: 'positivo',
    value: 2500,
    messages: [
      { from: 'contact', text: 'Quanto custa para fazer uma landing page?', at: 'Segunda' },
      { from: 'ai', text: 'Para preparar um orçamento, preciso entender objetivo, prazo, referências e dados da empresa. Vou sinalizar um especialista. [HUMANO_SOLICITADO]', at: 'Segunda' },
    ],
    events: ['Pedido de orçamento detectado', 'Oportunidade criada', 'Transferência comercial solicitada'],
  },
  {
    id: 'conv-jiw-5',
    contact: 'Atendimento Geral',
    company: 'Contato Geral',
    channel: 'Telegram',
    status: 'erro',
    stage: 'Fora de contexto',
    owner: 'Assistente JIW',
    unread: 0,
    lastMessage: 'Gostaria de tirar uma dúvida sobre serviços.',
    lastAt: 'Hoje',
    tags: ['fora_contexto'],
    sentiment: 'neutro',
    value: 0,
    messages: [
      { from: 'contact', text: 'Gostaria de tirar uma dúvida sobre serviços.', at: 'Hoje' },
      { from: 'ai', text: 'Olá! A JIW atua com desenvolvimento de software, suporte de TI, tráfego pago, mídias sociais, sites institucionais, automações e consultoria digital. Como podemos te ajudar hoje?', at: 'Hoje' },
    ],
    events: ['Mensagem inicial', 'Aguardando detalhamento'],
  },
];

export const kanbanColumns = [
  {
    id: 'novas_conversas',
    title: 'Novas conversas',
    automationKey: 'novas_conversas',
    cards: [
      { id: 'card-1', title: 'Atendimento Geral', subtitle: 'Aguardando detalhamento', channel: 'Telegram', value: 'R$ 0', owner: 'Assistente JIW' },
    ],
  },
  {
    id: 'conversas_andamento',
    title: 'Conversas em andamento',
    automationKey: 'conversas_andamento',
    cards: [
      { id: 'card-2', title: 'Paula Freitas', subtitle: 'Tráfego pago e social media', channel: 'Telegram', value: 'R$ 3.200', owner: 'Assistente JIW' },
      { id: 'card-3', title: 'Renata Martins', subtitle: 'Sistema comercial sob medida', channel: 'Telegram', value: 'R$ 18.000', owner: 'Assistente JIW' },
    ],
  },
  {
    id: 'conversas_humanos',
    title: 'Conversas com humanos',
    automationKey: 'conversas_humanos',
    cards: [
      { id: 'card-4', title: 'Eduardo Salles', subtitle: 'Suporte urgente solicitado', channel: 'Telegram', value: 'R$ 450', owner: 'Equipe JIW' },
      { id: 'card-5', title: 'Marcos Vieira', subtitle: 'Landing page e captação', channel: 'Telegram', value: 'R$ 2.500', owner: 'Comercial JIW' },
    ],
  },
  {
    id: 'agendamentos',
    title: 'Agendamentos',
    automationKey: 'agendamentos',
    cards: [],
  },
];

export const funnelStages = [
  { id: 'lead', name: 'Lead recebido', count: 5, value: 24150, conversion: 100 },
  { id: 'diagnostico', name: 'Diagnóstico', count: 3, value: 21650, conversion: 60 },
  { id: 'proposta', name: 'Proposta', count: 1, value: 2500, conversion: 20 },
  { id: 'negociacao', name: 'Negociação', count: 0, value: 0, conversion: 0 },
  { id: 'fechado', name: 'Cliente fechado', count: 0, value: 0, conversion: 0 },
];

export const automationRules = [
  {
    id: 'rule-1',
    name: 'Pedido de orçamento',
    trigger: 'Palavra-chave',
    condition: 'orçamento, proposta, quanto custa, valor ou preço',
    actions: ['Mover para Orçamento solicitado', 'Criar oportunidade', 'Solicitar humano'],
    active: true,
    runs: 4,
  },
  {
    id: 'rule-2',
    name: 'Suporte de TI urgente',
    trigger: 'Palavra-chave',
    condition: 'urgente, fora do ar, sem internet, sistema caiu ou erro',
    actions: ['Mover para Suporte técnico', 'Solicitar humano'],
    active: true,
    runs: 3,
  },
  {
    id: 'rule-3',
    name: 'Software, site ou automação',
    trigger: 'Palavra-chave',
    condition: 'sistema, software, site, landing page, automação, integração',
    actions: ['Mover para Briefing necessário', 'Classificar software_house'],
    active: true,
    runs: 6,
  },
  {
    id: 'rule-4',
    name: 'Tráfego pago e redes sociais',
    trigger: 'Palavra-chave',
    condition: 'tráfego, anúncio, instagram, redes sociais, conteúdo',
    actions: ['Mover para Qualificação', 'Classificar marketing_digital'],
    active: true,
    runs: 2,
  },
  {
    id: 'rule-5',
    name: 'Dúvidas gerais',
    trigger: 'Palavra-chave',
    condition: 'mensagem não relacionada aos serviços digitais da JIW',
    actions: ['Responder apresentação', 'Aplicar tag atendimento_geral'],
    active: true,
    runs: 1,
  },
];

export const channelAccounts = [
  { id: 'ch-1', name: 'Bot Telegram JIW', type: 'Telegram', status: 'conectado', tenant: 'JIW - Soluções Tecnológicas', messages: 12 },
  { id: 'ch-2', name: 'WhatsApp Oficial', type: 'WhatsApp', status: 'conectado', tenant: 'JIW - Soluções Tecnológicas', messages: 8 },
  { id: 'ch-3', name: 'Instagram Direct', type: 'Instagram', status: 'preparado', tenant: 'JIW - Soluções Tecnológicas', messages: 3 },
  { id: 'ch-4', name: 'WebChat Integrado', type: 'WebChat', status: 'ativo', tenant: 'JIW - Soluções Tecnológicas', messages: 1 },
];
