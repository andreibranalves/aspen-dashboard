// ChannelsTab — Evolution API configuration display.
// Shows current Evolution API status (connected/not configured).
// Moved from SettingsPage WhatsApp section. Read-only for now.

import { CheckCircle } from 'lucide-react';

export default function ChannelsTab() {
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
            <CheckCircle size={20} className="text-success dark:text-success/80" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-fg">Evolution API</h3>
            <p className="text-xs text-fg-muted">
              Transporte de mensagens WhatsApp configurado via variáveis de ambiente.
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg border border-line bg-surface">
        <h3 className="text-sm font-medium text-fg mb-2">
          Variáveis de ambiente necessárias
        </h3>
        <div className="space-y-1 text-xs text-fg-muted font-mono">
          <p>EVOLUTION_BASE_URL — URL base da Evolution API</p>
          <p>EVOLUTION_API_KEY — Chave de autenticação</p>
          <p>EVOLUTION_INSTANCE — Nome da instância</p>
          <p>BLOB_READ_WRITE_TOKEN — Token do Vercel Blob</p>
        </div>
        <p className="text-[10px] text-fg-muted mt-2">
          Configure estas variáveis no painel do Vercel (Settings → Environment Variables) ou no
          arquivo .env local.
        </p>
      </div>
    </div>
  );
}
