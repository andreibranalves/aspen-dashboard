// ComunicacaoPage — container for WhatsApp Communication management.
// Tabs: Fluxos WhatsApp, Biblioteca de Mídias, Histórico and Canais.
// Route: #/comunicacao

import { useCallback, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MessageSquare, Image, Clock, Settings2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import FlowEditorTab from '@/features/communication/components/FlowEditorTab';
import MediaUploader from '@/features/communication/components/MediaUploader';
import MediaLibrary from '@/features/communication/components/MediaLibrary';
import SendHistoryTab from '@/features/communication/components/SendHistoryTab';
import ChannelsTab from '@/features/communication/components/ChannelsTab';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';

interface TabItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabItem[] = [
  { id: 'flows', label: 'Fluxos WhatsApp', icon: MessageSquare },
  { id: 'media', label: 'Biblioteca de mídias', icon: Image },
  { id: 'history', label: 'Histórico de envios', icon: Clock },
  { id: 'channels', label: 'Canais', icon: Settings2 },
];
const parseCommunicationTab = parseHashOption<string>(TABS.map((tab) => tab.id));

export default function ComunicacaoPage() {
  const [activeTab, setActiveTab] = useHashQueryState('tab', 'flows', parseCommunicationTab);
  const [mediaRefreshKey, setMediaRefreshKey] = useState<number>(0);

  const handleUploadComplete = useCallback(() => {
    setMediaRefreshKey((k) => k + 1);
  }, []);

  const handleTabChange = useCallback(
    (nextTabId: string) => {
      if (nextTabId !== activeTab) setActiveTab(nextTabId);
    },
    [activeTab, setActiveTab]
  );

  const activeTabPanelId = `communication-panel-${activeTab}`;

  return (
    <div className="mx-auto max-w-[1060px] space-y-6 animate-fade-in">
      <PageHeader
        title="Comunicação"
        description="Fluxos, mídias e histórico das mensagens de WhatsApp."
      />

      <div
        role="tablist"
        aria-label="Seções de comunicação"
        className="-mx-1 overflow-x-auto border-b border-line px-1"
      >
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
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
                  'flex min-h-9 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
                ].join(' ')}
              >
                <Icon size={16} aria-hidden="true" />
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
        className="min-h-[400px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        {activeTab === 'flows' && <FlowEditorTab />}

        {activeTab === 'media' && (
          <div className="space-y-6">
            <MediaUploader onUploadComplete={handleUploadComplete} />
            <MediaLibrary refreshKey={mediaRefreshKey} />
          </div>
        )}

        {activeTab === 'history' && <SendHistoryTab />}

        {activeTab === 'channels' && <ChannelsTab />}
      </div>
    </div>
  );
}
