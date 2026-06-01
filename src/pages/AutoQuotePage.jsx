import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, Upload, X, FileText, ExternalLink, Check, ArrowRight, Image as ImageIcon, Clock, AlertTriangle, RotateCcw } from 'lucide-react';
import { apiPost } from '@/lib/api.js';
import { capitalize, fmtPhone, formatBRL } from '@/lib/formatters.js';
import { buildQuotationViewUrl } from '@/lib/printFormats.js';
import {
  loadWhatsappFlows,
  getSelectedFlowId,
  saveSelectedFlowId,
  flowToSequencePayload,
} from '@/lib/whatsappFlows.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import Skeleton from '@/components/Skeleton.jsx';
import WhatsAppSendPanel from '@/components/WhatsAppSendPanel.jsx';
import DraftReviewCard from '@/components/DraftReviewCard.jsx';
import { useImageInput } from '@/hooks/useImageInput.js';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts.js';

// ── Phase constants ──
const PHASES = ['input', 'extracting', 'review', 'creating'];
const PHASE_LABELS = ['1. Entrada', '2. Extração', '3. Revisão', '4. Concluído'];


// ── Result total helper ──
function calculateResultTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
}

export default function AutoQuotePage() {
  // ── State ──
  const [phase, setPhase] = useState('input');
  const [text, setText] = useState('');
  const [prazo, setPrazo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [btnLabel, setBtnLabel] = useState('Gerar Orçamento');
  const [error, setError] = useState(null);
  const [whatsappFlows, setWhatsappFlows] = useState(() => loadWhatsappFlows());
  const [selectedWhatsappFlowId, setSelectedWhatsappFlowId] = useState(() => getSelectedFlowId(loadWhatsappFlows()));
  const selectedWhatsappFlow = whatsappFlows.find(f => f.id === selectedWhatsappFlowId) || whatsappFlows[0];
  const [waSendStatus, setWaSendStatus] = useState({});

  // ── Extracted hooks (drafts, pricing, product search, mutations) ──
  const {
    drafts, setDrafts,
    productSearch, setProductSearch,
    productTimer,
    fetchPricing,
    updateDraftItem, addDraftItem, removeDraftItem, reorderItems,
    updateDraftField, updateDraftAddressField,
    handleUrgenteToggle,
    approveDraft, discardDraft,
    onProductSearchChange, closeProductSearch, selectProduct,
    buildDraftsFromOrders,
  } = useExtractionDrafts();

  const dropZoneRef = useRef(null);
  const { imageData, imagePreview, imageInputRef, clearImage, handleImageFile, handleDragOver, handleDragLeave, handleDrop } = useImageInput();

  // ── Refresh WhatsApp flows on focus/storage ──
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

  // ── WhatsApp API send ──
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
      setWaSendStatus(prev => ({
        ...prev,
        [key]: { state: 'error', message: err.message || 'Falha ao enviar WhatsApp.' },
      }));
    }
  }, [selectedWhatsappFlow]);

  // ── Form submit ──
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!text.trim() && !imageData) { alert('Cole o texto ou uma imagem do pedido.'); return; }

    setSubmitting(true);
    setError(null);
    setBtnLabel('Analisando…');
    setPhase('extracting');

    // 1. Extract
    let orders;
    try {
      const res = await apiPost('/extract', {
        text: text || null,
        imageBase64: imageData?.base64 || null,
        imageMimeType: imageData?.mime || null,
      });
      orders = res.orders;
    } catch (err) {
      setError(err.message || 'Erro na extração.');
      setPhase('input');
      setSubmitting(false);
      setBtnLabel('Gerar Orçamento');
      return;
    }

    // 2. Build drafts
    const prazoVal = prazo.trim();
    let newDrafts = buildDraftsFromOrders(orders, prazoVal);

    // Fetch pricing
    const nonUrgent = newDrafts.filter(d => !d.edited.urgente);
    const urgent = newDrafts.filter(d => d.edited.urgente);
    if (nonUrgent.length > 0) newDrafts = await fetchPricing(nonUrgent, false);
    // Re-apply pricing to urgent separately
    if (urgent.length > 0) {
      const urgentPriced = await fetchPricing(urgent, true);
      // Merge back
    }

    setDrafts(newDrafts);
    setPhase('review');
    setBtnLabel(`Aguardando revisão (${newDrafts.filter(d => !d.discarded).length} rascunhos)`);

    // Store for session restore
    try { localStorage.setItem('aspen_drafts', JSON.stringify(newDrafts)); } catch {}

    // 3. Wait for all to be approved/discarded
    const checkApproval = () => {
      return new Promise(resolve => {
        const interval = setInterval(() => {
          setDrafts(prev => {
            const pending = prev.filter(d => !d.approved && !d.discarded);
            if (pending.length === 0) {
              clearInterval(interval);
              resolve(prev.filter(d => d.approved));
            } else {
              setBtnLabel(`Aguardando revisão (${pending.length} rascunhos restantes)`);
            }
            return prev;
          });
        }, 300);
      });
    };

    const approvedDrafts = await checkApproval();

    if (approvedDrafts.length === 0) {
      alert('Nenhum rascunho aprovado para criar. Refaça a extração ou edite os rascunhos.');
      handleReset();
      return;
    }

    // 4. Create quotations
    setPhase('creating');
    for (let di = 0; di < approvedDrafts.length; di++) {
      const draft = approvedDrafts[di];
      const i = draft.index;
      setBtnLabel(`Processando… (${di + 1}/${approvedDrafts.length})`);

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
          prazo_producao: draft.edited.prazo_producao || prazoVal || undefined,
        },
      };

      try {
        const res = await apiPost('/orcamento', payload);
        setDrafts(prev => {
          const next = [...prev];
          next[i] = { ...next[i], result: { success: true, data: res }, status: 'done' };
          return next;
        });
      } catch (err) {
        setDrafts(prev => {
          const next = [...prev];
          next[i] = { ...next[i], result: { success: false, error: err.message }, status: 'error' };
          return next;
        });
      }
    }

    try { localStorage.removeItem('aspen_drafts'); } catch {}

    // Stay at 'creating' — results are shown inline; no separate "complete" step
    setSubmitting(false);
    setBtnLabel('Gerar Orçamento');
  }, [text, imageData, prazo, drafts, fetchPricing]);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setPhase('input');
    setText('');
    setPrazo('');
    clearImage();
    setDrafts([]);
    setError(null);
    setSubmitting(false);
    setBtnLabel('Gerar Orçamento');
    setWaSendStatus({});
    setProductSearch({});
    try { localStorage.removeItem('aspen_drafts'); } catch {}
  }, []);

  // ── Render phases indicator ──
  const phaseIndex = PHASES.indexOf(phase);

  return (
    <div className="space-y-6">

      {/* Phase indicator */}
      <div className="rounded-[20px] border border-framer-hairline bg-card p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-4">
          {PHASE_LABELS.map((label, i) => {
            const cleanLabel = label.replace(/^\d+\.\s*/, '');
            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium transition-colors',
                  i < phaseIndex && 'bg-primary/10 text-primary',
                  i === phaseIndex && 'bg-primary text-primary-foreground shadow-sm',
                  i > phaseIndex && 'bg-framer-surface-1 text-framer-ink-muted',
                  phase === 'extracting' && error && i === phaseIndex && 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300',
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-current/10 text-[11px]">
                  {i < phaseIndex ? <Check size={13} /> : i + 1}
                </span>
                <span>{cleanLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Input form */}
      {phase === 'input' && (
        <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm md:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <label className="text-base font-semibold text-framer-ink">Pedido do cliente</label>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-framer-ink-muted">
                  Cole a conversa do WhatsApp, email ou briefing. Você ainda vai revisar tudo antes de criar.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Texto</span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Print</span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">SKUs</span>
              </div>
            </div>
            <textarea
              className="min-h-[300px] w-full resize-y rounded-[18px] border border-framer-hairline bg-framer-surface-1 px-4 py-4 text-sm leading-6 text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/30"
              placeholder={'Ex: João pediu 200 lenços de seda 70cm. Email joao@email.com, telefone (11) 99999-9999. Precisa para evento em 20 dias.\n\nTambém pode colar conversas longas ou vários pedidos de uma vez.'}
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={submitting}
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-framer-ink-muted">
                Ctrl+V aceita imagem copiada. O orçamento só será criado depois da revisão.
              </p>
              <Button type="submit" size="lg" disabled={submitting || (!text.trim() && !imageData)} className="w-full sm:w-auto">
                <Sparkles size={16} />
                {submitting ? btnLabel : 'Analisar pedido'}
                {!submitting && <ArrowRight size={16} />}
              </Button>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-framer-ink">Print ou imagem</h2>
                  <p className="mt-1 text-xs text-framer-ink-muted">Use quando o pedido vier em imagem.</p>
                </div>
                <ImageIcon size={18} className="text-primary" />
              </div>
              <div
                ref={dropZoneRef}
                className={cn(
                  'rounded-[18px] border border-dashed p-4 text-center transition-colors',
                  'hover:border-primary/50 hover:bg-primary/5',
                  imagePreview ? 'border-primary/40 bg-primary/5' : 'border-framer-hairline bg-framer-surface-1/60',
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {imagePreview ? (
                  <div className="space-y-3">
                    <img src={imagePreview} alt="Preview do pedido" className="mx-auto max-h-44 rounded-xl border border-framer-hairline" />
                    <Button type="button" variant="outline" size="sm" onClick={clearImage}>
                      <X size={14} /> Remover imagem
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full space-y-3 rounded-[16px] py-6 text-framer-ink-muted transition-colors hover:text-framer-ink"
                  >
                    <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Upload size={20} />
                    </span>
                    <span className="block text-sm font-medium">Arraste um print aqui</span>
                    <span className="block text-xs">ou clique para selecionar PNG, JPG ou WEBP</span>
                  </button>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); }}
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Clock size={16} className="text-primary" />
                <h2 className="text-sm font-semibold text-framer-ink">Prazo e regras</h2>
              </div>
              <label className="text-xs font-medium text-framer-ink-muted">Prazo personalizado</label>
              <Input
                placeholder="Ex: 10 a 15 dias úteis"
                value={prazo}
                onChange={e => setPrazo(e.target.value)}
                disabled={submitting}
                className="mt-2"
              />
              <p className="mt-2 text-xs text-framer-ink-muted">Opcional. Substitui o prazo padrão no orçamento gerado.</p>
            </div>
          </div>

          {error && (
            <div className="lg:col-span-2 rounded-[18px] border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Não consegui analisar este pedido</p>
                  <p>{error}</p>
                </div>
              </div>
            </div>
          )}
        </form>
      )}

      {/* Extracting — inline inside same card layout */}
      {phase === 'extracting' && !error && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="flex items-center justify-center rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm md:p-6 min-h-[320px]">
            <div className="flex flex-col items-center justify-center text-center w-full">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-5">
                <Sparkles size={24} />
              </div>
              <h2 className="text-lg font-semibold text-framer-ink">Analisando pedido</h2>
              <p className="mt-1 text-sm text-framer-ink-muted max-w-md">
                Estou preparando uma revisão antes de criar qualquer orçamento.
              </p>
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2 w-full max-w-lg">
                {['Lendo mensagem', 'Identificando cliente', 'Sugerindo produtos', 'Consultando preços'].map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl bg-framer-surface-2 p-3 text-sm text-framer-ink-muted">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-xs text-framer-ink-muted">
                {btnLabel}
              </p>
            </div>
          </div>

          <div className="space-y-5 opacity-50 pointer-events-none">
            <div className="rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-framer-ink">Print ou imagem</h2>
                  <p className="mt-1 text-xs text-framer-ink-muted">Use quando o pedido vier em imagem.</p>
                </div>
                <ImageIcon size={18} className="text-primary" />
              </div>
              <div
                className="rounded-[18px] border border-dashed p-4 text-center border-framer-hairline bg-framer-surface-1/60"
              >
                {imagePreview ? (
                  <div className="space-y-3">
                    <img src={imagePreview} alt="Preview do pedido" className="mx-auto max-h-44 rounded-xl border border-framer-hairline" />
                  </div>
                ) : (
                  <div className="w-full space-y-3 rounded-[16px] py-6 text-framer-ink-muted">
                    <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Upload size={20} />
                    </span>
                    <span className="block text-sm font-medium">Arraste um print aqui</span>
                    <span className="block text-xs">ou clique para selecionar PNG, JPG ou WEBP</span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Clock size={16} className="text-primary" />
                <h2 className="text-sm font-semibold text-framer-ink">Prazo e regras</h2>
              </div>
              <label className="text-xs font-medium text-framer-ink-muted">Prazo personalizado</label>
              <div className="mt-2 h-10 rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink-muted">
                {prazo || 'Padrão'}
              </div>
              <p className="mt-2 text-xs text-framer-ink-muted">Opcional. Substitui o prazo padrão no orçamento gerado.</p>
            </div>
          </div>
        </div>
      )}

      {/* Review phase */}
      {phase === 'review' && (
        <div className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-framer-ink">Revise antes de criar</h2>
              <p className="text-sm text-framer-ink-muted">Confira cliente, contato, produtos e valores. A criação só começa após a aprovação.</p>
            </div>
            <span className="text-xs font-medium text-framer-ink-muted">
              {drafts.filter(d => !d.discarded).length} pedido(s) em revisão
            </span>
          </div>

          {drafts.filter(d => !d.discarded).map((draft, displayIdx) => {
            const isApproved = draft.approved;
            const items = draft.edited.items;
            const total = calculateResultTotal(items);
            const validItems = items.filter(item => item.item_code && item.qty > 0).length;

            return (
              <DraftReviewCard
                draft={draft}
                displayIdx={displayIdx}
                totalDrafts={drafts.filter(d => !d.discarded).length}
                isApproved={isApproved}
                items={items}
                total={total}
                validItems={validItems}
                onApprove={approveDraft}
                onDiscard={discardDraft}
                updateDraftField={updateDraftField}
                updateDraftAddressField={updateDraftAddressField}
                onUrgenteToggle={handleUrgenteToggle}
                updateDraftItem={updateDraftItem}
                onProductSearchChange={onProductSearchChange}
                productSearch={productSearch}
                closeProductSearch={closeProductSearch}
                selectProduct={selectProduct}
                drafts={drafts}
                fetchPricing={fetchPricing}
                setDrafts={setDrafts}
                reorderItems={reorderItems}
                removeDraftItem={removeDraftItem}
                addDraftItem={addDraftItem}
              />
            );
          })}
        </div>
      )}

      {/* Creating phase — show results as they complete */}
      {phase === 'creating' && drafts.filter(d => d.status === 'done' || d.status === 'error').length > 0 && (
        <div className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-framer-ink">Central de envio</h2>
              <p className="text-sm text-framer-ink-muted">Orçamentos criados no ERP, prontos para abrir ou enviar ao cliente.</p>
            </div>
          </div>

          {drafts.filter(d => d.status === 'done' || d.status === 'error').map(draft => {
            const data = draft.result?.data;
            const total = calculateResultTotal(data?.items || []);
            const relativeViewUrl = data?.quotation_id ? buildQuotationViewUrl(data.quotation_id) : '';
            const waStatus = data?.quotation_id ? waSendStatus[data.quotation_id] : null;
            return (
              <div key={draft.index} className={cn(
                'overflow-hidden rounded-[24px] border border-framer-hairline bg-card shadow-sm',
                draft.status === 'done' && 'border-primary/30',
                draft.status === 'error' && 'border-red-300',
              )}>
                {draft.status === 'done' && data && (
                  <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-5 p-5">
                      <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Check size={20} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary">Orçamento criado</p>
                          <h3 className="mt-1 text-xl font-semibold tracking-tight text-framer-ink">{data.quotation_id}</h3>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-framer-ink-muted">
                            <span>{capitalize(data.cliente || draft.edited.nome)}</span>
                            <span className="rounded-full bg-framer-surface-1 px-2 py-0.5 text-xs">
                              {data.customer_new ? 'Cliente novo' : 'Cliente antigo'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {data.items && (
                        <details className="group rounded-[20px] border border-framer-hairline bg-framer-surface-1/40">
                          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-framer-ink">
                            Ver itens do orçamento
                            <span className="text-xs text-framer-ink-muted">{data.items.length} item(s)</span>
                          </summary>
                          <div className="overflow-x-auto border-t border-framer-hairline">
                            <table className="w-full min-w-[520px] text-xs">
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
                        onSelectFlow={(id) => {
                          setSelectedWhatsappFlowId(id);
                          saveSelectedFlowId(id);
                        }}
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="lg"
                          className="w-full"
                          onClick={handleReset}
                        >
                          <RotateCcw size={16} /> Novo orçamento
                        </Button>
                      </div>
                    </aside>
                  </div>
                )}

                {draft.status === 'error' && (
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
          })}
        </div>
      )}
    </div>
  );
}
