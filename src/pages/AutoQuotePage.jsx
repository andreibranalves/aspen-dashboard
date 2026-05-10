import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, Upload, X, Plus, Trash2, GripVertical, Phone, FileText, ExternalLink, Settings, Check, Pencil } from 'lucide-react';
import { apiPost } from '@/lib/api.js';
import { capitalize, fmtPhone, formatBRL } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import Skeleton from '@/components/Skeleton.jsx';

// ── Phase constants ──
const PHASES = ['input', 'extracting', 'review', 'creating', 'complete'];
const PHASE_LABELS = ['1. Entrada', '2. Extração', '3. Revisão', '4. Criação', '5. Concluído'];

// ── WhatsApp default template ──
const WA_DEFAULT = 'Olá, (nome)! Segue seu orçamento (numero_pedido). Qualquer dúvida estamos à disposição. — (empresa)';

// ── LocalStorage ──
const LS_RULES = 'aspen_rules';
const LS_WA = 'aspen_wa_template';

function loadRules() {
  try { return localStorage.getItem(LS_RULES) || ''; } catch { return ''; }
}
function saveRules(val) {
  try { localStorage.setItem(LS_RULES, val); } catch {}
}
function loadWaTemplate() {
  try { return localStorage.getItem(LS_WA) || WA_DEFAULT; } catch { return WA_DEFAULT; }
}
function saveWaTemplate(val) {
  try { localStorage.setItem(LS_WA, val); } catch {}
}

// ── WA template renderer ──
function renderWaTemplate(template, nome, numeroPedido) {
  if (!template) return '';
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (nome || '').split(' ')[0];
  return template
    .replace(/\(Saudacao\)/g, saudacao)
    .replace(/\(nome\)/g, nome || '')
    .replace(/\(primeiro_nome\)/g, primeiroNome)
    .replace(/\(numero_pedido\)/g, numeroPedido || '')
    .replace(/\(empresa\)/g, 'Aspen Estamparia')
    .replace(/\(link_orcamento\)/g, '');
}

function buildWaLink(telefone, nome, quotationId) {
  if (!telefone) return null;
  const digits = telefone.replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1');
  if (digits.length < 10) return null;
  const waNumber = '55' + digits;
  const template = loadWaTemplate();
  const text = renderWaTemplate(template, nome, quotationId);
  return 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(text);
}

// ── Card status helpers ──
function CardIcon({ status }) {
  switch (status) {
    case 'draft':    return <Pencil size={16} />;
    case 'approved': return <Check size={18} className="text-framer-success" />;
    case 'done':     return <Check size={18} className="text-framer-success font-bold" />;
    case 'error':    return <X size={18} className="text-red-400 font-bold" />;
    case 'processing':
    default:         return <Skeleton className="h-4 w-4 rounded-full" />;
  }
}

