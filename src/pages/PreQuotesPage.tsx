import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Search, Trash2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  fetchPreQuotes,
  updatePreQuote,
  type PreQuoteLead,
  type PreQuoteStatus,
} from '@/lib/preQuotesApi';
import { fmtPhone, formatDate } from '@/lib/formatters';

const STATUS_FILTERS: Array<{ value: PreQuoteStatus | 'all'; label: string }> = [
  { value: 'new', label: 'Novos' },
  { value: 'incomplete', label: 'Incompletos' },
  { value: 'ready', label: 'Prontos' },
  { value: 'reviewing', label: 'Em revisão' },
  { value: 'converted', label: 'Convertidos' },
  { value: 'discarded', label: 'Descartados' },
  { value: 'all', label: 'Todos' },
];

const SOURCE_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'typebot', label: 'Typebot' },
  { value: 'site_form', label: 'Formulário' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'manual', label: 'Manual' },
];

function sourceLabel(source?: string): string {
  if (source === 'site_form') return 'Formulário';
  if (source === 'typebot') return 'Typebot';
  if (source === 'whatsapp') return 'WhatsApp';
  if (source === 'manual') return 'Manual';
  return source || 'Origem desconhecida';
}

function statusLabel(status?: string): string {
  if (status === 'incomplete') return 'Incompleto';
  if (status === 'ready') return 'Pronto';
  if (status === 'reviewing') return 'Em revisão';
  if (status === 'converted') return 'Convertido';
  if (status === 'discarded') return 'Descartado';
  return 'Novo';
}

function attributionLabel(lead: PreQuoteLead): string {
  const attr = lead.attribution;
  if (attr?.gclid) return 'Google Ads';
  if (attr?.fbclid || attr?.utm_source === 'meta') return 'Meta';
  if (attr?.utm_source) return attr.utm_source;
  return 'Sem tracking';
}

interface PreQuotesPageProps {
  navigate?: (path: string) => void;
}

export default function PreQuotesPage({ navigate }: PreQuotesPageProps) {
  const [status, setStatus] = useState<PreQuoteStatus | 'all'>('new');
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<PreQuoteLead[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const selected = useMemo(
    () => leads.find((lead) => lead.id === selectedId) || leads[0] || null,
    [leads, selectedId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPreQuotes({ status, source, q: query, limit: 50 });
      setLeads(data);
      setSelectedId((current) =>
        current && data.some((lead) => lead.id === current) ? current : data[0]?.id || ''
      );
    } catch (err) {
      setError((err as Error).message || 'Erro ao carregar pré-orçamentos.');
    } finally {
      setLoading(false);
    }
  }, [query, source, status]);

  useEffect(() => {
    load();
  }, [load]);

  const markStatus = useCallback(async (lead: PreQuoteLead, nextStatus: PreQuoteStatus) => {
    if (!lead.id) return;
    setSavingId(lead.id);
    try {
      const updated = await updatePreQuote(lead.id, { status: nextStatus });
      setLeads((prev) => prev.map((item) => (item.id === lead.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message || 'Erro ao atualizar pré-orçamento.');
    } finally {
      setSavingId(null);
    }
  }, []);

  const useInAuto = useCallback(
    (lead: PreQuoteLead) => {
      try {
        window.sessionStorage.setItem('aspen_prequote_text', lead.texto || lead.pedidoTexto || '');
        window.sessionStorage.setItem('aspen_prequote_id', lead.id);
      } catch {
        // sessionStorage unavailable (SSR, restricted browser) — silently skip
      }
      navigate?.('/auto');
    },
    [navigate]
  );

  return (
    <div className="space-y-5 animate-fade-in max-w-[1180px] mx-auto pb-10">
      <PageHeader title="Pré-orçamentos" />

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === item.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-muted text-fg-muted hover:text-fg'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {SOURCE_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSource(item.value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  source === item.value
                    ? 'bg-primary/10 text-primary'
                    : 'bg-surface-muted text-fg-muted hover:text-fg'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <div className="relative w-full md:w-72">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nome, email, telefone…"
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-4">
        <section className="rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
          <div className="border-b border-line px-4 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Fila</h2>
            <span className="text-xs text-fg-muted">
              {leads.length} item{leads.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 rounded-lg bg-surface-muted animate-pulse" />
              ))}
            </div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-center text-sm text-fg-muted">
              Nenhum pré-orçamento encontrado.
            </div>
          ) : (
            <div className="max-h-[640px] overflow-y-auto p-2">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setSelectedId(lead.id)}
                  className={cn(
                    'w-full rounded-lg p-3 text-left transition-colors hover:bg-surface-muted',
                    selected?.id === lead.id && 'bg-primary/5 ring-1 ring-primary/20'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {lead.nome || 'Nome não identificado'}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {fmtPhone(lead.telefone) || lead.email || 'Contato não identificado'}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
                      {statusLabel(lead.status)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                      {sourceLabel(lead.source)}
                    </span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
                      {attributionLabel(lead)}
                    </span>
                    {lead.updatedAt && (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
                        {formatDate(lead.updatedAt)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface shadow-sm min-h-[420px]">
          {!selected ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center text-fg-muted">
              <FileText size={36} className="mb-3 opacity-50" />
              <p>Selecione um pré-orçamento para revisar.</p>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-fg">
                    {selected.nome || 'Nome não identificado'}
                  </h2>
                  <p className="text-sm text-fg-muted">
                    {[fmtPhone(selected.telefone), selected.email].filter(Boolean).join(' · ') ||
                      'Contato não identificado'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => markStatus(selected, 'reviewing')}
                    disabled={savingId === selected.id}
                  >
                    <CheckCircle2 size={14} />
                    Em revisão
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => useInAuto(selected)}>
                    <FileText size={14} />
                    Extrair no Auto
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markStatus(selected, 'discarded')}
                    disabled={savingId === selected.id}
                  >
                    <Trash2 size={14} />
                    Descartar
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-line p-3">
                  <span className="text-xs text-fg-muted">Origem</span>
                  <p className="font-medium">
                    {sourceLabel(selected.source)} · {attributionLabel(selected)}
                  </p>
                </div>
                <div className="rounded-lg border border-line p-3">
                  <span className="text-xs text-fg-muted">Status</span>
                  <p className="font-medium">{statusLabel(selected.status)}</p>
                </div>
                <div className="rounded-lg border border-line p-3">
                  <span className="text-xs text-fg-muted">Produto</span>
                  <p className="font-medium">{selected.produto || 'Não informado'}</p>
                </div>
                <div className="rounded-lg border border-line p-3">
                  <span className="text-xs text-fg-muted">Quantidade</span>
                  <p className="font-medium">{selected.quantidade || 'Não informada'}</p>
                </div>
              </div>

              {selected.missingFields?.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                  Faltando: {selected.missingFields.join(', ')}
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-fg">Pedido</h3>
                <pre className="whitespace-pre-wrap rounded-xl border border-line bg-surface-muted p-3 text-sm text-fg">
                  {selected.texto || selected.pedidoTexto || 'Sem pedido informado.'}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
