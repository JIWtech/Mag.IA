/* NORIA-LANDING-PACKAGE: componente público isolado da landing page */
import React, { useState } from 'react';
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  KanbanSquare,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import noriaLogo from './assets/noria_logo.png';
import dashboardAndConversationImage from './assets/Gemini_Generated_Image_d690hrd690hrd690.jpg';
import settingsInterfaceImage from './assets/Gemini_Generated_Image_ygl2jfygl2jfygl2.jpg';
import conversationInterfaceImage from './assets/Gemini_Generated_Image_yu95g1yu95g1yu95.jpg';

export function HomePage() {
  const [showcase, setShowcase] = useState('conversas');
  const goTo = (search) => {
    if (typeof window !== 'undefined') {
      window.location.assign(`${window.location.pathname}${search}`);
    }
  };

  return (
    <main className="home-page">
      <div className="home-ambient home-ambient-cyan" aria-hidden="true" />
      <div className="home-ambient home-ambient-violet" aria-hidden="true" />
      <header className="home-nav">
        <a className="home-brand" href="#inicio" aria-label="NORIA, início">
          <img src={noriaLogo} alt="NORIA" className="home-brand-logo" />
          <span>INTELIGÊNCIA EM MOVIMENTO</span>
        </a>
        <nav className="home-nav-links" aria-label="Navegação principal">
          <a href="#produto">Produto</a><a href="#ecossistema">Ecossistema</a><a href="#operacao">Operação</a><a href="#seguranca">Estrutura</a>
        </nav>
        <button className="home-login-button" type="button" onClick={() => goTo('?auth=login')}>Entrar <ArrowRight size={16} /></button>
      </header>

      <section id="inicio" className="home-hero">
        <div className="home-hero-copy">
          <div className="home-eyebrow"><span className="home-live-dot" /> Plataforma de atendimento e operação</div>
          <h1>Tudo conectado.<br /><span>Todo atendimento em movimento.</span></h1>
          <p>Centralize conversas, mantenha a equipe no contexto e conduza cada oportunidade até o próximo passo, com IA e atendimento humano no mesmo fluxo.</p>
          <div className="home-hero-actions">
            <button className="home-primary-button" type="button" onClick={() => goTo('?app=1')}>Ver plataforma <ArrowRight size={18} /></button>
            <a className="home-secondary-button" href="#produto">Conhecer recursos</a>
          </div>
          <div className="home-trust-row">
            <span><CheckCircle2 size={16} /> Multiempresa</span>
            <span><CheckCircle2 size={16} /> WhatsApp e Telegram</span>
            <span><CheckCircle2 size={16} /> Operação em tempo real</span>
          </div>
        </div>
        <div className="home-hero-visual">
          <HeroSignalFlow />
          <div className="home-product-preview" aria-label="Prévia da plataforma NORIA">
            <img src={dashboardAndConversationImage} alt="Prévia visual do dashboard e das conversas na NORIA" />
            <span className="home-preview-caption"><i /> Dashboard e conversas conectados</span>
          </div>
        </div>
      </section>

      <section id="produto" className="home-section home-product-section">
        <div className="home-section-intro">
          <span className="home-section-kicker">DO PRIMEIRO CONTATO À PRÓXIMA AÇÃO</span>
          <h2>Uma central para conversar, organizar e acompanhar.</h2>
          <p>O produto reúne o que a operação precisa para não perder contexto, oportunidade ou prazo.</p>
        </div>
        <div className="home-feature-grid">
          <article className="home-feature-card featured"><div className="home-feature-icon"><MessageCircle size={21} /></div><h3>Conversas em contexto</h3><p>Mensagens de canais conectados ficam em uma só visão, com histórico e o status de cada atendimento.</p><FeatureMiniature type="conversation" /><span>WhatsApp · Telegram · atendimento manual</span></article>
          <article className="home-feature-card"><div className="home-feature-icon violet"><KanbanSquare size={21} /></div><h3>Kanban operacional</h3><p>Visualize oportunidades por etapa, distribua a equipe e acompanhe handoffs sem sair da conversa.</p><FeatureMiniature type="kanban" /></article>
          <article className="home-feature-card"><div className="home-feature-icon green"><CalendarDays size={21} /></div><h3>Agenda conectada</h3><p>Conduza o agendamento a partir do atendimento e mantenha a operação alinhada com os horários registrados.</p><FeatureMiniature type="agenda" /></article>
          <article className="home-feature-card"><div className="home-feature-icon violet"><UsersRound size={21} /></div><h3>Gestão de equipe</h3><p>Cadastre agentes, organize permissões e acompanhe quem assume cada atendimento.</p><FeatureMiniature type="team" /></article>
        </div>
      </section>

      <section className="home-section home-interface-gallery" aria-labelledby="interface-gallery-title">
        <div className="home-gallery-intro"><span className="home-section-kicker">A OPERAÇÃO EM UMA ÚNICA INTERFACE</span><h2 id="interface-gallery-title">Veja a conversa, a equipe e a configuração no mesmo produto.</h2><p>Uma visão feita para quem precisa responder rápido, acompanhar cada atendimento e manter as regras de cada empresa bem definidas.</p></div>
        <div className="home-gallery-grid">
          <figure className="home-gallery-card home-gallery-conversation"><img src={conversationInterfaceImage} alt="Prévia visual da central de conversas da NORIA" /><figcaption><MessageCircle size={17} /><span><strong>Central de conversas</strong><small>Histórico, contexto e próximo passo no mesmo lugar.</small></span></figcaption></figure>
          <figure className="home-gallery-card home-gallery-settings"><img src={settingsInterfaceImage} alt="Prévia visual das configurações e da equipe na NORIA" /><figcaption><UsersRound size={17} /><span><strong>Configuração por empresa</strong><small>Equipe, canais e regras reunidos em uma operação.</small></span></figcaption></figure>
        </div>
      </section>

      <section id="ecossistema" className="home-section home-ecosystem-section">
        <div className="home-ecosystem-copy"><span className="home-section-kicker">UMA PLATAFORMA, UM FLUXO CONTÍNUO</span><h2>Menos telas soltas.<br /><span>Mais contexto para agir.</span></h2><p>Da primeira mensagem ao próximo passo, cada recurso compartilha o mesmo contexto operacional.</p></div>
        <div className="home-ecosystem-map" aria-label="Recursos conectados da plataforma NORIA">
          <EcosystemLink className="link-top-left" /><EcosystemLink className="link-top-right" /><EcosystemLink className="link-bottom-left" /><EcosystemLink className="link-bottom-right" />
          <div className="home-ecosystem-core"><img src={noriaLogo} alt="" /><span>OPERAÇÃO NORIA</span></div>
          <article className="home-ecosystem-node node-conversas"><MessageCircle size={19} /><strong>Conversas</strong><small>WhatsApp e Telegram</small></article>
          <article className="home-ecosystem-node node-ia"><Bot size={19} /><strong>IA e regras</strong><small>Contexto por empresa</small></article>
          <article className="home-ecosystem-node node-kanban"><KanbanSquare size={19} /><strong>Kanban</strong><small>Etapas e equipe</small></article>
          <article className="home-ecosystem-node node-agenda"><CalendarDays size={19} /><strong>Agenda</strong><small>Horários no fluxo</small></article>
          <article className="home-ecosystem-node node-followup"><Clock3 size={19} /><strong>Follow-ups</strong><small>Retomada com critério</small></article>
          <article className="home-ecosystem-node node-handoff"><UsersRound size={19} /><strong>Equipe</strong><small>Handoff com histórico</small></article>
        </div>
      </section>

      <section className="home-section home-showcase-section" aria-labelledby="showcase-title">
        <div className="home-showcase-panel">
          <div className="home-showcase-copy"><span className="home-section-kicker">UMA PLATAFORMA, VISÕES CONECTADAS</span><h2 id="showcase-title">Sua operação vista pelo ângulo certo.</h2><p>Troque de contexto sem trocar de ferramenta. Cada tela ajuda a equipe a decidir o próximo passo com rapidez.</p>
            <div className="home-showcase-tabs" role="tablist" aria-label="Recursos da plataforma">
              <button className={showcase === 'conversas' ? 'active' : ''} type="button" role="tab" aria-selected={showcase === 'conversas'} onClick={() => setShowcase('conversas')}><MessageCircle size={17} /><span>Conversas</span><small>Inbox por canal</small></button>
              <button className={showcase === 'kanban' ? 'active' : ''} type="button" role="tab" aria-selected={showcase === 'kanban'} onClick={() => setShowcase('kanban')}><KanbanSquare size={17} /><span>Kanban</span><small>Etapas e responsáveis</small></button>
              <button className={showcase === 'agenda' ? 'active' : ''} type="button" role="tab" aria-selected={showcase === 'agenda'} onClick={() => setShowcase('agenda')}><CalendarDays size={17} /><span>Agenda</span><small>Horários no fluxo</small></button>
            </div>
          </div>
          <div className={`home-showcase-screen ${showcase}`}>{showcase === 'conversas' && <ConversationShowcase />}{showcase === 'kanban' && <KanbanShowcase />}{showcase === 'agenda' && <AgendaShowcase />}</div>
        </div>
      </section>

      <section id="operacao" className="home-section home-operation-section">
        <div className="home-operation-copy"><span className="home-section-kicker">FLUXO CLARO PARA A EQUIPE</span><h2>A IA resolve o que pode. A equipe entra quando importa.</h2><p>A NORIA mantém as informações comerciais no controle da empresa, registra o histórico e encaminha cada caso para uma pessoa quando a conversa pede decisão humana.</p>
          <ul className="home-check-list"><li><CheckCircle2 size={18} /> Atendimento automático com regras da empresa.</li><li><CheckCircle2 size={18} /> Handoff com contexto quando a equipe precisa assumir.</li><li><CheckCircle2 size={18} /> Follow-ups para oportunidades sem agendamento.</li></ul>
        </div>
        <div className="home-flow-card"><div className="home-flow-line" aria-hidden="true" /><div className="home-flow-step"><span><MessageCircle size={19} /></span><div><small>01</small><strong>Mensagem chega</strong><p>O canal identifica a conversa e a empresa.</p></div></div><div className="home-flow-step"><span><Bot size={19} /></span><div><small>02</small><strong>Contexto e automação</strong><p>Regras, catálogo e histórico orientam a resposta.</p></div></div><div className="home-flow-step"><span><UsersRound size={19} /></span><div><small>03</small><strong>Equipe no momento certo</strong><p>Casos que exigem decisão chegam com contexto.</p></div></div></div>
      </section>

      <section id="seguranca" className="home-section home-foundation-section"><div className="home-foundation-card"><div className="home-foundation-icon"><ShieldCheck size={25} /></div><div><span className="home-section-kicker">ESTRUTURA PARA CRESCER</span><h2>Uma plataforma, configurações separadas por empresa.</h2></div><p>Dados, canais, regras e usuários são organizados por tenant, com uma operação central para acompanhar cada empresa.</p><button className="home-primary-button compact" type="button" onClick={() => goTo('?auth=login')}>Acessar a NORIA <ArrowRight size={17} /></button></div></section>

      <section className="home-final-cta" aria-label="Acesso à plataforma"><div><span className="home-section-kicker">OPERAÇÃO MAIS CLARA, ATENDIMENTO MAIS PRÓXIMO</span><h2>Faça cada conversa avançar.</h2><p>Conheça a central que conecta atendimento, equipe e rotina comercial em uma única operação.</p></div><div className="home-final-cta-actions"><button className="home-primary-button" type="button" onClick={() => goTo('?app=1')}>Explorar a plataforma <ArrowRight size={18} /></button><button className="home-cta-login" type="button" onClick={() => goTo('?auth=login')}>Já sou cliente</button></div></section>
      <footer className="home-footer"><a className="home-brand" href="#inicio"><img src={noriaLogo} alt="NORIA" className="home-brand-logo" /></a><span>Inteligência em movimento.</span><button type="button" onClick={() => goTo('?auth=login')}>Entrar na plataforma</button></footer>
    </main>
  );
}

