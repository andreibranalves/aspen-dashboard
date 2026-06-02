import { useState, useCallback, useEffect } from 'react';
import { Sparkles, FileText, ExternalLink, Check, AlertTriangle, RotateCcw, History } from 'lucide-react';
import { apiPost, apiGet } from '@/lib/api.js';
import { capitalize, formatBRL, formatDate } from '@/lib/formatters.js';
import { buildQuotationViewUrl } from '@/lib/printFormats.js';
import {
  loadWhatsappFlows,
  getSelectedFlowId,
  saveSelectedFlowId,
  flowToSequencePayload,
} from '@/lib/whatsappFlows.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import WhatsAppSendPanel from '@/components/WhatsAppSendPanel.jsx';
import SplitResultCard from '@/components/SplitResultCard.jsx';
import { useImageInput } from '@/hooks/useImageInput.js';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts.js';

// ── Result total helper ──
function calculateResultTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
}

export default function AutoQuotePage() {
  // ── Input state ──
  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── WhatsApp flows ──
  const [whatsappFlows, setWhatsappFlows] = useState(() => loadWhatsappFlows());
  const [selectedWhatsappFlowId, setSelectedWhatsappFlowId] = useState(() => getSelectedFlowId(loadWhatsappFlows()));
  const selectedWhatsappFlow = whatsappFlows.find(f => f.id === selectedWhatsappFlowId) || whatsappFlows[0];
  const [waSendStatus, setWaSendStatus] = useState({});

  // ── Extracted hooks ──
  const {
    drafts, setDrafts,
    productSearch, setProductSearch,
    fetchPricing,
    updateDraftItem, addDraftItem, removeDraftItem, reorderItems,
    updateDraftField, updateDraftAddressField,
    handleUrgenteToggle,
    approveDraft, discardDraft,
    onProductSearchChange, closeProductSearch, selectProduct,
    buildDraftsFromOrders,
  } = useExtractionDrafts();

  // ── Image input ──
  const { imageData, clearImage, handleImageFile } = useImageInput();

  // ── Refresh WhatsApp flows ──
  useEffect(() => {
    const refreshFlows = () => {
      const loaded = loadWhatsappFlows();
      setWhatsappFlows(loaded);
      setSelectedWhatsappFlowId(prev => loaded.some(flow => flow.id === prev) ? prev : getSelectedFlowId(loaded));
    };
    window.addEventListener('focus', refreshFlows);
    window.addEventListener('storage', refreshFlows);
    return () => {
      window.removeEventListener('focus', refreshFlows);
      window.removeEventListener('storage', refreshFlows);
    };
  }, []);

  // ── Load recent quotations ──
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiGet('/quotations?limit=3&order_by=creation+desc');
      if (res.data) setHistory(res.data.slice(0, 3));
    } catch { /* non-critical */ }
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Remove main padding so panels fill viewport edge-to-edge ──
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const orig = main.className;
    main.className = orig
      .replace(/\bp-4\b/g, '')
      .replace(/\bmd:p-6\b/g, '')
      .replace(/\s+/g, ' ').trim();
    return () => { main.className = orig; };
  }, []);

  // ── WhatsApp send ──
  const handleSendWhatsApp = useCallback(async (draft, resultData) => {
    if (!resultData?.quotation_id) return;
    const key = resultData.quotation_id;
    const linkOrcamento = new URL(buildQuotationViewUrl(resultData.quotation_id), window.location.origin).toString();
    setWaSendStatus(prev => ({ ...prev, [key]: { state: 'sending', message: 'Enviando sequência…' } }));
    try {
      const sequencePayload = selectedWhatsappFlow ? flowToSequencePayload(selectedWhatsappFlow) : null;
      const response = await apiPost('/send-whatsapp', {
        quotation_id: resultData.quotation_id,
        deal_id: resultData.deal_id,
        nome: resultData.cliente || draft.edited.nome,
        telefone: draft.edited.telefone,
        link_orcamento: linkOrcamento,
        pdf_url: resultData.pdf_url,
        items: resultData.items || draft.edited.items,
        whatsapp_sequence: sequencePayload,
      });
      const count = response.steps?.length || 1;
      setWaSendStatus(prev => ({ ...prev, [key]: { state: 'sent', message: `${count} envio(s) realizados pelo WhatsApp.` } }));
    } catch (err) {
      setWaSendStatus(prev => ({ ...prev, [key]: { state: 'error', message: err.message || 'Falha ao enviar WhatsApp.' } }));
    }
  }, [selectedWhatsappFlow]);

  // ── Extract text → build drafts ──
  const handleExtract = useCallback(async () => {
    if (!text.trim() && !imageData) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await apiPost('/extract', {
        text: text || null,
        imageBase64: imageData?.base64 || null,
        imageMimeType: imageData?.mime || null,
      });
      const orders = res.orders;
      if (!orders || orders.length === 0) {
        setError('Nenhum pedido identificado no texto.');
        setExtracting(false);
        return;
      }
      let newDrafts = buildDraftsFromOrders(orders, '');
      const nonUrgent = newDrafts.filter(d => !d.edited.urgente);
      if (nonUrgent.length > 0) newDrafts = await fetchPricing(nonUrgent, false);
      const urgent = newDrafts.filter(d => d.edited.urgente);
      if (urgent.length > 0) await fetchPricing(urgent, true);
      setDrafts(newDrafts);
      try { localStorage.setItem('aspen_drafts', JSON.stringify(newDrafts)); } catch {}
      loadHistory();
    } catch (err) {
      setError(err.message || 'Erro na extração.');
    } finally {
      setExtracting(false);
    }
  }, [text, imageData, fetchPricing, buildDraftsFromOrders, loadHistory]);

  // ── Create single quotation (draftIndex = draft.index, not array index) ──
  const createSingleQuote = useCallback(async (draftIndex) => {
    setDrafts(prev => {
      const idx = prev.findIndex(d => d.index === draftIndex);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: 'processing' };
      return next;
    });
    const draft = await new Promise(resolve => {
      setDrafts(prev => { resolve(prev.find(d => d.index === draftIndex)); return prev; });
    });
    if (!draft) return;
    const payload = {
      extracted: {
        nome: draft.edited.nome,
        email: draft.edited.email || null,
        telefone: draft.edited.telefone || null,
        urgente: draft.edited.urgente,
        origem: draft.edited.origem || undefined,
        cnpj: draft.edited.cnpj || undefined,
        endereco: draft.edited.endereco || undefined,
        items: draft.edited.items
          .filter(it => it.item_code && it.qty > 0)
          .map(it => ({
            item_code: it.item_code,
            qty: it.qty,
            rate: it.rate,
            manual_rate: it._rateManual === true,
          })),
        prazo_producao: draft.edited.prazo_producao || undefined,
      },
    };
    try {
      const res = await apiPost('/orcamento', payload);
      setDrafts(prev => {
        const idx = prev.findIndex(d => d.index === draftIndex);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], result: { success: true, data: res }, status: 'done' };
        return next;
      });
      loadHistory();
    } catch (err) {
      setDrafts(prev => {
        const idx = prev.findIndex(d => d.index === draftIndex);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], result: { success: false, error: err.message }, status: 'error' };
        return next;
      });
    }
  }, [loadHistory]);

  // ── Load history item: fetch detail and format as text ──
  const loadHistoryItem = useCallback(async (item) => {
    setError(null);
    try {
      const res = await apiGet(`/quotations?id=${encodeURIComponent(item.id)}`);
      if (!res) return;
      const nome = res.cliente || item.cliente || 'Cliente';
      const email = res.email || '';
      const telefone = res.telefone || '';
      const itemsText = (res.items || []).map(it => `${it.item_code} ${it.qty} un`).join(', ');
      const formatted = [
        `Nome: ${nome}`,
        email ? `E-mail: ${email}` : 'E-mail:',
        telefone ? `Telefone: ${telefone}` : 'Telefone:',
        itemsText ? `Pedido: ${itemsText}` : 'Pedido:',
      ].join('\n');
      setText(formatted);
      document.querySelector('.panel-left')?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setText(`${item.id} — ${item.cliente || 'Cliente'}`);
    }
  }, []);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setText('');
    clearImage();
    setDrafts([]);
    setError(null);
    setExtracting(false);
    setWaSendStatus({});
    setProductSearch({});
    try { localStorage.removeItem('aspen_drafts'); } catch {}
  }, []);

  const activeDrafts = drafts.filter(d => !d.discarded);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL (50%) ── */}
        <div className="panel-left flex flex-col w-full lg:w-1/2 min-w-0 border-r border-framer-hairline bg-card overflow-hidden">
          <div className="px-4 md:px-6 pt-4 md:pt-5 space-y-4">

            {/* Page title */}
            <h1 className="text-lg font-semibold text-framer-ink">Pedido do cliente</h1>

            {/* Text input */}
            <div>
              <textarea
                className="mt-2 w-full min-h-[130px] resize-none rounded-xl border border-framer-hairline bg-framer-surface-1 px-4 py-3 text-sm leading-6 text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/30"
                placeholder={'Ex: João pediu 200 lenços de seda 70cm. Email joao@email.com, telefone (11) 99999-9999.\n\nTambém pode colar conversas longas ou vários pedidos de uma vez.'}
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={extracting}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (items) {
                    for (const item of items) {
                      if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        handleImageFile(item.getAsFile());
                        return;
                      }
                    }
                  }
                }}
              />
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleExtract}
                disabled={extracting || (!text.trim() && !imageData)}
                size="sm"
              >
                {extracting ? (
                  <><span className="spinner mr-2" />Extraindo…</>
                ) : (
                  <><Sparkles size={14} />Extrair</>
                )}
              </Button>

              {(text || imageData) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                >
                  <RotateCcw size={14} />
                  Limpar
                </Button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Erro na extração</p>
                    <p className="text-xs mt-0.5">{error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Recent History ── */}
          <div className="border-t border-framer-hairline px-4 md:px-6 pt-5 pb-3 mt-auto">
            <div className="flex items-center gap-2 mb-2">
              <History size={14} className="text-framer-ink-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-framer-ink-muted">Recentes</h3>
            </div>
            {historyLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-10 rounded-lg bg-framer-surface-2 animate-pulse" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-framer-ink-muted">Nenhum orçamento recente.</p>
            ) : (
              <div className="space-y-1">
                {history.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => loadHistoryItem(item)}
                    className={cn(
                      'w-full flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm hover:bg-framer-surface-2 transition-colors',
                      idx === history.length - 1 && 'pb-1'
                    )}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-framer-ink truncate">{item.cliente || 'Cliente'}</p>
                      <p className="text-xs text-framer-ink-muted truncate">{item.id}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[11px] text-framer-ink-muted whitespace-nowrap">
                        {formatDate(item.data)}
                      </span>
                      <span className="text-xs font-medium text-framer-ink whitespace-nowrap">
                        {formatBRL(item.valor)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL (50%) ── */}
        <div className="w-full lg:w-1/2 min-w-0 overflow-y-auto bg-framer-canvas px-4 md:px-6 pt-4 md:pt-5 pb-0">
          {activeDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-framer-surface-2 mb-4">
                <FileText size={32} className="text-framer-ink-muted" />
              </div>
              <h2 className="text-lg font-semibold text-framer-ink">Nenhum pedido extraído</h2>
              <p className="mt-1 max-w-sm text-sm text-framer-ink-muted">
                Cole o texto do pedido no painel esquerdo e clique em <strong>Extrair</strong> para gerar orçamentos.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-framer-ink">
                  Resultados ({activeDrafts.length})
                </h2>
              </div>

              {activeDrafts.map((draft, displayIdx) => {
                const isDone = draft.status === 'done';
                const isError = draft.status === 'error';
                const isProcessing = draft.status === 'processing';

                if (isDone || isError) {
                  const data = draft.result?.data;
                  const total = calculateResultTotal(data?.items || []);
                  const relativeViewUrl = data?.quotation_id ? buildQuotationViewUrl(data.quotation_id) : '';
                  const waStatus = data?.quotation_id ? waSendStatus[data.quotation_id] : null;

                  return (
                    <div key={draft.index} className={cn(
                      'overflow-hidden rounded-[20px] border shadow-sm',
                      isDone ? 'border-framer-accent-blue/30 bg-card' : 'border-red-300 bg-card',
                    )}>
                      {isDone && data && (
                        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                          <div className="space-y-4 p-5">
                            <div className="flex items-start gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <Check size={18} />
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-primary">Orçamento criado</p>
                                <h3 className="mt-1 text-lg font-semibold tracking-tight text-framer-ink">{data.quotation_id}</h3>
                                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-framer-ink-muted">
                                  <span>{capitalize(data.cliente || draft.edited.nome)}</span>
                                  <span className="rounded-full bg-framer-surface-1 px-2 py-0.5 text-xs">
                                    {data.customer_new ? 'Cliente novo' : 'Cliente antigo'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {data.items && (
                              <details className="group rounded-xl border border-framer-hairline bg-framer-surface-1/40">
                                <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-medium text-framer-ink">
                                  Ver itens do orçamento
                                  <span className="text-xs text-framer-ink-muted">{data.items.length} item(s)</span>
                                </summary>
                                <div className="overflow-x-auto border-t border-framer-hairline">
                                  <table className="w-full min-w-[400px] text-xs">
                                    <thead className="text-framer-ink-muted">
                                      <tr>
                                        <th className="p-3 text-left">SKU</th>
                                        <th className="p-3 text-right">Qtd</th>
                                        <th className="p-3 text-right">R$/un</th>
                                        <th className="p-3 text-right">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {data.items.map((item, idx) => (
                                        <tr key={idx} className="border-t border-framer-hairline">
                                          <td className="p-3 font-mono">{item.sku}</td>
                                          <td className="p-3 text-right">{item.qty}</td>
                                          <td className="p-3 text-right">{formatBRL(item.rate)}</td>
                                          <td className="p-3 text-right font-medium text-framer-ink">{formatBRL(item.qty * item.rate)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </details>
                            )}
                          </div>
                          <aside className="border-t border-framer-hairline bg-framer-surface-1/50 p-5 lg:border-l lg:border-t-0">
                            <p className="text-xs font-medium text-framer-ink-muted">Total</p>
                            <p className="mt-1 text-3xl font-semibold tracking-tight text-framer-ink">{formatBRL(total)}</p>
                            <WhatsAppSendPanel
                              selectedFlowId={selectedWhatsappFlowId}
                              flows={whatsappFlows}
                              status={waStatus}
                              onSelectFlow={(id) => { setSelectedWhatsappFlowId(id); saveSelectedFlowId(id); }}
                              onSend={() => handleSendWhatsApp(draft, data)}
                            />
                            <div className="space-y-2">
                              <a href={relativeViewUrl || '#'} target="_blank" rel="noopener noreferrer" className="block">
                                <Button variant="outline" size="lg" className="w-full">
                                  <FileText size={16} /> Abrir orçamento
                                </Button>
                              </a>
                              <a href={`https://aspenestamparia.l.frappe.cloud/desk/quotation/${encodeURIComponent(data.quotation_id)}`} target="_blank" rel="noopener noreferrer" className="block">
                                <Button variant="outline" size="lg" className="w-full">
                                  <ExternalLink size={16} /> Ver no Frappe
                                </Button>
                              </a>
                            </div>
                          </aside>
                        </div>
                      )}
                      {isError && (
                        <div className="flex items-start gap-3 p-5 text-sm text-red-700 dark:text-red-300">
                          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                          <div>
                            <p className="font-medium">Falha ao criar orçamento para {capitalize(draft.edited.nome)}</p>
                            <p>{draft.result?.error || 'Falha desconhecida'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                // Draft card (review mode) — compact split-panel card
                return (
                  <SplitResultCard
                    key={draft.index}
                    draft={draft}
                    displayIdx={displayIdx}
                    totalDrafts={activeDrafts.filter(d => d.status !== 'done' && d.status !== 'error').length}
                    isProcessing={isProcessing}
                    onUpdateField={updateDraftField}
                    onUpdateItem={updateDraftItem}
                    onRemoveItem={removeDraftItem}
                    onCreateQuote={createSingleQuote}
                    onDelete={discardDraft}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
