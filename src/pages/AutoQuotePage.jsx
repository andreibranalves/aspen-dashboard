import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, Upload, X, Plus, GripVertical, Phone, FileText, ExternalLink, Settings, Check, Pencil, ArrowRight, Mail, User, Package, Image as ImageIcon, Clock, AlertTriangle, Loader2, Search, RotateCcw } from 'lucide-react';
import { apiPost, apiGet } from '@/lib/api.js';
import { capitalize, fmtPhone, formatBRL, formatPhoneInput, normalizePhoneDigits } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import Skeleton from '@/components/Skeleton.jsx';

// ── Phase constants ──
const PHASES = ['input', 'extracting', 'review', 'creating'];
const PHASE_LABELS = ['1. Entrada', '2. Extração', '3. Revisão', '4. Concluído'];

// ── WhatsApp default template ──
const WA_DEFAULT = 'Olá, (nome)! Segue seu orçamento (numero_pedido). Qualquer dúvida estamos à disposição. — (empresa)';
const WA_SEQUENCE_DEFAULT = {
  enabled: true,
  vendor_name: 'Juliana',
  delay_min_seconds: 5,
  delay_max_seconds: 8,
  max_images_per_category: 2,
  greeting_template: 'Olá, (primeiro_nome), tudo bem?',
  context_template: 'Meu nome é (vendedora), da (empresa). Estou entrando em contato sobre o seu orçamento de (produto_resumo) personalizado(a).',
  quotation_template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)',
  samples_intro_template: 'Também estou te enviando algumas fotos de referência dos modelos para você visualizar melhor as opções.',
  sample_images_text: '',
};

// ── LocalStorage ──
const LS_RULES = 'aspen_rules';
const LS_WA = 'aspen_wa_template';
const LS_WA_SEQUENCE = 'aspen_wa_sequence_config';

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
function loadWaSequenceConfig() {
  try {
    const raw = localStorage.getItem(LS_WA_SEQUENCE);
    return raw ? { ...WA_SEQUENCE_DEFAULT, ...JSON.parse(raw) } : WA_SEQUENCE_DEFAULT;
  } catch {
    return WA_SEQUENCE_DEFAULT;
  }
}
function saveWaSequenceConfig(val) {
  try { localStorage.setItem(LS_WA_SEQUENCE, JSON.stringify({ ...WA_SEQUENCE_DEFAULT, ...val })); } catch {}
}
function parseSampleImages(text = '') {
  const map = {};
  String(text || '').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separatorIndex = trimmed.includes('=') ? trimmed.indexOf('=') : trimmed.indexOf(':');
    if (separatorIndex <= 0) return;
    const category = trimmed.slice(0, separatorIndex).trim();
    const urlsRaw = trimmed.slice(separatorIndex + 1).trim();
    if (!category || !urlsRaw) return;
    const urls = urlsRaw.split(',').map(url => url.trim()).filter(Boolean);
    if (urls.length) map[category] = urls;
  });
  return map;
}
function buildWaSequencePayload(config = WA_SEQUENCE_DEFAULT) {
  const sampleImages = parseSampleImages(config.sample_images_text);
  const hasSampleImages = Object.keys(sampleImages).length > 0;
  return {
    vendor_name: config.vendor_name || 'Juliana',
    delay_min_ms: Math.max(0, Math.round((Number(config.delay_min_seconds) || 0) * 1000)),
    delay_max_ms: Math.max(0, Math.round((Number(config.delay_max_seconds) || 0) * 1000)),
    max_images_per_category: Math.max(0, Math.round(Number(config.max_images_per_category) || 0)),
    sample_images: sampleImages,
    steps: [
      { type: 'text', template: config.greeting_template },
      { type: 'text', template: config.context_template },
      { type: 'text', template: config.quotation_template },
      hasSampleImages ? { type: 'text', template: config.samples_intro_template } : null,
      hasSampleImages ? { type: 'product_images' } : null,
    ].filter(step => step && (step.type === 'product_images' || String(step.template || '').trim())),
  };
}

