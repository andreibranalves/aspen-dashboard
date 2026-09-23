// ComunicacaoPage — container for WhatsApp Communication management.
// Tabs: Fluxos WhatsApp, Biblioteca de Mídias, Histórico and Canais.
// Route: #/comunicacao

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import FlowEditorTab from '@/features/communication/components/FlowEditorTab';
import MediaUploader from '@/features/communication/components/MediaUploader';
import MediaLibrary from '@/features/communication/components/MediaLibrary';
import SendHistoryTab from '@/features/communication/components/SendHistoryTab';
import ChannelsTab from '@/features/communication/components/ChannelsTab';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';
import { useRouteGuardContext } from '@/hooks/useHashRoute';

interface TabItem {
  id: string;
  label: string;
}

const TABS: TabItem[] = [
  { id: 'flows', label: 'Fluxos WhatsApp' },
  { id: 'media', label: 'Biblioteca de mídias' },
  { id: 'history', label: 'Histórico de envios' },
  { id: 'channels', label: 'Canais' },
];
const parseCommunicationTab = parseHashOption<string>(TABS.map((tab) => tab.id));

interface ComunicacaoPageProps {
  navigate: (path: string) => void;
}

export default function ComunicacaoPage({ navigate }: ComunicacaoPageProps) {
  const [activeTab, setActiveTab] = useHashQueryState('tab', 'flows', parseCommunicationTab);
  const [mediaRefreshKey, setMediaRefreshKey] = useState<number>(0);
  const [showMediaUploader, setShowMediaUploader] = useState(false);
  const [flowsDirty, setFlowsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const { setNavigationGuard } = useRouteGuardContext();

  const handleUploadComplete = useCallback(() => {
    setMediaRefreshKey((k) => k + 1);
    setShowMediaUploader(false);
  }, []);

  const handleTabChange = useCallback(
    (nextTabId: string) => {
      if (nextTabId === activeTab) return;
      if (activeTab === 'flows' && flowsDirty) {
        setPendingTab(nextTabId);
        return;
      }
      setActiveTab(nextTabId);
    },
    [activeTab, flowsDirty, setActiveTab]
  );

  useEffect(() => {
    if (!flowsDirty) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return () => setNavigationGuard(null);
    }
    setNavigationGuard((nextRoute) => {
      setPendingRoute(nextRoute);
      return false;
    });
    return () => setNavigationGuard(null);
  }, [flowsDirty, setNavigationGuard]);

  const activeTabPanelId = `communication-panel-${activeTab}`;

  return (
    <PageShell className="space-y-6">
      <PageHeader title="Comunicação" description="Fluxos, materiais e canais em um único contexto." />

      <div
        role="tablist"
        aria-label="Seções de comunicação"
        className="!mt-2 overflow-x-auto px-1"
      >
        <div className="flex min-w-max gap-1 pb-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`communication-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`communication-panel-${tab.id}`}
                tabIndex={0}
                onClick={() => handleTabChange(tab.id)}
                className={[
                  'flex min-h-10 items-center gap-2 whitespace-nowrap rounded-control px-3 py-2 text-xs font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-4 focus-visible:ring-offset-page',
                  isActive
                    ? 'bg-primary-soft text-primary-soft-ink'
                    : 'text-fg-muted hover:bg-raised hover:text-fg',
                ].join(' ')}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={activeTabPanelId}
        role="tabpanel"
        aria-labelledby={`communication-tab-${activeTab}`}
        tabIndex={0}
        className="min-h-[400px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-4 focus-visible:ring-offset-page"
      >
        {(activeTab === 'flows' || flowsDirty) && (
          <div className={activeTab === 'flows' ? undefined : 'hidden'}>
            <FlowEditorTab onDirtyChange={setFlowsDirty} />
          </div>
        )}

        {activeTab === 'media' && (
          <div className="space-y-6">
            <MediaLibrary refreshKey={mediaRefreshKey} onAdd={() => setShowMediaUploader((current) => !current)} />
            {showMediaUploader && <MediaUploader onUploadComplete={handleUploadComplete} />}
          </div>
        )}

        {activeTab === 'history' && (
          <SendHistoryTab
            onOpenQuotation={(quotationId) =>
              navigate(`/quotations/${encodeURIComponent(quotationId)}`)
            }
            onOpenDeliveries={() => navigate('/whatsapp-deliveries?tab=history')}
            onOpenDelivery={(event) => navigate(`/whatsapp-deliveries?tab=history&event=${encodeURIComponent(event.id)}`)}
          />
        )}

        {activeTab === 'channels' && <ChannelsTab />}
      </div>
      <ConfirmDialog
        open={pendingTab !== null}
        title="Sair sem salvar?"
        message="As alterações dos fluxos que ainda não foram salvas serão perdidas."
        confirmLabel="Sair da aba"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingTab;
          setPendingTab(null);
          setFlowsDirty(false);
          if (target) setActiveTab(target);
        }}
        onCancel={() => setPendingTab(null)}
      />
      <ConfirmDialog
        open={pendingRoute !== null}
        title="Sair sem salvar?"
        message="As alterações dos fluxos que ainda não foram salvas serão perdidas."
        confirmLabel="Sair da página"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingRoute;
          setPendingRoute(null);
          setFlowsDirty(false);
          setNavigationGuard(null);
          if (target) window.location.hash = target;
        }}
        onCancel={() => setPendingRoute(null)}
      />
    </PageShell>
  );
}
