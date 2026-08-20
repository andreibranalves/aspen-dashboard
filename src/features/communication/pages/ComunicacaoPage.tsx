// ComunicacaoPage — 5-tab container for WhatsApp Communication management.
// Tabs: Fluxos WhatsApp, Biblioteca de Mídias, Histórico, Canais and quotation email.
// Route: #/comunicacao

import { useState, useCallback, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MessageSquare, Image, Clock, Settings2, Mail } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import FlowEditorTab from '@/features/communication/components/FlowEditorTab';
import MediaUploader from '@/features/communication/components/MediaUploader';
import MediaLibrary from '@/features/communication/components/MediaLibrary';
import SendHistoryTab from '@/features/communication/components/SendHistoryTab';
import ChannelsTab from '@/features/communication/components/ChannelsTab';
import QuotationEmailTemplateTab from '@/features/communication/components/QuotationEmailTemplateTab';
import type { SetHashRouteGuard } from '@/hooks/useHashRoute';

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
  { id: 'email-template', label: 'E-mail de orçamento', icon: Mail },
];

interface ComunicacaoPageProps {
  setNavigationGuard?: SetHashRouteGuard;
}

export default function ComunicacaoPage({ setNavigationGuard }: ComunicacaoPageProps) {
  const [activeTab, setActiveTab] = useState<string>('flows');
  const [mediaRefreshKey, setMediaRefreshKey] = useState<number>(0);
  const [emailTemplateDirty, setEmailTemplateDirty] = useState(false);
  const [pendingTabId, setPendingTabId] = useState<string | null>(null);
  const [tabDiscardOpen, setTabDiscardOpen] = useState(false);

  const handleUploadComplete = useCallback(() => {
    setMediaRefreshKey((k) => k + 1);
  }, []);

  const handleTabChange = useCallback((nextTabId: string) => {
    if (nextTabId === activeTab) return;
    if (emailTemplateDirty) {
      setPendingTabId(nextTabId);
      setTabDiscardOpen(true);
      return;
    }
    setActiveTab(nextTabId);
  }, [activeTab, emailTemplateDirty]);

  useEffect(() => {
    if (!setNavigationGuard) return undefined;
    setNavigationGuard(emailTemplateDirty
      ? () => window.confirm('Existem alterações não salvas. Descartar alterações?')
      : null);
    return () => setNavigationGuard(null);
  }, [emailTemplateDirty, setNavigationGuard]);

  const discardTabChanges = useCallback(() => {
    if (pendingTabId) setActiveTab(pendingTabId);
    setEmailTemplateDirty(false);
    setPendingTabId(null);
    setTabDiscardOpen(false);
  }, [pendingTabId]);

  return (
    <>
      <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
        <PageHeader title="Comunicação" />

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

          {activeTab === 'email-template' && (
            <QuotationEmailTemplateTab onDirtyChange={setEmailTemplateDirty} />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={tabDiscardOpen}
        title="Descartar alterações?"
        message="Existem alterações não salvas no modelo de e-mail."
        confirmLabel="Descartar alterações"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={discardTabChanges}
        onCancel={() => {
          setPendingTabId(null);
          setTabDiscardOpen(false);
        }}
      />
    </>
  );
}