function HeroSignalFlow() {
  return <svg className="home-hero-signal-flow" viewBox="0 0 740 580" aria-hidden="true" fill="none"><defs><linearGradient id="hero-flow-cyan" x1="60" y1="520" x2="690" y2="40" gradientUnits="userSpaceOnUse"><stop stopColor="#00E0FF" stopOpacity="0" /><stop offset="0.35" stopColor="#00E0FF" stopOpacity="0.92" /><stop offset="0.72" stopColor="#7161FF" stopOpacity="0.78" /><stop offset="1" stopColor="#7161FF" stopOpacity="0" /></linearGradient><filter id="hero-flow-glow" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="5" /></filter></defs><path d="M-20 500C160 464 149 336 318 350C488 363 509 103 765 58" stroke="url(#hero-flow-cyan)" strokeWidth="15" strokeOpacity="0.22" filter="url(#hero-flow-glow)" /><path d="M-20 500C160 464 149 336 318 350C488 363 509 103 765 58" stroke="url(#hero-flow-cyan)" strokeWidth="2" /><path d="M-25 535C178 474 205 402 349 412C517 423 558 198 770 165" stroke="url(#hero-flow-cyan)" strokeWidth="1.4" strokeOpacity="0.75" /><path d="M80 570C223 469 337 501 447 455C554 410 586 297 744 262" stroke="url(#hero-flow-cyan)" strokeWidth="1" strokeOpacity="0.4" /><circle cx="318" cy="350" r="4" fill="#00E0FF" /><circle cx="509" cy="103" r="3" fill="#8D75FF" /><circle cx="447" cy="455" r="3" fill="#00E0FF" /></svg>;
}

