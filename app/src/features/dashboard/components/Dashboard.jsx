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
  // Números comerciais/fixos e não-clientes são excluídos das métricas e da tabela do Dashboard
  const customerConversations = React.useMemo(() => {
    return (conversations || []).filter((c) => {
      const isCommercial = c.contactCategory === 'commercial' ||
        c.service === 'non_customer' ||
        c.ai_provider === 'non_customer_suppression';
      return !isCommercial;
    });
  }, [conversations]);

  return (
    <div className="dashboard-page-container" aria-label="Painel de Controle">
      {/* 1. Métricas de Topo (4 Cards com Sparklines) */}
      <DashboardMetrics conversations={customerConversations} ready={ready} />

      {/* 2. Grid Principal: 2 Colunas (Tabela Recente à esquerda, Horários/Funil à direita) */}
      <div className="dashboard-layout-grid">
        <div className="dashboard-left-column">
          <RecentConversationsTable
            conversations={customerConversations}
            ready={ready}
            onOpenConversation={onOpenConversation}
            kanbanColumns={kanbanColumns}
            tenantSettings={tenantSettings}
            tenantSlug={tenantSlug}
          />
        </div>

        <div className="dashboard-right-column">
          <PeakActivitySection
            conversations={customerConversations}
            ready={ready}
            kanbanColumns={kanbanColumns}
          />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