// ── WA template renderer ──
function renderWaTemplate(template, nome, numeroPedido, linkOrcamento = '') {
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
    .replace(/\(link_orcamento\)/g, linkOrcamento || '');
}

function buildWaLink(telefone, nome, quotationId, linkOrcamento = '') {
  if (!telefone) return null;
  const digits = telefone.replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1');
  if (digits.length < 10) return null;
  const waNumber = '55' + digits;
  const template = loadWaTemplate();
  const text = renderWaTemplate(template, nome, quotationId, linkOrcamento);
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

function calculateItemsTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
}

function calculateResultTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
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
  const [waSequence, setWaSequence] = useState(loadWaSequenceConfig);
  const [rules, setRulesState] = useState(loadRules);
  const [showSettings, setShowSettings] = useState(false);
  const [waSendStatus, setWaSendStatus] = useState({});

  // ── Product search state (callbacks defined after pricing/mutation helpers) ──
  const [productSearch, setProductSearch] = useState({});     // { [draftIdx]: { term, results, loading, open } }
  const productTimer = useRef(null);

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
      const items = [...next[draftIdx].edited.items, { item_code: '', qty: 30, rate: null, _rateManual: true }];
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

  // ── Product search (review phase SKU autocomplete — after all deps) ──
  const searchProducts = useCallback(async (draftIdx, term) => {
    if (!term || term.length < 2) {
      setProductSearch(prev => ({ ...prev, [draftIdx]: { term, results: [], loading: false, open: false } }));
      return;
    }
    setProductSearch(prev => ({ ...prev, [draftIdx]: { ...prev[draftIdx], term, loading: true, open: true } }));
    try {
      const res = await apiGet(`/products?search=${encodeURIComponent(term)}&limit=6`);
      setProductSearch(prev => ({ ...prev, [draftIdx]: { term, results: res.data || [], loading: false, open: true } }));
    } catch {
      setProductSearch(prev => ({ ...prev, [draftIdx]: { term, results: [], loading: false, open: true } }));
    }
  }, []);

  const onProductSearchChange = useCallback((draftIdx, val) => {
    setProductSearch(prev => ({ ...prev, [draftIdx]: { ...prev[draftIdx], term: val, open: true } }));
    clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => searchProducts(draftIdx, val), 300);
  }, [searchProducts]);

  const selectProduct = useCallback(async (draftIdx, itemIdx, product) => {
    updateDraftItem(draftIdx, itemIdx, 'item_code', product.sku);
    updateDraftItem(draftIdx, itemIdx, 'item_name', product.nome || '');
    setProductSearch(prev => ({ ...prev, [draftIdx]: { term: product.sku, results: [], loading: false, open: false } }));
    // Trigger pricing
    const draft = drafts.find(d => d.index === draftIdx);
    if (draft) {
      const priced = await fetchPricing([draft], draft.edited.urgente);
      setDrafts(prev => {
        const next = [...prev];
        next[draftIdx] = priced[0];
        return next;
      });
    }
  }, [drafts, fetchPricing, updateDraftItem]);

  const closeProductSearch = useCallback((draftIdx) => {
    setProductSearch(prev => ({ ...prev, [draftIdx]: { ...prev[draftIdx], open: false } }));
  }, []);

  // ── WhatsApp API send ──
  const updateWaSequence = useCallback((patch) => {
    setWaSequence(prev => {
      const next = { ...prev, ...patch };
      saveWaSequenceConfig(next);
      return next;
    });
  }, []);

  const handleSendWhatsApp = useCallback(async (draft, resultData) => {
    if (!resultData?.quotation_id) return;
    const key = resultData.quotation_id;
    const linkOrcamento = resultData.short_url || `${window.location.origin}/api/view?q=${encodeURIComponent(resultData.quotation_id)}`;
    setWaSendStatus(prev => ({ ...prev, [key]: { state: 'sending', message: 'Enviando sequência…' } }));
    try {
      const sequencePayload = waSequence.enabled ? buildWaSequencePayload(waSequence) : null;
      const response = await apiPost('/send-whatsapp', {
        quotation_id: resultData.quotation_id,
        deal_id: resultData.deal_id,
        nome: resultData.cliente || draft.edited.nome,
        telefone: draft.edited.telefone,
        template: waTemplate,
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
  }, [waTemplate, waSequence]);

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
    // Stay at 'creating' — results are shown inline; no separate "complete" step
    setSubmitting(false);
    setBtnLabel('Gerar Orçamento');
  }, [text, imageData, prazo, rules, drafts, fetchPricing]);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setPhase('input');
    setText('');
    setPrazo('');
    setImageData(null);
    setImagePreview(null);
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
                  i < phaseIndex && 'bg-framer-success/10 text-framer-success',
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
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-framer-hairline px-3 py-2 text-xs font-medium text-framer-ink-muted transition-colors hover:border-primary/30 hover:text-primary"
              >
                <Settings size={14} /> Regras de extração
              </button>
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

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-[24px] border border-framer-hairline bg-card p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-framer-ink">Regras operacionais</h3>
              <p className="mt-1 text-sm text-framer-ink-muted">Ajustes finos enviados para a IA e modelo de mensagem do WhatsApp.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
              <X size={14} /> Fechar
            </Button>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Regras de extração</label>
              <p className="mb-2 mt-1 text-xs text-muted-foreground">
                Instruções adicionais enviadas ao modelo na extração, uma por linha.
              </p>
              <textarea
                className="min-h-[140px] w-full resize-y rounded-[16px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                value={rules}
                onChange={e => { setRulesState(e.target.value); saveRules(e.target.value); }}
                placeholder="Ex: Sempre incluir SKU-XYZ para pedidos acima de 100 unidades."
              />
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary hover:underline"
                onClick={() => { setRulesState(''); saveRules(''); }}
              >
                Restaurar padrão
              </button>
            </div>
            <div>
              <label className="text-sm font-medium">Template WhatsApp</label>
              <p className="mb-2 mt-1 text-xs text-muted-foreground">
                Variáveis: (nome), (primeiro_nome), (numero_pedido), (empresa), (Saudacao), (link_orcamento)
              </p>
              <textarea
                className="min-h-[140px] w-full resize-y rounded-[16px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                value={waTemplate}
                onChange={e => { setWaTemplate(e.target.value); saveWaTemplate(e.target.value); }}
              />
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary hover:underline"
                onClick={() => { setWaTemplate(WA_DEFAULT); saveWaTemplate(WA_DEFAULT); }}
              >
                Restaurar padrão
              </button>
            </div>
          </div>
          <div className="mt-6 rounded-[20px] border border-framer-hairline bg-framer-surface-1/40 p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-framer-ink">Sequência de WhatsApp</h4>
                <p className="mt-1 text-xs text-framer-ink-muted">Envia mensagens separadas com intervalo e fotos por produto. Variáveis extras: (vendedora), (produto_resumo).</p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-framer-hairline px-3 py-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={waSequence.enabled}
                  onChange={e => updateWaSequence({ enabled: e.target.checked })}
                />
                Usar sequência
              </label>
            </div>
            <div className="grid gap-4 lg:grid-cols-4">
              <label className="space-y-1">
                <span className="text-xs font-medium text-framer-ink-muted">Vendedora</span>
                <Input value={waSequence.vendor_name} onChange={e => updateWaSequence({ vendor_name: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-framer-ink-muted">Intervalo mín. (s)</span>
                <Input type="number" min="0" value={waSequence.delay_min_seconds} onChange={e => updateWaSequence({ delay_min_seconds: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-framer-ink-muted">Intervalo máx. (s)</span>
                <Input type="number" min="0" value={waSequence.delay_max_seconds} onChange={e => updateWaSequence({ delay_max_seconds: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-framer-ink-muted">Fotos/categoria</span>
                <Input type="number" min="0" max="6" value={waSequence.max_images_per_category} onChange={e => updateWaSequence({ max_images_per_category: e.target.value })} />
              </label>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {[
                ['greeting_template', 'Mensagem 1 — saudação'],
                ['context_template', 'Mensagem 2 — contexto'],
                ['quotation_template', 'Mensagem 3 — orçamento/link'],
                ['samples_intro_template', 'Mensagem 4 — introdução das fotos'],
              ].map(([key, label]) => (
                <label key={key} className="space-y-1">
                  <span className="text-xs font-medium text-framer-ink-muted">{label}</span>
                  <textarea
                    className="min-h-[74px] w-full resize-y rounded-[16px] border border-framer-hairline bg-card px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                    value={waSequence[key] || ''}
                    onChange={e => updateWaSequence({ [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-framer-ink-muted">Fotos por categoria</span>
              <textarea
                className="min-h-[92px] w-full resize-y rounded-[16px] border border-framer-hairline bg-card px-3 py-2 font-mono text-xs text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                value={waSequence.sample_images_text || ''}
                onChange={e => updateWaSequence({ sample_images_text: e.target.value })}
                placeholder={'canga: https://site/canga-01.jpg, https://site/canga-02.jpg\nlenço: https://site/lenco-01.jpg'}
              />
            </label>
          </div>
        </div>
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
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-framer-hairline px-3 py-2 text-xs font-medium text-framer-ink-muted">
                <Settings size={14} /> Regras de extração
              </div>
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
            const i = draft.index;
            const isApproved = draft.approved;
            const items = draft.edited.items;
            const total = calculateItemsTotal(items);
            const validItems = items.filter(item => item.item_code && item.qty > 0).length;

            return (
              <div
                key={i}
                className={cn(
                  'overflow-hidden rounded-[24px] border border-framer-hairline bg-card shadow-sm transition-all',
                  isApproved && 'border-framer-success/40 bg-framer-success/5',
                )}
              >
                <div className="flex flex-col gap-4 border-b border-framer-hairline bg-framer-surface-1/50 p-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                      isApproved ? 'bg-framer-success/10 text-framer-success' : 'bg-primary/10 text-primary',
                    )}>
                      <CardIcon status={isApproved ? 'approved' : 'draft'} />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-framer-ink-muted">Pedido {displayIdx + 1} de {drafts.filter(d => !d.discarded).length}</span>
                        {isApproved && <span className="rounded-full bg-framer-success/10 px-2 py-0.5 text-xs font-medium text-framer-success">Aprovado</span>}
                        {draft.edited.urgente && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">Urgente</span>}
                      </div>
                      <Input
                        className="mt-2 h-10 max-w-[320px] border-transparent bg-transparent px-0 text-lg font-semibold text-framer-ink shadow-none focus-visible:ring-0"
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
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-framer-hairline bg-card px-5 py-4 text-left lg:min-w-[220px] lg:text-right">
                    <p className="text-xs font-medium text-framer-ink-muted">Total estimado</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-framer-ink">{formatBRL(total)}</p>
                  </div>
                </div>

                <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-5">
                    <div className="rounded-[20px] border border-framer-hairline bg-framer-surface-1/40 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-framer-ink">
                        <User size={16} className="text-primary" /> Cliente
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-framer-ink-muted">Email</span>
                          <div className="relative">
                            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-framer-ink-muted" />
                            <Input
                              className="h-10 pl-9 text-sm"
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
                          </div>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-framer-ink-muted">Telefone</span>
                          <div className="relative">
                            <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-framer-ink-muted" />
                            <Input
                              className="h-10 pl-9 text-sm"
                              value={formatPhoneInput(draft.edited.telefone)}
                              onChange={e => {
                                setDrafts(prev => {
                                  const next = [...prev];
                                  next[i] = { ...next[i], edited: { ...next[i].edited, telefone: normalizePhoneDigits(e.target.value) } };
                                  return next;
                                });
                              }}
                              placeholder="(99) 99999-9999"
                              disabled={isApproved}
                            />
                          </div>
                        </label>
                      </div>
                      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-framer-hairline px-3 py-2 text-xs font-medium text-framer-ink-muted">
                        <input
                          type="checkbox"
                          checked={draft.edited.urgente}
                          onChange={async e => {
                            setDrafts(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], edited: { ...next[i].edited, urgente: e.target.checked } };
                              return next;
                            });
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
                        Pedido urgente
                      </label>
                    </div>

                    <div className="overflow-hidden rounded-[20px] border border-framer-hairline">
                      <div className="flex items-center justify-between gap-3 border-b border-framer-hairline bg-framer-surface-1/50 px-4 py-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-framer-ink">
                          <Package size={16} className="text-primary" /> Itens sugeridos
                        </div>
                        <span className="text-xs text-framer-ink-muted">{validItems} item(s) válidos</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[680px] text-sm">
                          <thead className="bg-framer-surface-1/70 text-xs text-framer-ink-muted">
                            <tr>
                              <th className="w-10 p-3"></th>
                              <th className="p-3 text-left">Produto</th>
                              <th className="w-24 p-3 text-right">Qtd</th>
                              <th className="w-28 p-3 text-right">R$/un</th>
                              <th className="w-28 p-3 text-right">Total</th>
                              <th className="w-10 p-3"></th>
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
                                  className="border-t border-framer-hairline transition-colors hover:bg-primary/5"
                                >
                              <td className="p-2 text-center text-muted-foreground">
                                <GripVertical size={14} className={cn(!isApproved && 'cursor-grab')} />
                              </td>
                              <td className="p-2 relative">
                                <div className="relative">
                                  <Input
                                    className="h-9 font-mono text-xs pr-8"
                                    value={item.item_code}
                                    onChange={e => {
                                      updateDraftItem(i, ii, 'item_code', e.target.value);
                                      onProductSearchChange(i, e.target.value);
                                    }}
                                    onBlur={() => {
                                      setTimeout(() => closeProductSearch(i), 200);
                                      if (!items[ii]._rateManual) {
                                        const draft = drafts.find(d => d.index === i) || drafts[i];
                                        if (draft) {
                                          fetchPricing([draft], draft.edited.urgente).then(priced => {
                                            setDrafts(prev => { const next = [...prev]; next[i] = priced[0]; return next; });
                                          });
                                        }
                                      }
                                    }}
                                    onFocus={() => {
                                      if (item.item_code) onProductSearchChange(i, item.item_code);
                                    }}
                                    placeholder="SKU"
                                    disabled={isApproved}
                                  />
                                  {productSearch[i]?.loading && (
                                    <Loader2 size={14} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
                                  )}
                                </div>
                                {productSearch[i]?.open && productSearch[i]?.results?.length > 0 && (
                                  <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                                    {productSearch[i].results.map(p => (
                                      <button
                                        key={p.sku}
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                                        onMouseDown={e => {
                                          e.preventDefault();
                                          selectProduct(i, ii, p);
                                        }}
                                      >
                                        <div className="min-w-0">
                                          <span className="font-mono text-framer-accent-blue">{p.sku}</span>
                                          <span className="text-framer-ink-muted ml-2">{p.nome}</span>
                                        </div>
                                        {p.categoria && <span className="text-[10px] text-muted-foreground shrink-0">{p.categoria}</span>}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {item.item_name && <p className="mt-1 text-xs text-framer-ink-muted">{item.item_name}</p>}
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min="1"
                                  className="ml-auto h-9 w-20 text-right text-xs"
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
                                  <td className="p-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="ml-auto h-9 w-24 text-right text-xs"
                                      value={item.rate || ''}
                                      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateDraftItem(i, ii, 'rate', v); }}
                                      placeholder="0,00"
                                      disabled={isApproved}
                                    />
                                  </td>
                                  <td className="p-2 text-right text-sm font-medium text-framer-ink">{formatBRL(amount)}</td>
                                  <td className="p-2 text-center">
                                    {!isApproved && (
                                      <button
                                        type="button"
                                        onClick={() => removeDraftItem(i, ii)}
                                        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600"
                                        aria-label="Remover item"
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
                      </div>
                      {!isApproved && (
                        <button
                          type="button"
                          onClick={() => addDraftItem(i)}
                          className="flex w-full items-center justify-center gap-2 border-t border-framer-hairline p-3 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                        >
                          <Plus size={14} /> Adicionar produto
                        </button>
                      )}
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-[20px] border border-framer-hairline bg-framer-surface-1/50 p-4">
                      <h3 className="text-sm font-semibold text-framer-ink">Resumo</h3>
                      <dl className="mt-3 space-y-3 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt className="text-framer-ink-muted">Produtos</dt>
                          <dd className="font-medium text-framer-ink">{items.length}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-framer-ink-muted">Unidades</dt>
                          <dd className="font-medium text-framer-ink">{items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-framer-ink-muted">Prazo</dt>
                          <dd className="max-w-[140px] text-right font-medium text-framer-ink">{draft.edited.prazo_producao || 'Padrão'}</dd>
                        </div>
                        <div className="border-t border-framer-hairline pt-3">
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-framer-ink-muted">Total</dt>
                            <dd className="text-lg font-semibold text-framer-ink">{formatBRL(total)}</dd>
                          </div>
                        </div>
                      </dl>
                    </div>
                    {!isApproved && (
                      <div className="space-y-2">
                        <Button onClick={() => approveDraft(i)} variant="default" size="lg" className="w-full">
                          <Check size={16} /> Aprovar e criar orçamento
                        </Button>
                        <Button onClick={() => discardDraft(i)} variant="ghost" size="lg" className="w-full">
                          <X size={16} /> Descartar pedido
                        </Button>
                      </div>
                    )}
                  </aside>
                </div>
              </div>
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
            const linkOrcamento = data?.short_url || (data?.quotation_id ? `${window.location.origin}/api/view?q=${encodeURIComponent(data.quotation_id)}` : '');
            const waLink = data ? buildWaLink(draft.edited.telefone, data.cliente, data.quotation_id, linkOrcamento) : null;
            const waStatus = data?.quotation_id ? waSendStatus[data.quotation_id] : null;
            return (
              <div key={draft.index} className={cn(
                'overflow-hidden rounded-[24px] border border-framer-hairline bg-card shadow-sm',
                draft.status === 'done' && 'border-framer-success/30',
                draft.status === 'error' && 'border-red-300',
              )}>
                {draft.status === 'done' && data && (
                  <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-5 p-5">
                      <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-framer-success/10 text-framer-success">
                          <Check size={20} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-framer-success">Orçamento criado</p>
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
                      <div className="mt-5 space-y-2">
                        <Button
                          type="button"
                          size="lg"
                          className="w-full"
                          disabled={waStatus?.state === 'sending'}
                          onClick={() => handleSendWhatsApp(draft, data)}
                        >
                          <Phone size={16} />
                          {waStatus?.state === 'sent' ? 'Enviado pelo WhatsApp' : waStatus?.state === 'sending' ? 'Enviando…' : 'Enviar via WhatsApp'}
                        </Button>
                        {waStatus?.message && (
                          <p className={cn(
                            'text-xs leading-5',
                            waStatus.state === 'error' ? 'text-red-500' : 'text-framer-ink-muted'
                          )}>
                            {waStatus.message}
                          </p>
                        )}
                        <a href={`/api/view?q=${encodeURIComponent(data.quotation_id)}`} target="_blank" rel="noopener noreferrer" className="block">
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
