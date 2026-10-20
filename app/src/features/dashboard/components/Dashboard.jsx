import React from 'react';
import { DashboardMetrics } from './DashboardMetrics';
import { RecentConversationsTable } from './RecentConversationsTable';
import { PeakActivitySection } from './PeakActivitySection';

export function Dashboard({
  conversations = [],
  dataSource,
  status,
  ready = true,
  onOpenConversation,
  kanbanColumns = [],
  tenantSettings = null,
  tenantSlug = '',
  selectedTenant = null,
}) {
  return (
    <div className="dashboard-page-container" aria-label="Painel de Controle">
      {/* 1. Métricas de Topo (4 Cards com Sparklines) */}
      <DashboardMetrics conversations={conversations} ready={ready} />

      {/* 2. Grid Principal: 2 Colunas (Tabela Recente à esquerda, Horários/Funil à direita) */}
      <div className="dashboard-layout-grid">
        <div className="dashboard-left-column">
          <RecentConversationsTable
            conversations={conversations}
            ready={ready}
            onOpenConversation={onOpenConversation}
            kanbanColumns={kanbanColumns}
            tenantSettings={tenantSettings}
            tenantSlug={tenantSlug}
          />
        </div>

        <div className="dashboard-right-column">
          <PeakActivitySection
            conversations={conversations}
            ready={ready}
            kanbanColumns={kanbanColumns}
          />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