function EcosystemLink({ className }) { return <span className={`home-ecosystem-link ${className}`} aria-hidden="true" />; }

function FeatureMiniature({ type }) {
  if (type === 'conversation') return <div className="home-feature-mini feature-mini-conversation" aria-hidden="true"><aside><i /><i /><i /><i /></aside><section><span /><p /><p className="sent" /><p className="sent short" /></section></div>;
  if (type === 'kanban') return <div className="home-feature-mini feature-mini-kanban" aria-hidden="true"><span><i /><i /></span><span><i /><i className="violet" /></span><span><i className="green" /></span></div>;
  if (type === 'agenda') return <div className="home-feature-mini feature-mini-agenda" aria-hidden="true"><header><i /><i /><i /></header><section>{Array.from({ length: 14 }, (_, index) => <i className={index === 4 || index === 9 ? 'active' : ''} key={index} />)}</section></div>;
  return <div className="home-feature-mini feature-mini-team" aria-hidden="true"><i>AM</i><i>CL</i><i>RS</i><span><b /> <b /></span></div>;
}

function ConversationShowcase() {
  return <div className="home-showcase-window"><div className="home-window-bar"><span><i /><i /><i /></span><strong>Conversas</strong><small>WhatsApp</small></div><div className="home-conversation-layout"><aside className="home-conversation-list"><div className="home-list-search"><Search size={13} /> Buscar conversa</div><article className="selected"><i className="avatar cyan">CS</i><div><strong>Camila Santos</strong><span>Queria ver os horários...</span></div><small>agora</small></article><article><i className="avatar violet">MR</i><div><strong>Marina Rocha</strong><span>Obrigada pelo atendimento!</span></div><small>12:34</small></article><article><i className="avatar green">JV</i><div><strong>Juliana Vale</strong><span>Qual o valor do serviço?</span></div><small>11:56</small></article></aside><section className="home-chat-preview"><header><div><i className="avatar cyan">CS</i><span><strong>Camila Santos</strong><small>WhatsApp · atendimento ativo</small></span></div><b><Bot size={14} /> IA ativa</b></header><div className="home-chat-bubbles"><p className="received">Oi! Queria ver os horários para esta semana.</p><p className="sent">Claro! Qual serviço você quer agendar?</p><p className="received">Bronze Comfort.</p><p className="sent">Perfeito. Para qual dia você prefere?</p></div><footer><span>Escreva uma mensagem...</span><button type="button" aria-label="Enviar mensagem"><Send size={14} /></button></footer></section></div></div>;
}

