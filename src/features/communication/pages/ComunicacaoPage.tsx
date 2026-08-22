// ComunicacaoPage — 4-tab container for WhatsApp Communication management.
// Tabs: Fluxos WhatsApp, Biblioteca de Mídias, Histórico and Canais.
// Route: #/comunicacao

import { useState, useCallback } from 'react';
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

  const handleTabChange = useCallback((nextTabId: string) => {
    if (nextTabId !== activeTab) setActiveTab(nextTabId);
  }, [activeTab, setActiveTab]);

  return (
    <>
      <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
        <PageHeader title="Comunicação" description="Fluxos, mídias e histórico das mensagens de WhatsApp." />

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={[
                  'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-[1px]',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="min-h-[400px]">
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
    </>
  );
}
