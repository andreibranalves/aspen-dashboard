// SettingsPage — Configurações do Dashboard.
//
// A configuração de Fluxos de WhatsApp foi movida para a página
// de Comunicação (#/comunicacao). Esta página serve como hub
// para configurações gerais futuras.

import { MessageCircle, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';

export default function SettingsPage() {
  return (
    <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
      <PageHeader title="Configurações" />

      {/* WhatsApp flows moved notice */}
      <div className="rounded-xl border border-line bg-surface p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <MessageCircle size={20} className="text-primary" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">Fluxos de WhatsApp</h3>
            <p className="text-sm text-fg-muted">
              A configuração de fluxos de WhatsApp, biblioteca de mídias e histórico de envios agora
              está disponível na página dedicada de Comunicação.
            </p>
            <a
              href="#/comunicacao"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink size={14} />
              Ir para Comunicação
            </a>
          </div>
        </div>
      </div>

      {/* Future settings cards go here */}
      <div className="rounded-xl border border-dashed border-line bg-surface p-12">
        <p className="text-center text-sm text-fg-muted">
          Novas opções de configuração serão adicionadas aqui em breve.
        </p>
      </div>
    </div>
  );
}
