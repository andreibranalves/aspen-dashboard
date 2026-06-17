import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ExternalLink, FileText, ShoppingCart, Truck, DollarSign, Check } from 'lucide-react';
import { apiGet } from '@/lib/api.js';
import { formatBRL, capitalize } from '@/lib/formatters.js';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';

const STATUS_LABELS = {
  Draft: 'Rascunho',
  'On Hold': 'Em espera',
  'To Pay': 'A pagar',
  'To Deliver and Bill': 'A entregar e faturar',
  'To Bill': 'A faturar',
  'To Deliver': 'A entregar',
  Completed: 'Concluído',
  Cancelled: 'Cancelado',
  Closed: 'Fechado',
};

export default function SalesOrderDetailPage({ id, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet(`/sales-orders?id=${encodeURIComponent(id)}`);
      setData(result);
    } catch (err) {
      setError(err.message || 'Erro ao carregar pedido.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-40 bg-surface-muted rounded animate-pulse" />
        <div className="bg-surface rounded-lg border border-line shadow-sm p-6 space-y-4">
          <div className="h-8 w-48 bg-surface-muted rounded animate-pulse" />
          <div className="grid grid-cols-3 gap-6">
            <div className="h-12 bg-surface-muted rounded animate-pulse" />
            <div className="h-12 bg-surface-muted rounded animate-pulse" />
            <div className="h-12 bg-surface-muted rounded animate-pulse" />
          </div>
          <div className="h-40 bg-surface-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/sales-orders')}
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft size={14} /> Voltar para Pedidos de Venda
        </button>
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <div className="text-destructive/60">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <p>Erro ao carregar pedido</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={fetchDetail}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const items = data.items || [];
  const grandTotal = data.grand_total ?? data.rounded_total ?? items.reduce((s, it) => s + (it.amount || it.qty * it.rate || 0), 0);
  const perDelivered = data.per_delivered ?? 0;
  const perBilled = data.per_billed ?? 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Back */}
      <button
        onClick={() => navigate('/sales-orders')}
        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Voltar para lista
      </button>

      {/* Header Card */}
      <div className="bg-surface rounded-lg border border-line shadow-sm">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold">{data.id}</span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                data.status === 'Completed'
                  ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-success/80 dark:border-green-800/40'
                  : data.status === 'Cancelled' || data.status === 'Closed'
                  ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-destructive/60 dark:border-red-800/40'
                  : data.status === 'Draft'
                  ? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700/40'
                  : 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800/40'
              }`}
            >
              {STATUS_LABELS[data.status] || data.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* ERPNext link */}
            <a
              href={`https://aspenestamparia.l.frappe.cloud/app/sales-order/${data.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink size={14} /> Abrir no ERPNext
              </Button>
            </a>
            {/* Link to source quotation */}
            {data.source_quotation && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/quotations/${data.source_quotation}`)}
              >
                <FileText size={14} /> Voltar ao orçamento
              </Button>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="px-6 py-4 border-b grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <span className="text-xs text-fg-muted">Cliente</span>
            <p className="font-medium">{data.customer || data.cliente || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Data</span>
            <p>{data.date || data.data || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Entrega</span>
            <p>{data.delivery_date || '—'}</p>
          </div>
          <div className="space-y-1">
            <div>
              <span className="text-xs text-fg-muted">Entregue</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(perDelivered, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono">{perDelivered}%</span>
              </div>
            </div>
            <div>
              <span className="text-xs text-fg-muted">Faturado</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${Math.min(perBilled, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono">{perBilled}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left py-2 px-1 font-medium text-fg-muted text-xs uppercase tracking-wider">SKU</th>
                <th className="text-left py-2 px-1 font-medium text-fg-muted text-xs uppercase tracking-wider">Produto</th>
                <th className="text-right py-2 px-1 font-medium text-fg-muted text-xs uppercase tracking-wider">Qtd</th>
                <th className="text-right py-2 px-1 font-medium text-fg-muted text-xs uppercase tracking-wider">Un</th>
                <th className="text-right py-2 px-1 font-medium text-fg-muted text-xs uppercase tracking-wider">Preço un.</th>
                <th className="text-right py-2 px-1 font-medium text-fg-muted text-xs uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-line/50 last:border-0">
                  <td className="py-2 px-1 font-mono text-xs">{item.item_code}</td>
                  <td className="py-2 px-1">{item.item_name || item.item_code}</td>
                  <td className="py-2 px-1 text-right">{item.qty}</td>
                  <td className="py-2 px-1 text-right text-fg-muted">{item.uom || 'und'}</td>
                  <td className="py-2 px-1 text-right font-mono">{formatBRL(item.rate)}</td>
                  <td className="py-2 px-1 text-right font-mono">{formatBRL(item.amount || item.qty * item.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total row */}
        <div className="px-6 py-3 border-t text-right font-semibold text-base">
          Total: {formatBRL(grandTotal)}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <DollarSign size={14} />
            <span>Faturado: {perBilled}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Truck size={14} />
            <span>Entregue: {perDelivered}%</span>
          </div>
          {data.status === 'Completed' && (
            <div className="flex items-center gap-1.5 text-xs text-success dark:text-success/80">
              <Check size={14} />
              <span>Concluído</span>
            </div>
          )}
          <div className="flex-1" />
          <a
            href={`https://aspenestamparia.l.frappe.cloud/app/sales-order/${data.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm">
              <ExternalLink size={14} /> Abrir no ERPNext
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
