import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Clock3,
  DollarSign,
  FileSpreadsheet,
  Flame,
  HelpCircle,
  KanbanSquare,
  Layers,
  Lock,
  LogOut,
  MessageCircle,
  PhoneCall,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UsersRound,
  Zap,
} from 'lucide-react';
import noriaLogo from './assets/noria_logo.png';
import noriaHeroMockup from './assets/noria_hero_mockup.jpg';
import noriaConversasPreview from './assets/noria_conversas_preview.jpg';
import noriaConnectedEcosystem from './assets/noria_connected_ecosystem.jpg';
import noriaFeaturesMockup from './assets/noria_features_mockup.jpg';
import noriaBrandEcosystem from './assets/noria_brand_ecosystem.jpg';
import noriaCostReduction from './assets/noria_cost_reduction.jpg';
import dashboardAndConversationImage from './assets/Gemini_Generated_Image_d690hrd690hrd690.jpg';
import settingsInterfaceImage from './assets/Gemini_Generated_Image_ygl2jfygl2jfygl2.jpg';
import conversationInterfaceImage from './assets/Gemini_Generated_Image_yu95g1yu95g1yu95.jpg';
import { isSessionBootstrapped, clearSessionBootstrapped } from './app/appStorage.js';
import { signOut } from './services/auth/authService.js';

