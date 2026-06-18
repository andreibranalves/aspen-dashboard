// ComunicacaoPage — 4-tab container for WhatsApp Communication management.
// Tabs: Fluxos WhatsApp, Biblioteca de Mídias, Histórico, Canais.
// Route: #/comunicacao

import { useState, useCallback } from 'react';
import { MessageSquare, Image, Clock, Settings2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import FlowEditorTab from '@/components/communication/FlowEditorTab.jsx';
import MediaUploader from '@/components/communication/MediaUploader.jsx';
import MediaLibrary from '@/components/communication/MediaLibrary.jsx';
import SendHistoryTab from '@/components/communication/SendHistoryTab.jsx';
import ChannelsTab from '@/components/communication/ChannelsTab.jsx';

const TABS = [
  { id: 'flows', label: 'Fluxos WhatsApp', icon: MessageSquare },
  { id: 'media', label: 'Biblioteca de mídias', icon: Image },
  { id: 'history', label: 'Histórico de envios', icon: Clock },
  { id: 'channels', label: 'Canais', icon: Settings2 },
];

export default function ComunicacaoPage() {
  const [activeTab, setActiveTab] = useState('flows');
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);

  const handleUploadComplete = useCallback(() => {
    setMediaRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
      <PageHeader title="Comunicação" />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
  );
}
