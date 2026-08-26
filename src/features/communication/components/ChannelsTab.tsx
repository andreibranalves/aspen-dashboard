// ChannelsTab — Evolution API configuration display.
// The channel is read-only here; transport configuration remains in the environment.

import { Info, KeyRound, MessageCircle, Server, ShieldCheck } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';

const CONFIGURATION_ITEMS = [
  {
    name: 'EVOLUTION_BASE_URL',
    description: 'URL base da Evolution API',
    icon: Server,
  },
  {
    name: 'EVOLUTION_API_KEY',
    description: 'Chave de autenticação',
    icon: KeyRound,
  },
  {
    name: 'EVOLUTION_INSTANCE',
    description: 'Nome da instância',
    icon: MessageCircle,
  },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    description: 'Token usado pela biblioteca de mídias',
    icon: ShieldCheck,
  },
] as const;

export default function ChannelsTab() {
  return (
    <div className="space-y-4">
      <section
        className="rounded-md border border-line bg-surface p-4"
        aria-labelledby="channels-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <MessageCircle size={20} className="text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="channels-title" className="text-base font-semibold text-fg">
                WhatsApp
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Canal operacional atendido pela Evolution API.
              </p>
            </div>
          </div>
          <StatusBadge status="Draft" label="Somente leitura" />
        </div>

        <dl className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Canal</dt>
            <dd className="mt-1 text-sm font-medium text-fg">WhatsApp</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Transporte</dt>
            <dd className="mt-1 text-sm font-medium text-fg">Evolution API</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Configuração</dt>
            <dd className="mt-1 text-sm font-medium text-fg">Variáveis de ambiente</dd>
          </div>
        </dl>

        <div
          className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-xs text-fg-muted"
          role="status"
        >
          <Info size={15} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
          <p>
            O status de conexão não é consultado nesta tela. Os valores permanecem ocultos e não
            podem ser alterados pelo painel.
          </p>
        </div>
      </section>

      <section
        className="rounded-md border border-line bg-surface p-4"
        aria-labelledby="channel-config-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="channel-config-title" className="text-base font-semibold text-fg">
              Variáveis de ambiente necessárias
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Nomes usados pela Comunicação. Nenhum valor secreto é exibido.
            </p>
          </div>
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {CONFIGURATION_ITEMS.map(({ name, description, icon: Icon }) => (
            <div
              key={name}
              className="flex min-w-0 items-start gap-3 rounded-sm border border-line bg-surface-muted/40 px-3 py-2.5"
            >
              <Icon size={15} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="break-all font-mono text-xs font-medium text-fg">{name}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-fg-muted">
          Configure estas variáveis no painel do Vercel (Settings → Environment Variables) ou no
          arquivo .env local.
        </p>
      </section>
    </div>
  );
}