export function HomePage() {
  const [activeTab, setActiveTab] = useState('conversas');
  const [attendantCount, setAttendantCount] = useState(2);
  const [avgSalary, setAvgSalary] = useState(2400);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setHasSession(isSessionBootstrapped());
    if (typeof document !== 'undefined') {
      document.body.classList.add('home-view');
      document.documentElement.classList.add('home-view');
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('home-view');
        document.documentElement.classList.remove('home-view');
      }
    };
  }, []);

  const goTo = (search) => {
    if (typeof window !== 'undefined') {
      window.location.assign(`${window.location.pathname}${search}`);
    }
  };

  const handleSignOut = async () => {
    clearSessionBootstrapped();
    setHasSession(false);
    await signOut();
  };

  // Cálculos financeiros realistas (CLT no Brasil com encargos, benefícios e infraestrutura ~1.75x o salário bruto)
  const costPerAttendant = Math.round(avgSalary * 1.75);
  const totalMonthlyCostManual = attendantCount * costPerAttendant;
  const totalYearlyCostManual = totalMonthlyCostManual * 12;

  // Economia estimada automatizando a triagem, qualificação e suporte primário
  const estimatedSavingsMonthly = Math.round(totalMonthlyCostManual * 0.72);
  const estimatedSavingsYearly = estimatedSavingsMonthly * 12;

  return (
    <div className="home-wrapper">
      {/* Luz ambiente e background modernista no estilo Openbox */}
      <div className="home-ambient-glow glow-top" aria-hidden="true" />
      <div className="home-ambient-glow glow-accent" aria-hidden="true" />
      <div className="home-grid-pattern" aria-hidden="true" />

      {/* Top Banner quando logado */}
      {hasSession && (
        <div className="home-session-banner">
          <span>Você já possui uma sessão ativa na plataforma.</span>
          <button type="button" onClick={() => goTo('?app=1')}>
            Ir para o Dashboard <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* HEADER / NAVBAR FIXA */}
      <header className="home-navbar">
        <div className="home-nav-container">
          <a className="home-nav-brand" href="#inicio">
            <img src={noriaLogo} alt="NORIA" className="home-nav-logo" />
            <div className="home-brand-text">
              <span className="home-brand-name">NORIA</span>
              <span className="home-brand-sub">Inteligência Operacional</span>
            </div>
          </a>

          <nav className="home-nav-menu" aria-label="Navegação da página">
            <a href="#calculadora">Calculadora de Salário</a>
            <a href="#ecossistema">Ecossistema</a>
            <a href="#solucoes">Soluções</a>
            <a href="#demonstracao">Demonstração Real</a>
            <a href="#modulos">Módulos</a>
            <a href="#seguranca">Segurança</a>
          </nav>

          <div className="home-nav-actions">
            {hasSession ? (
              <>
                <button
                  className="home-nav-btn-secondary"
                  type="button"
                  onClick={handleSignOut}
                >
                  <LogOut size={14} /> Sair
                </button>
                <button
                  className="home-nav-btn-primary"
                  type="button"
                  onClick={() => goTo('?app=1')}
                >
                  Abrir Dashboard <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  className="home-nav-btn-secondary"
                  type="button"
                  onClick={() => goTo('?auth=login')}
                >
                  Entrar
                </button>
                <button
                  className="home-nav-btn-primary"
                  type="button"
                  onClick={() => goTo('?app=1')}
                >
                  Acessar Plataforma <ArrowRight size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO SECTION COM HEADLINE OFICIAL E GANCHO DE SALÁRIO */}
      <section id="inicio" className="home-hero-section">
        <div className="home-hero-content">
          {/* Eyebrow Comercial de Alto Impacto */}
          <div className="home-hero-eyebrow">
            <span className="home-eyebrow-pill">
              <Sparkles size={14} className="home-pulse-icon" />
              Impacto Financeiro & ROI
            </span>
            <span className="home-eyebrow-text">
              Quanto você paga hoje de salário pra quem responde o WhatsApp da sua empresa?
            </span>
          </div>

          {/* HEADLINE PRINCIPAL REQUISITADA */}
          <h1 className="home-hero-headline">
            Atenda mais rápido. Organize seus clientes.{' '}
            <span className="home-headline-highlight">Venda mais com inteligência artificial.</span>
          </h1>

          {/* SUBHEADLINE OFICIAL */}
          <p className="home-hero-subhead">
            Centralize WhatsApp, atendimento, CRM e automações em uma única plataforma. Sua IA
            atende, sua equipe acompanha e nenhuma oportunidade fica esquecida.
          </p>

          {/* AÇÕES DE CONVERSÃO */}
          <div className="home-hero-ctas">
            <button
              className="home-btn-hero-primary"
              type="button"
              onClick={() => goTo('?app=1')}
            >
              <Zap size={18} />
              Ver a Plataforma em Ação
              <ArrowRight size={18} />
            </button>
            <a className="home-btn-hero-secondary" href="#calculadora">
              <DollarSign size={18} />
              Simular Economia da Minha Equipe
            </a>
          </div>

          {/* PROVA SOCIAL / BENEFÍCIOS RÁPIDOS */}
          <div className="home-trust-badges">
            <div className="home-trust-item">
              <CheckCircle2 size={16} className="text-emerald" />
              <span>Resposta em menos de 3s</span>
            </div>
            <div className="home-trust-item">
              <CheckCircle2 size={16} className="text-emerald" />
              <span>Atendimento 24/7 sem interrupção</span>
            </div>
            <div className="home-trust-item">
              <CheckCircle2 size={16} className="text-emerald" />
              <span>Kanban de vendas em tempo real</span>
            </div>
            <div className="home-trust-item">
              <CheckCircle2 size={16} className="text-emerald" />
              <span>Handoff humanizado para sua equipe</span>
            </div>
          </div>
        </div>

        {/* HERO WINDOW COM A PRÉVIA WIDESCREEN REAL DO PRODUTO */}
        <div className="home-hero-showcase">
          <div className="home-showcase-window">
            <div className="window-header-bar">
              <div className="window-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
              <div className="window-address-bar">
                <Lock size={12} className="text-emerald" />
                <span>app.noria.com.br/central-conversas</span>
              </div>
              <div className="window-status-pill">
                <span className="status-live-dot" />
                <span>WhatsApp Oficial • Ao Vivo</span>
              </div>
            </div>

            <div className="window-image-canvas">
              <img
                src={noriaConversasPreview}
                alt="Central de Atendimento e Conversas NORIA em Tempo Real"
                className="hero-widescreen-img"
              />
              <div className="window-float-tag tag-left">
                <span className="live-pulse-green" />
                <div>
                  <strong>19 Conversas Ativas</strong>
                  <small>IA qualificando em tempo real</small>
                </div>
              </div>
              <div className="window-float-tag tag-right">
                <Flame size={16} className="text-amber" />
                <div>
                  <strong>Lead Quente: Carlos Mendes</strong>
                  <small>Simulação de SUV Automático</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO SPOTLIGHT 3D: "A INTELIGÊNCIA QUE MOVE O SEU NEGÓCIO" */}
      <section className="home-spotlight-section">
        <div className="home-section-container">
          <div className="spotlight-grid">
            <div className="spotlight-copy">
              <span className="home-pill-badge">Inteligência em Movimento</span>
              <h2>A inteligência que move o seu negócio.</h2>
              <p className="spotlight-subtitle">
                Uma nova forma de conectar sua operação: da primeira mensagem enviada no WhatsApp até o
                fechamento do contrato e emissão de propostas.
              </p>

              <div className="spotlight-metrics-row">
                <div className="spotlight-metric-card">
                  <span className="metric-number">1.253</span>
                  <span className="metric-tagline">Oportunidades</span>
                  <small className="metric-sub">+18% de conversão mensal</small>
                </div>
                <div className="spotlight-metric-card">
                  <span className="metric-number">312</span>
                  <span className="metric-tagline">Reuniões & visitas</span>
                  <small className="metric-sub">+24% de comparecimento</small>
                </div>
                <div className="spotlight-metric-card">
                  <span className="metric-number">R$ 2,48M</span>
                  <span className="metric-tagline">Receita prevista</span>
                  <small className="metric-sub">Pipeline em tempo real</small>
                </div>
              </div>

              <div className="spotlight-bullet-points">
                <div className="spotlight-bullet">
                  <CheckCircle2 size={18} className="text-cyan" />
                  <span>Centralize múltiplos números de WhatsApp da empresa em uma única tela</span>
                </div>
                <div className="spotlight-bullet">
                  <CheckCircle2 size={18} className="text-cyan" />
                  <span>Seus vendedores recebem o lead com nome, telefone e interesse já qualificados</span>
                </div>
                <div className="spotlight-bullet">
                  <CheckCircle2 size={18} className="text-cyan" />
                  <span>Follow-ups automáticos programados para não deixar nenhum cliente esfriar</span>
                </div>
              </div>

              <button className="spotlight-cta-btn" type="button" onClick={() => goTo('?app=1')}>
                Conhecer o Sistema Completo <ArrowRight size={16} />
              </button>
            </div>

            <div className="spotlight-poster-col">
              <div className="spotlight-poster-frame">
                <img
                  src={noriaHeroMockup}
                  alt="Poster 3D NORIA - Laptop e Smartphone"
                  className="spotlight-poster-img"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CALCULADORA COMERCIAL / GANCHO DO SALÁRIO & EFICIÊNCIA OPERACIONAL */}
      <section id="calculadora" className="home-calc-section">
        <div className="home-section-container">
          {/* BANNER OFICIAL DE EFICIÊNCIA OPERACIONAL (IMAGEM OFICIAL NORIA) */}
          <div className="home-cost-reduction-banner">
            <div className="cost-reduction-visual">
              <div className="cost-reduction-frame">
                <img
                  src={noriaCostReduction}
                  alt="Eficiência Operacional: Sua operação pode custar menos. Muito menos. Até 60% de redução potencial"
                  className="cost-reduction-img"
                />
              </div>
            </div>

            <div className="cost-reduction-copy">
              <span className="home-pill-badge">
                <TrendingDown size={14} /> Eficiência Operacional Comprovada
              </span>
              <h2>
                Sua operação pode custar menos.{' '}
                <span className="home-headline-highlight">Muito menos.</span>
              </h2>
              <div className="cost-reduction-tagline">
                <span className="reduction-percent">Até 60%</span>
                <span className="reduction-label">de redução potencial de custo operacional</span>
              </div>
              <p className="cost-reduction-desc">
                Automatize atendimentos repetitivos, otimize o trabalho da equipe e reduza a necessidade de novas
                contratações com a inteligência artificial da <strong>NORIA</strong>.
              </p>

              <div className="cost-reduction-perks">
                <div className="reduction-perk-item">
                  <CheckCircle2 size={18} className="text-cyan" />
                  <div>
                    <strong>Menos tarefas manuais:</strong>
                    <span>Triagem imediata de dúvidas frequentes, estoque e horários sem ocupar atendentes.</span>
                  </div>
                </div>
                <div className="reduction-perk-item">
                  <CheckCircle2 size={18} className="text-cyan" />
                  <div>
                    <strong>Mais atendimentos por funcionário:</strong>
                    <span>Sua equipe foca apenas nos leads quentes e prontos para fechamento de negócio.</span>
                  </div>
                </div>
                <div className="reduction-perk-item">
                  <CheckCircle2 size={18} className="text-cyan" />
                  <div>
                    <strong>Crescimento com estrutura mais enxuta:</strong>
                    <span>Multiplique o volume de clientes atendidos sem inflar a folha de pagamento.</span>
                  </div>
                </div>
              </div>

              <a className="cost-reduction-cta" href="#simulador-valores">
                Simular economia na calculadora <ArrowRight size={16} />
              </a>
            </div>
          </div>

          <div id="simulador-valores" className="home-calc-intro">
            <span className="home-pill-badge">Simulador Interativo</span>
            <h2>Quanto custa manter o WhatsApp da sua empresa sem a NORIA?</h2>
            <p>
              Compare o custo operacional de manter funcionários dedicados apenas a digitar respostas
              manuais versus uma operação automatizada e focada em fechamento.
            </p>
          </div>

          <div className="home-calc-card">
            {/* Controles da Calculadora */}
            <div className="calc-controls">
              <div className="control-group">
                <label htmlFor="attendant-range">
                  <span>Quantas pessoas respondem o WhatsApp da sua empresa?</span>
                  <strong>{attendantCount} {attendantCount === 1 ? 'pessoa' : 'pessoas'}</strong>
                </label>
                <input
                  id="attendant-range"
                  type="range"
                  min="1"
                  max="12"
                  value={attendantCount}
                  onChange={(e) => setAttendantCount(Number(e.target.value))}
                  className="calc-slider"
                />
                <div className="slider-ticks">
                  <span>1</span>
                  <span>3</span>
                  <span>6</span>
                  <span>9</span>
                  <span>12+</span>
                </div>
              </div>

              <div className="control-group">
                <label htmlFor="salary-range">
                  <span>Média salarial bruta por atendente (R$):</span>
                  <strong>
                    {avgSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                  </strong>
                </label>
                <input
                  id="salary-range"
                  type="range"
                  min="1500"
                  max="6000"
                  step="100"
                  value={avgSalary}
                  onChange={(e) => setAvgSalary(Number(e.target.value))}
                  className="calc-slider"
                />
                <small className="calc-note">
                  *Considerando encargos trabalhistas, benefícios e infraestrutura média de mercado (1.75x o salário).
                </small>
              </div>

              <div className="calc-summary-pill">
                <Clock size={16} />
                <span>
                  Sua equipe perde cerca de <strong>{(attendantCount * 4.5).toFixed(0)} horas diárias</strong> respondendo
                  dúvidas repetidas que a IA responderia em segundos.
                </span>
              </div>
            </div>

            {/* Resultado Comparativo */}
            <div className="calc-results-comparison">
              <div className="calc-column manual-column">
                <div className="col-badge badge-warning">Atendimento Manual Atual</div>
                <h3>
                  {totalMonthlyCostManual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                  <small>/mês</small>
                </h3>
                <span className="yearly-tag">
                  {totalYearlyCostManual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })} ao ano
                </span>

                <ul className="calc-feature-list negative">
                  <li>
                    <span className="cross">✕</span>
                    Demora de 15 a 45 min para responder
                  </li>
                  <li>
                    <span className="cross">✕</span>
                    Sem atendimento à noite ou finais de semana
                  </li>
                  <li>
                    <span className="cross">✕</span>
                    Leads e orçamentos esquecidos sem follow-up
                  </li>
                  <li>
                    <span className="cross">✕</span>
                    Vendedores perdem tempo qualificando curiosos
                  </li>
                </ul>
              </div>

              <div className="calc-column noria-column">
                <div className="col-badge badge-success">Com a NORIA / Mag.IA</div>
                <div className="economy-highlight">
                  <span className="econ-label">Economia estimada</span>
                  <h3>
                    {estimatedSavingsMonthly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                    <small>/mês</small>
                  </h3>
                  <span className="yearly-saved">
                    Economia de até {estimatedSavingsYearly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })} por ano
                  </span>
                </div>

                <ul className="calc-feature-list positive">
                  <li>
                    <Check size={16} className="text-emerald" />
                    Resposta em 3 segundos, 24 horas por dia
                  </li>
                  <li>
                    <Check size={16} className="text-emerald" />
                    Qualificação automática de nome, interesse e entrada
                  </li>
                  <li>
                    <Check size={16} className="text-emerald" />
                    Kanban visual de vendas com follow-ups programados
                  </li>
                  <li>
                    <Check size={16} className="text-emerald" />
                    Sua equipe humana só entra na hora de fechar negócio
                  </li>
                </ul>

                <button
                  className="calc-cta-button"
                  type="button"
                  onClick={() => goTo('?app=1')}
                >
                  Começar a Economizar Agora <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO ECOSSISTEMA NORIA: "TUDO CONECTADO. TUDO EM MOVIMENTO." (BASEADA NA IMAGEM OFICIAL) */}
      <section id="ecossistema" className="home-ecosystem-feature-section">
        <div className="home-section-container">
          <div className="section-header-centered">
            <span className="home-pill-badge">Ecossistema Completo</span>
            <h2>Tudo conectado. Tudo em movimento.</h2>
            <p>
              Uma plataforma completa para gerenciar sua operação do início ao resultado.
              Sem ferramentas soltas, sem perder mensagens entre o WhatsApp e a equipe.
            </p>
          </div>

          <div className="home-ecosystem-dual-layout">
            <div className="ecosystem-image-wrapper">
              <img
                src={noriaConnectedEcosystem}
                alt="Ecossistema NORIA - Diagrama de conexão do Laptop e Smartphone com SDR, Pipeline, Kanban, Agenda, Financeiro e Inteligência"
                className="ecosystem-diagram-img"
              />
            </div>

            <div className="ecosystem-grid-cards">
              <div className="ecosystem-item-card">
                <div className="eco-card-header">
                  <span className="eco-icon-badge cyan"><Bot size={20} /></span>
                  <h4>NORIA SDR</h4>
                </div>
                <p>Prospecção automatizada e qualificação de leads com inteligência artificial humanizada.</p>
              </div>

              <div className="ecosystem-item-card">
                <div className="eco-card-header">
                  <span className="eco-icon-badge violet"><TrendingUp size={20} /></span>
                  <h4>NORIA PIPELINE</h4>
                </div>
                <p>Visualize e gerencie oportunidades por valor de proposta e probabilidade de fechamento.</p>
              </div>

              <div className="ecosystem-item-card">
                <div className="eco-card-header">
                  <span className="eco-icon-badge blue"><KanbanSquare size={20} /></span>
                  <h4>NORIA FLOW (KANBAN)</h4>
                </div>
                <p>Acompanhe processos, tarefas e etapas comerciais com clareza, velocidade e produtividade.</p>
              </div>

              <div className="ecosystem-item-card">
                <div className="eco-card-header">
                  <span className="eco-icon-badge green"><CalendarDays size={20} /></span>
                  <h4>NORIA AGENDA</h4>
                </div>
                <p>Agendamentos integrados e controle de horários de visitas, reuniões e atendimentos.</p>
              </div>

              <div className="ecosystem-item-card">
                <div className="eco-card-header">
                  <span className="eco-icon-badge amber"><DollarSign size={20} /></span>
                  <h4>NORIA FINANCE</h4>
                </div>
                <p>Controle financeiro, sinais de pagamento e histórico de propostas em um só lugar.</p>
              </div>

              <div className="ecosystem-item-card">
                <div className="eco-card-header">
                  <span className="eco-icon-badge purple"><BarChart3 size={20} /></span>
                  <h4>NORIA INTELLIGENCE</h4>
                </div>
                <p>Dashboards completos para decisões estratégicas, horários de pico e taxas de conversão.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO "MENOS FERRAMENTAS. MAIS INTELIGÊNCIA." (BASEADA NA IMAGEM OFICIAL) */}
      <section className="home-less-tools-section">
        <div className="home-section-container">
          <div className="less-tools-grid">
            <div className="less-tools-copy">
              <span className="home-pill-badge">Eficiência Real</span>
              <h2>Menos ferramentas.<br /><span className="text-gradient-cyan">Mais inteligência.</span></h2>
              <p className="less-tools-intro">
                Substitua planilhas perdidas, CRM desconectado e atendentes sobrecarregados por um
                sistema único e fluido.
              </p>

              <div className="pillars-benefit-list">
                <div className="benefit-item">
                  <div className="benefit-icon-circle"><UsersRound size={20} /></div>
                  <div>
                    <strong>Conecte pessoas</strong>
                    <p>Centralize relacionamentos, canais de conversa e equipes em um só lugar.</p>
                  </div>
                </div>

                <div className="benefit-item">
                  <div className="benefit-icon-circle"><Zap size={20} /></div>
                  <div>
                    <strong>Automatize processos</strong>
                    <p>Reduza tarefas repetitivas, tire dúvidas básicas e ganhe tempo para fechar vendas.</p>
                  </div>
                </div>

                <div className="benefit-item">
                  <div className="benefit-icon-circle"><TrendingUp size={20} /></div>
                  <div>
                    <strong>Acompanhe oportunidades</strong>
                    <p>Tenha visibilidade total do seu pipeline de clientes e avance com foco total.</p>
                  </div>
                </div>

                <div className="benefit-item">
                  <div className="benefit-icon-circle"><BarChart3 size={20} /></div>
                  <div>
                    <strong>Transforme dados em decisões</strong>
                    <p>Dashboards inteligentes e relatórios rápidos para escolhas mais assertivas.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="less-tools-visual">
              <div className="mockup-frame-glass">
                <img
                  src={noriaFeaturesMockup}
                  alt="Menos ferramentas, mais inteligência - Interface NORIA"
                  className="less-tools-img"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DEMONSTRAÇÃO REAL DO PRODUTO: CONVERSAS + ATENDIMENTO (BASEADA NA IMAGEM OFICIAL DO USUÁRIO) */}
      <section id="demonstracao" className="home-real-demo-section">
        <div className="home-section-container">
          <div className="section-header-centered">
            <span className="home-pill-badge">Operação Comprovada</span>
            <h2>Veja o atendimento em ação na prática</h2>
            <p>
              Exemplo real em concessionárias e empresas de serviços: enquanto a IA qualifica o veículo,
              ano e entrada, o painel organiza as conversas e agenda o test-drive para o vendedor.
            </p>
          </div>

          <div className="real-demo-frame">
            <img
              src={noriaConversasPreview}
              alt="Prévia real do painel Aurora Veículos e do chat WhatsApp com Carlos Mendes"
              className="real-demo-img"
            />
            <div className="demo-caption-bar">
              <div className="caption-metric">
                <span className="dot green" />
                <strong>19 Conversas Ativas</strong>
              </div>
              <div className="caption-metric">
                <span className="dot yellow" />
                <strong>02 Aguardando Equipe Humana</strong>
              </div>
              <div className="caption-metric">
                <span className="dot blue" />
                <strong>09 Agendamentos Confirmados</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OS 4 PILARES DA MARCA NORIA (BASEADO NO BRAND BOOK OFICIAL DO USUÁRIO) */}
      <section id="solucoes" className="home-pillars-brand-section">
        <div className="home-section-container">
          <div className="section-header-centered">
            <span className="home-pill-badge">Padrão de Excelência</span>
            <h2>Construída para empresas que não podem parar</h2>
            <p>
              Os quatro princípios que tornam a NORIA a escolha de operações de alta performance.
            </p>
          </div>

          <div className="brand-pillars-grid">
            <div className="brand-pillar-card">
              <div className="pillar-num-badge">01</div>
              <ShieldCheck size={28} className="text-cyan" />
              <h3>SEGURA</h3>
              <p>Proteção de dados com criptografia de ponta a ponta, isolamento rigoroso por empresa e conformidade LGPD.</p>
            </div>

            <div className="brand-pillar-card">
              <div className="pillar-num-badge">02</div>
              <Zap size={28} className="text-cyan" />
              <h3>RÁPIDA</h3>
              <p>Automação que acelera sua operação com tempo de resposta médio inferior a 3 segundos no WhatsApp.</p>
            </div>

            <div className="brand-pillar-card">
              <div className="pillar-num-badge">03</div>
              <Layers size={28} className="text-cyan" />
              <h3>INTEGRADA</h3>
              <p>Tudo conectado em um único ecossistema: conversas, equipe, funil de vendas, agendamentos e métricas.</p>
            </div>

            <div className="brand-pillar-card">
              <div className="pillar-num-badge">04</div>
              <Rocket size={28} className="text-cyan" />
              <h3>ESCALÁVEL</h3>
              <p>Do pequeno negócio local às grandes redes com múltiplas filiais e dezenas de atendentes.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SHOWCASE INTERATIVO DOS MÓDULOS */}
      <section id="modulos" className="home-modules-section">
        <div className="home-section-container">
          <div className="section-header-centered">
            <span className="home-pill-badge">Tour da Plataforma</span>
            <h2>Conheça cada detalhe da sua nova central</h2>
            <p>
              Alterne entre os módulos e veja como a interface foi projetada para dar clareza e agilidade ao seu dia a dia.
            </p>
          </div>

          <div className="home-tabs-nav">
            <button
              type="button"
              className={`home-tab-btn ${activeTab === 'conversas' ? 'active' : ''}`}
              onClick={() => setActiveTab('conversas')}
            >
              <MessageCircle size={16} /> Central de Conversas
            </button>
            <button
              type="button"
              className={`home-tab-btn ${activeTab === 'kanban' ? 'active' : ''}`}
              onClick={() => setActiveTab('kanban')}
            >
              <KanbanSquare size={16} /> Kanban de Vendas
            </button>
            <button
              type="button"
              className={`home-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <Layers size={16} /> Métricas & Dashboard
            </button>
            <button
              type="button"
              className={`home-tab-btn ${activeTab === 'configuracoes' ? 'active' : ''}`}
              onClick={() => setActiveTab('configuracoes')}
            >
              <Building2 size={16} /> Multiempresa & Equipe
            </button>
          </div>

          <div className="home-tab-display">
            {activeTab === 'conversas' && (
              <div className="tab-showcase-item">
                <div className="tab-showcase-text">
                  <div className="badge-tag">Atendimento Ágil</div>
                  <h3>Toda a comunicação da sua empresa em uma tela inteligente</h3>
                  <p>
                    Acesse todas as conversas ativas do WhatsApp e Telegram. Acompanhe a IA respondendo em
                    tempo real, leia áudios transcritos sem precisar escutar e assuma o controle com apenas um clique.
                  </p>
                  <ul className="check-perks">
                    <li><Check size={16} /> Áudios de clientes transcritos em texto automaticamente</li>
                    <li><Check size={16} /> Envio de fotos, anexos e localização oficial</li>
                    <li><Check size={16} /> Histórico completo de conversas por cliente</li>
                  </ul>
                  <button className="home-tab-cta" type="button" onClick={() => goTo('?app=1')}>
                    Testar Central de Conversas <ArrowRight size={15} />
                  </button>
                </div>
                <div className="tab-showcase-visual">
                  <img
                    src={conversationInterfaceImage}
                    alt="Interface da Central de Conversas"
                    className="tab-image-preview"
                  />
                </div>
              </div>
            )}

            {activeTab === 'kanban' && (
              <div className="tab-showcase-item">
                <div className="tab-showcase-text">
                  <div className="badge-tag">Gestão de Oportunidades</div>
                  <h3>Funil visual para nunca mais perder um lead qualificado</h3>
                  <p>
                    Organize contatos por etapas comerciais: Novos Leads, Em Atendimento, Financiamento,
                    Visita Agendada ou Fechamento. Arraste cards com facilidade e configure alertas automáticos de retorno.
                  </p>
                  <ul className="check-perks">
                    <li><Check size={16} /> Classificação automática de leads frios, mornos e quentes</li>
                    <li><Check size={16} /> Atribuição de responsável por negócio</li>
                    <li><Check size={16} /> Sinal de pagamento e registro de propostas</li>
                  </ul>
                  <button className="home-tab-cta" type="button" onClick={() => goTo('?app=1')}>
                    Ver o Kanban na Prática <ArrowRight size={15} />
                  </button>
                </div>
                <div className="tab-showcase-visual">
                  <img
                    src={dashboardAndConversationImage}
                    alt="Visão de Kanban e Oportunidades"
                    className="tab-image-preview"
                  />
                </div>
              </div>
            )}

            {activeTab === 'dashboard' && (
              <div className="tab-showcase-item">
                <div className="tab-showcase-text">
                  <div className="badge-tag">Controle Gerencial</div>
                  <h3>Métricas claras sobre o desempenho do seu atendimento</h3>
                  <p>
                    Saiba quantos clientes entraram em contato, quais canais mais convertem, horários de pico
                    e quanto tempo sua empresa leva para atender. Decisões baseadas em números reais.
                  </p>
                  <ul className="check-perks">
                    <li><Check size={16} /> Gráficos de volume diário e taxa de conversão</li>
                    <li><Check size={16} /> Identificação dos horários com mais mensagens</li>
                    <li><Check size={16} /> Relatórios exportáveis com 1 clique</li>
                  </ul>
                  <button className="home-tab-cta" type="button" onClick={() => goTo('?app=1')}>
                    Acessar o Painel de Métricas <ArrowRight size={15} />
                  </button>
                </div>
                <div className="tab-showcase-visual">
                  <img
                    src={dashboardAndConversationImage}
                    alt="Dashboard de métricas e atendimento"
                    className="tab-image-preview"
                  />
                </div>
              </div>
            )}

            {activeTab === 'configuracoes' && (
              <div className="tab-showcase-item">
                <div className="tab-showcase-text">
                  <div className="badge-tag">Estrutura Empresarial</div>
                  <h3>Arquitetura Multi-Tenant: gerencie filiais e equipes separadas</h3>
                  <p>
                    Tenha múltiplos clientes, filiais ou marcas sob uma mesma infraestrutura. Cada empresa
                    possui seus próprios contatos, canais, agentes humanos e regras comerciais exclusivas.
                  </p>
                  <ul className="check-perks">
                    <li><Check size={16} /> Permissões granulares de acesso por atendente</li>
                    <li><Check size={16} /> Catálogo de produtos e serviços individualizado</li>
                    <li><Check size={16} /> Políticas de atendimento e horários de funcionamento customizados</li>
                  </ul>
                  <button className="home-tab-cta" type="button" onClick={() => goTo('?app=1')}>
                    Explorar Gestão de Empresas <ArrowRight size={15} />
                  </button>
                </div>
                <div className="tab-showcase-visual">
                  <img
                    src={settingsInterfaceImage}
                    alt="Gestão de empresas e configurações"
                    className="tab-image-preview"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SEGURANÇA E CONFIABILIDADE */}
      <section id="seguranca" className="home-security-section">
        <div className="home-section-container">
          <div className="home-security-card">
            <div className="security-icon-large">
              <ShieldCheck size={38} />
            </div>
            <div className="security-content">
              <span className="home-pill-badge">Confiabilidade Corporativa</span>
              <h2>Seus dados protegidos com segurança de nível bancário</h2>
              <p>
                A plataforma opera com isolamento rigoroso entre empresas, criptografia em trânsito e em repouso,
                backups automatizados e conformidade estrita com as políticas do WhatsApp e LGPD.
              </p>
              <div className="security-badges-row">
                <span><Lock size={15} /> Criptografia de Ponta a Ponta</span>
                <span><CheckCircle2 size={15} /> Isolamento de Dados por Tenant</span>
                <span><Building2 size={15} /> Servidores de Alta Disponibilidade</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA FINAL DE ALTA CONVERSÃO */}
      <section className="home-final-cta-section">
        <div className="home-final-cta-card">
          <div className="final-cta-glow" aria-hidden="true" />
          <span className="home-pill-badge">Transforme seu Atendimento</span>
          <h2>Pare de perder vendas por demora no WhatsApp.</h2>
          <p>
            Junte-se às empresas que já automatizaram a qualificação de clientes e aceleraram o fechamento
            com a plataforma NORIA.
          </p>

          <div className="home-final-actions">
            <button
              className="home-btn-final-primary"
              type="button"
              onClick={() => goTo('?app=1')}
            >
              Explorar a Plataforma Agora <ArrowRight size={18} />
            </button>
            <button
              className="home-btn-final-secondary"
              type="button"
              onClick={() => goTo('?auth=login')}
            >
              Já sou cliente • Fazer Login
            </button>
          </div>

          <small className="final-subnote">
            Configuração rápida • Sem burocracia • Suporte comercial dedicado
          </small>
        </div>
      </section>

      {/* FOOTER CORPORATIVO */}
      <footer className="home-footer-section">
        <div className="home-footer-container">
          <div className="home-footer-brand">
            <img src={noriaLogo} alt="NORIA" className="home-footer-logo" />
            <span className="footer-tagline">NORIA • Inteligência em Movimento</span>
            <p className="footer-desc">
              A plataforma definitiva para unificar WhatsApp, atendimento inteligente, CRM e vendas.
            </p>
          </div>

          <div className="home-footer-links-grid">
            <div className="footer-col">
              <h4>Produto</h4>
              <a href="#ecossistema">Ecossistema</a>
              <a href="#solucoes">Central de WhatsApp</a>
              <a href="#calculadora">Calculadora de Salário</a>
              <a href="#demonstracao">Demonstração Real</a>
              <a href="#modulos">Multiempresa</a>
            </div>

            <div className="footer-col">
              <h4>Empresa</h4>
              <button type="button" onClick={() => goTo('?app=1')}>Demonstração</button>
              <button type="button" onClick={() => goTo('?auth=login')}>Área do Cliente</button>
              <a href="#seguranca">Segurança & LGPD</a>
            </div>

            <div className="footer-col">
              <h4>Acesso Rápido</h4>
              <button className="footer-login-link" type="button" onClick={() => goTo('?auth=login')}>
                Fazer Login na Plataforma →
              </button>
            </div>
          </div>
        </div>

        <div className="home-footer-bottom">
          <p>© {new Date().getFullYear()} NORIA / Mag.IA. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