function KanbanShowcase() {
  const columns = [['Novos contatos', 'AM', 'Ana Martins', 'Perguntou sobre valores'], ['Em atendimento', 'CS', 'Camila Santos', 'Escolhendo horário'], ['Aguardando sinal', 'MR', 'Marina Rocha', 'Pré-agendamento criado']];
  return <div className="home-showcase-window"><div className="home-window-bar"><span><i /><i /><i /></span><strong>Kanban</strong><small>12 oportunidades ativas</small></div><div className="home-kanban-preview">{columns.map(([title, initials, name, text], index) => <section key={title}><header><span>{title}</span><b>{index === 0 ? '08' : index === 1 ? '06' : '03'}</b></header><article><i className={`avatar ${index === 1 ? 'violet' : index === 2 ? 'green' : 'cyan'}`}>{initials}</i><strong>{name}</strong><p>{text}</p><footer><span>{index === 2 ? 'Sinal pendente' : 'WhatsApp'}</span><small>{index === 0 ? 'agora' : 'há 12 min'}</small></footer></article>{index === 1 && <article className="home-kanban-mini-card"><small>FOLLOW-UP</small><strong>Retomar contato</strong><p>Programado para hoje, 15:30</p></article>}</section>)}</div></div>;
}

function AgendaShowcase() {
  return <div className="home-showcase-window"><div className="home-window-bar"><span><i /><i /><i /></span><strong>Agenda</strong><small>Quinta-feira, 30</small></div><div className="home-agenda-preview"><aside><strong>Setembro</strong><div className="home-mini-calendar"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>{[21,22,23,24,25,26,27,28,29,30,1,2,3,4].map(day => <b className={day === 30 ? 'selected' : ''} key={day}>{day}</b>)}</div><p><i /> Horário disponível</p><p><i className="booked" /> Pré-agendamento</p></aside><section><header><span>Agenda da unidade</span><b>Angra dos Reis</b></header><div className="home-agenda-slots"><span>10:00</span><article><strong>Camila Santos</strong><small>Bronze Comfort · pré-agendamento</small></article><span>11:30</span><article className="open"><strong>Disponível</strong><small>Escolha este horário na conversa</small></article><span>13:00</span><article><strong>Marina Rocha</strong><small>Bronze Clássico · confirmado</small></article></div></section></div></div>;
}
