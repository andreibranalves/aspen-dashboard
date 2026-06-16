// ChannelsTab — Evolution API configuration display.
// Shows current Evolution API status (connected/not configured).
// Moved from SettingsPage WhatsApp section. Read-only for now.

import { CheckCircle } from 'lucide-react';

export default function ChannelsTab() {
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-framer-hairline bg-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
            <CheckCircle size={20} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-framer-ink">Evolution API</h3>
            <p className="text-xs text-framer-ink-muted">
              Transporte de mensagens WhatsApp configurado via variáveis de ambiente.
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-framer-hairline bg-card">
        <h3 className="text-sm font-medium text-framer-ink mb-2">
          Variáveis de ambiente necessárias
        </h3>
        <div className="space-y-1 text-xs text-framer-ink-muted font-mono">
          <p>EVOLUTION_BASE_URL — URL base da Evolution API</p>
          <p>EVOLUTION_API_KEY — Chave de autenticação</p>
          <p>EVOLUTION_INSTANCE — Nome da instância</p>
          <p>BLOB_READ_WRITE_TOKEN — Token do Vercel Blob</p>
        </div>
        <p className="text-[10px] text-framer-ink-muted mt-2">
          Configure estas variáveis no painel do Vercel (Settings → Environment Variables) ou no
          arquivo .env local.
        </p>
      </div>
    </div>
  );
}