export default function AutoQuotePage() {
  // ── State ──
  const [phase, setPhase] = useState('input');
  const [text, setText] = useState('');
  const [prazo, setPrazo] = useState('');
  const [imageData, setImageData] = useState(null);  // { base64, mime }
  const [imagePreview, setImagePreview] = useState(null); // data URL for <img>
  const [drafts, setDrafts] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [btnLabel, setBtnLabel] = useState('Gerar Orçamento');
  const [error, setError] = useState(null);
  const [waTemplate, setWaTemplate] = useState(loadWaTemplate);
  const [rules, setRulesState] = useState(loadRules);
  const [showSettings, setShowSettings] = useState(false);

  const imageInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // ── Image handlers ──
  const handleImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageData({ base64: e.target.result.split(',')[1], mime: file.type });
      setImagePreview(e.target.result);
    };
    reader.readAsDataURL(file);
  }, []);

  const clearImage = useCallback(() => {
    setImageData(null);
    setImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, []);

  // ── Paste handler ──
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleImageFile(item.getAsFile());
          return;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handleImageFile]);

  // ── Drag handlers ──
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.add('ring-2', 'ring-primary');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.currentTarget.classList.remove('ring-2', 'ring-primary');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ring-2', 'ring-primary');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  }, [handleImageFile]);

  // ── Pricing lookup ──
  const fetchPricing = useCallback(async (draftsList, urgent) => {
    const allItems = [];
    const refs = [];
    for (let di = 0; di < draftsList.length; di++) {
      const items = draftsList[di].edited.items;
      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        if (it.item_code && it.qty > 0) {
          allItems.push({ item_code: it.item_code, qty: it.qty });
          refs.push({ di, ii });
        }
      }
    }
    if (allItems.length === 0) return draftsList;

    try {
      const res = await apiPost('/pricing-lookup', { items: allItems, urgent });
      if (!res.success || !Array.isArray(res.items)) return draftsList;

      const next = draftsList.map(d => ({
        ...d,
        edited: { ...d.edited, items: d.edited.items.map(it => ({ ...it })) },
      }));

      for (let i = 0; i < res.items.length && i < refs.length; i++) {
        const { di, ii } = refs[i];
        if (!next[di].edited.items[ii]._rateManual) {
          next[di].edited.items[ii].rate = res.items[i].rate;
          next[di].edited.items[ii].item_name = res.items[i].item_name || next[di].edited.items[ii].item_name;
        }
      }
      return next;
    } catch (err) {
      console.warn('[pricing]', err.message);
      return draftsList;
    }
  }, []);

  // ── Draft item mutations ──
  const updateDraftItem = useCallback((draftIdx, itemIdx, field, value) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = [...next[draftIdx].edited.items];
      items[itemIdx] = { ...items[itemIdx], [field]: value };
      if (field === 'rate') items[itemIdx]._rateManual = true;
      if (field === 'item_code') delete items[itemIdx]._rateManual;
      if (field === 'qty') delete items[itemIdx]._rateManual;
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

  const addDraftItem = useCallback((draftIdx) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = [...next[draftIdx].edited.items, { item_code: '', qty: 30, rate: null }];
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

  const removeDraftItem = useCallback((draftIdx, itemIdx) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = next[draftIdx].edited.items.filter((_, i) => i !== itemIdx);
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

  const approveDraft = useCallback((draftIdx) => {
    setDrafts(prev => {
      const next = [...prev];
      const d = next[draftIdx];
      const items = d.edited.items.filter(it => it.item_code && it.qty > 0);
      if (items.length === 0) { alert('Adicione ao menos um item com SKU e quantidade > 0.'); return prev; }
      if (!d.edited.nome?.trim()) { alert('Informe o nome do cliente antes de aprovar.'); return prev; }
      next[draftIdx] = { ...d, approved: true };
      return next;
    });
  }, []);

  const discardDraft = useCallback((draftIdx) => {
    setDrafts(prev => {
      const next = [...prev];
      next[draftIdx] = { ...next[draftIdx], discarded: true };
      return next;
    });
  }, []);

  // ── Reorder items via drag ──
  const reorderItems = useCallback((draftIdx, fromIdx, toIdx) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = [...next[draftIdx].edited.items];
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

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
        rules: rules || undefined,
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
    let newDrafts = orders.map((order, i) => ({
      index: i,
      original: { ...order },
      edited: {
        nome: order.nome || '',
        email: order.email || '',
        telefone: order.telefone || '',
        urgente: order.urgente || false,
        items: (order.items || []).map(it => ({
          item_code: it.item_code || '',
          qty: it.qty || 0,
          rate: it.rate || null,
        })),
        prazo_producao: prazoVal || '',
      },
      approved: false,
      discarded: false,
    }));

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
      setSubmitting(false);
      setBtnLabel('Gerar Orçamento');
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

    const allDone = approvedDrafts.every(d => {
      const dr = drafts.find(dd => dd.index === d.index);
      return dr?.result?.success;
    });
    setPhase(allDone ? 'complete' : 'creating');
    setSubmitting(false);
    setBtnLabel('Gerar Orçamento');
  }, [text, imageData, prazo, rules, drafts, fetchPricing]);

  // ── Render phases indicator ──
  const phaseIndex = PHASES.indexOf(phase);

  return (
    <div className="space-y-6">
      {/* Phase indicator */}
      <div className="flex w-full items-center justify-center gap-2 text-sm flex-wrap">
        {PHASE_LABELS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors',
              i < phaseIndex && 'bg-framer-success/10 text-framer-success',
              i === phaseIndex && 'bg-framer-surface-2 text-framer-ink',
              i > phaseIndex && 'bg-framer-canvas text-framer-ink-muted',
              phase === 'extracting' && error && i === phaseIndex && 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
            )}>
              {label}
            </span>
            {i < PHASE_LABELS.length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </div>
        ))}
      </div>

      {/* Input form (phase input) */}
      {(phase === 'input' || phase === 'extracting') && (
        <form onSubmit={handleSubmit} className="bg-card rounded-lg border border-border shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Pedido</label>
            <p className="text-sm text-muted-foreground mb-2">
              Cole a mensagem do cliente ou descreva o pedido. A IA extrai nome, contato, urgência e os produtos sugeridos.
            </p>
            <textarea
              className="w-full min-h-[160px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25 resize-y"
              placeholder={'Ex: 200 lenços seda 70cm para João Silva, joao@email.com, (11) 99999-9999\n\nOu descreva o pedido em linguagem natural…'}
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Você pode colar texto, usar Ctrl+V com imagem ou arrastar um arquivo.
            </p>
          </div>

          {/* Image upload */}
          <div
            ref={dropZoneRef}
            className={cn(
              'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
              'hover:border-primary/50 hover:bg-muted/30',
              imagePreview ? 'border-primary/30 bg-muted/20' : 'border-muted-foreground/20',
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {imagePreview ? (
              <div className="space-y-3">
                <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded border" />
                <p className="text-xs text-muted-foreground">Imagem anexada</p>
                <Button type="button" variant="outline" size="sm" onClick={clearImage}>
                  <X size={14} /> Remover imagem
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="space-y-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Upload size={28} className="mx-auto" />
                <p className="text-sm font-medium">Arraste uma imagem aqui</p>
                <p className="text-xs">ou clique para selecionar PNG, JPG ou WEBP</p>
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

          {/* Prazo */}
          <div>
            <label className="block text-sm font-medium mb-1">Prazo de produção</label>
            <Input
              placeholder="Ex: 10 a 15 dias úteis após confirmação do pagamento"
              value={prazo}
              onChange={e => setPrazo(e.target.value)}
              disabled={submitting}
              className="max-w-md"
            />
            <p className="text-xs text-muted-foreground mt-1">Opcional — substitui o prazo padrão no orçamento gerado.</p>
          </div>

          {/* Error */}
          {error && (
<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
              <p className="font-medium">Erro na extração</p>
              <p>{error}</p>
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting || (!text.trim() && !imageData)}>
              <Sparkles size={16} />
              {btnLabel}
            </Button>
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
            >
              <Settings size={14} /> Config
            </button>
          </div>
        </form>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-card rounded-lg border border-border shadow-sm p-6 space-y-4">
          <h3 className="font-medium">Configurações</h3>
          <div>
            <label className="text-sm font-medium">Regras de extração</label>
            <p className="text-xs text-muted-foreground mb-1">
              Instruções adicionais enviadas ao modelo na extração (uma por linha).
            </p>
            <textarea
              className="w-full min-h-[100px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25 resize-y"
              value={rules}
              onChange={e => { setRulesState(e.target.value); saveRules(e.target.value); }}
              placeholder="Ex: Sempre incluir SKU-XYZ para pedidos acima de 100 unidades…"
            />
            <button
              type="button"
              className="text-xs text-primary hover:underline mt-1"
              onClick={() => { setRulesState(''); saveRules(''); }}
            >
              Restaurar padrão
            </button>
          </div>
          <div>
            <label className="text-sm font-medium">Template WhatsApp</label>
            <p className="text-xs text-muted-foreground mb-1">
              Variáveis: (nome), (primeiro_nome), (numero_pedido), (empresa), (Saudacao), (link_orcamento)
            </p>
            <textarea
              className="w-full min-h-[80px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25 resize-y"
              value={waTemplate}
              onChange={e => { setWaTemplate(e.target.value); saveWaTemplate(e.target.value); }}
            />
            <button
              type="button"
              className="text-xs text-primary hover:underline mt-1"
              onClick={() => { setWaTemplate(WA_DEFAULT); saveWaTemplate(WA_DEFAULT); }}
            >
              Restaurar padrão
            </button>
          </div>
        </div>
      )}

      {/* Extracting indicator */}
      {phase === 'extracting' && !error && (
        <div className="flex flex-col items-center py-12 text-muted-foreground gap-4" aria-label="Analisando pedido com IA">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <p className="text-sm">Analisando pedido com IA… Isso pode levar alguns segundos.</p>
        </div>
      )}

      {/* Review phase — Show draft cards */}
      {phase === 'review' && (
        <div className="space-y-4">
          {drafts.filter(d => !d.discarded).map((draft, displayIdx) => {
            const i = draft.index;
            const isApproved = draft.approved;
            const items = draft.edited.items;

            return (
              <div
                key={i}
                className={cn(
                  'bg-card rounded-lg border border-border shadow-sm p-5 space-y-3 transition-all',
                  isApproved && 'border-framer-success/30 bg-framer-success/5',
                )}
              >
                {/* Header */}
                <div className="flex items-center gap-3">
                  <CardIcon status={isApproved ? 'approved' : 'draft'} />
                  <div className="flex-1 flex items-center gap-3 flex-wrap">
                    <Input
                      className="h-8 max-w-[200px] text-sm"
                      value={draft.edited.nome}
                      onChange={e => {
                        setDrafts(prev => {
                          const next = [...prev];
                          next[i] = { ...next[i], edited: { ...next[i].edited, nome: e.target.value } };
                          return next;
                        });
                      }}
                      placeholder="Nome do cliente"
                      disabled={isApproved}
                    />
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.edited.urgente}
                        onChange={async e => {
                          setDrafts(prev => {
                            const next = [...prev];
                            next[i] = { ...next[i], edited: { ...next[i].edited, urgente: e.target.checked } };
                            return next;
                          });
                          // Trigger pricing refresh for urgent toggle
                          const updated = drafts.map(d => d.index === i ? { ...d, edited: { ...d.edited, urgente: e.target.checked } } : d);
                          const priced = await fetchPricing([updated[i]], e.target.checked);
                          setDrafts(prev => {
                            const next = [...prev];
                            next[i] = priced[0];
                            return next;
                          });
                        }}
                        disabled={isApproved}
                      />
                      {draft.edited.urgente && <span className="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 text-xs font-bold px-2 py-0.5 rounded">Urgente</span>}
                      {!draft.edited.urgente && 'Urgente'}
                    </label>
                  </div>
                  <span className="text-xs text-muted-foreground">{displayIdx + 1}/{drafts.filter(d => !d.discarded).length} · revisão</span>
                </div>

                {/* Contacts */}
                <div className="flex gap-2">
                  <Input
                    className="h-8 max-w-[220px] text-sm"
                    value={draft.edited.email}
                    onChange={e => {
                      setDrafts(prev => {
                        const next = [...prev];
                        next[i] = { ...next[i], edited: { ...next[i].edited, email: e.target.value } };
                        return next;
                      });
                    }}
                    placeholder="email@exemplo.com"
                    disabled={isApproved}
                  />
                  <Input
                    className="h-8 max-w-[180px] text-sm"
                    value={fmtPhone(draft.edited.telefone)}
                    onChange={e => {
                      setDrafts(prev => {
                        const next = [...prev];
                        next[i] = { ...next[i], edited: { ...next[i].edited, telefone: e.target.value } };
                        return next;
                      });
                    }}
                    placeholder="(99) 99999-9999"
                    disabled={isApproved}
                  />
                </div>

                {/* Items table */}
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="w-8 p-2"></th>
                        <th className="text-left p-2">SKU</th>
                        <th className="text-right p-2 w-20">Qtd</th>
                        <th className="text-right p-2 w-24">R$/un</th>
                        <th className="w-8 p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, ii) => {
                        const amount = (item.qty || 0) * (item.rate || 0);
                        return (
                          <tr
                            key={ii}
                            draggable={!isApproved}
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', String(ii));
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                            onDrop={e => {
                              e.preventDefault();
                              const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                              if (from !== ii) reorderItems(i, from, ii);
                            }}
                            className="border-t hover:bg-muted/30 transition-colors"
                          >
                            <td className="p-1 text-center text-muted-foreground cursor-grab">
                              <GripVertical size={12} />
                            </td>
                            <td className="p-1">
                              <Input
                                className="h-7 text-xs font-mono"
                                value={item.item_code}
                                onChange={e => updateDraftItem(i, ii, 'item_code', e.target.value)}
                                onBlur={async () => {
                                  if (!items[ii]._rateManual) {
                                    const priced = await fetchPricing([drafts.find(d => d.index === i) || drafts[i]], drafts[i].edited.urgente);
                                    setDrafts(prev => {
                                      const next = [...prev];
                                      next[i] = priced[0];
                                      return next;
                                    });
                                  }
                                }}
                                placeholder="SKU"
                                disabled={isApproved}
                              />
                            </td>
                            <td className="p-1">
                              <Input
                                type="number"
                                min="1"
                                className="h-7 text-xs w-20 ml-auto"
                                value={item.qty || ''}
                                onChange={e => { const v = Number(e.target.value); if (!isNaN(v)) updateDraftItem(i, ii, 'qty', v); }}
                                onBlur={async () => {
                                  if (!items[ii]._rateManual) {
                                    const priced = await fetchPricing([drafts.find(d => d.index === i) || drafts[i]], drafts[i].edited.urgente);
                                    setDrafts(prev => {
                                      const next = [...prev];
                                      next[i] = priced[0];
                                      return next;
                                    });
                                  }
                                }}
                                disabled={isApproved}
                              />
                            </td>
                            <td className="p-1">
                              <div className="flex items-center gap-1 justify-end">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="h-7 text-xs w-20"
                                  value={item.rate || ''}
                                  onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateDraftItem(i, ii, 'rate', v); }}
                                  placeholder="—"
                                  disabled={isApproved}
                                />
                                <span className="text-xs text-muted-foreground w-16 text-right font-mono">
                                  {formatBRL(amount)}
                                </span>
                              </div>
                            </td>
                            <td className="p-1 text-center">
                              {!isApproved && (
                                <button
                                  onClick={() => removeDraftItem(i, ii)}
                                  className="text-muted-foreground hover:text-red-600 transition-colors"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!isApproved && (
                    <button
                      onClick={() => addDraftItem(i)}
                      className="w-full p-2 text-xs text-muted-foreground hover:bg-muted/50 border-t transition-colors"
                    >
                      <Plus size={12} className="inline mr-1" /> Adicionar item
                    </button>
                  )}
                </div>

                {/* Actions */}
                {!isApproved && (
                  <div className="flex gap-2">
                    <Button onClick={() => approveDraft(i)} variant="default" size="sm">
                      <Check size={16} className="mr-1" /> Aprovar e criar
                    </Button>
                    <Button onClick={() => discardDraft(i)} variant="ghost" size="sm">
                      <X size={16} className="mr-1" /> Descartar
                    </Button>
                  </div>
                )}

                {/* Result (after creation) */}
                {(draft.status === 'done' && draft.result?.data) && (
                  <div className="mt-3 p-3 bg-framer-success/10 border border-framer-success/30 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'inline-block w-2.5 h-2.5 rounded-full',
                        draft.result.data.customer_new ? 'bg-framer-success' : 'bg-red-500',
                      )} />
                      <span className="text-sm font-medium">
                        {capitalize(draft.result.data.cliente || draft.edited.nome)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {draft.result.data.customer_new ? 'Cliente novo' : 'Cliente antigo'}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">{draft.result.data.quotation_id}</span>
                    </div>
                    {/* Items summary */}
                    {draft.result.data.items && (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left">SKU</th>
                            <th className="text-right">Qtd</th>
                            <th className="text-right">R$/un</th>
                            <th className="text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draft.result.data.items.map((item, idx) => (
                            <tr key={idx}>
                              <td className="font-mono">{item.sku}</td>
                              <td className="text-right">{item.qty}</td>
                              <td className="text-right">{formatBRL(item.rate)}</td>
                              <td className="text-right">{formatBRL(item.qty * item.rate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <a
                        href={`/api/view?q=${encodeURIComponent(draft.result.data.quotation_id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          <FileText size={14} /> Abrir orçamento
                        </Button>
                      </a>
                      {buildWaLink(draft.edited.telefone, draft.result.data.cliente, draft.result.data.quotation_id) && (
                        <a
                          href={buildWaLink(draft.edited.telefone, draft.result.data.cliente, draft.result.data.quotation_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="outline" size="sm" className="text-framer-success">
                            <Phone size={14} /> Enviar WhatsApp
                          </Button>
                        </a>
                      )}
                      <a
                        href={`https://aspenestamparia.l.frappe.cloud/desk/quotation/${encodeURIComponent(draft.result.data.quotation_id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          <ExternalLink size={14} /> Ver no Frappe
                        </Button>
                      </a>
                    </div>
                  </div>
                )}

                {draft.status === 'error' && (
<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
                    Erro: {draft.result?.error || 'Falha desconhecida'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Creating / Complete phase */}
      {(phase === 'creating' || phase === 'complete') && drafts.filter(d => d.status === 'done' || d.status === 'error').length > 0 && (
        <div className="space-y-4">
          {drafts.filter(d => d.status === 'done' || d.status === 'error').map(draft => (
            <div key={draft.index} className={cn(
              'bg-card rounded-lg border border-border shadow-sm p-5',
              draft.status === 'done' && 'border-emerald-300',
              draft.status === 'error' && 'border-red-300',
            )}>
              {draft.status === 'done' && draft.result?.data && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'inline-block w-2.5 h-2.5 rounded-full',
                      draft.result.data.customer_new ? 'bg-emerald-500' : 'bg-red-400',
                    )} />
                    <span className="font-medium">{capitalize(draft.result.data.cliente || draft.edited.nome)}</span>
                    <span className="text-xs text-muted-foreground">
                      {draft.result.data.customer_new ? 'Cliente novo' : 'Cliente antigo'}
                    </span>
                    <span className="text-xs font-mono">{draft.result.data.quotation_id}</span>
                  </div>
                  {draft.result.data.items && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b">
                          <th className="text-left pb-1">SKU</th>
                          <th className="text-right pb-1">Qtd</th>
                          <th className="text-right pb-1">R$/un</th>
                          <th className="text-right pb-1">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.result.data.items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="font-mono">{item.sku}</td>
                            <td className="text-right">{item.qty}</td>
                            <td className="text-right">{formatBRL(item.rate)}</td>
                            <td className="text-right">{formatBRL(item.qty * item.rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="flex gap-2">
                    <a href={`/api/view?q=${encodeURIComponent(draft.result.data.quotation_id)}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm"><FileText size={14} /> Abrir</Button>
                    </a>
                    {buildWaLink(draft.edited.telefone, draft.result.data.cliente, draft.result.data.quotation_id) && (
                      <a href={buildWaLink(draft.edited.telefone, draft.result.data.cliente, draft.result.data.quotation_id)} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="text-framer-success"><Phone size={14} /> WhatsApp</Button>
                      </a>
                    )}
                  </div>
                </div>
              )}
              {draft.status === 'error' && (
                <div className="text-red-700 dark:text-red-300 text-sm">
                  <span className="font-medium">{capitalize(draft.edited.nome)}</span> — Erro: {draft.result?.error || 'Falha desconhecida'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
