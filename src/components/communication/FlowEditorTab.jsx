// FlowEditorTab — full flow editor for CommunicationFlows.
// Adapted from SettingsPage WhatsApp section. Supports step types:
//   text, document(source:quotation_pdf), product_media
//
// Uses communication-flows API (new KV namespace) for persistence.

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  FileText,
  MessageSquare,
  Camera,
  Save,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { fetchFlows, saveFlows } from '@/lib/communicationApi.js';
import { renderFlowTemplate } from '@/lib/whatsappFlows.js';

// ── Constants ──────────────────────────────────────────────────────────────

const STEP_TYPES = {
  TEXT: 'text',
  DOCUMENT: 'document',
  PRODUCT_MEDIA: 'product_media',
};

const STEP_TYPE_ICONS = {
  [STEP_TYPES.TEXT]: MessageSquare,
  [STEP_TYPES.DOCUMENT]: FileText,
  [STEP_TYPES.PRODUCT_MEDIA]: Camera,
};

const STEP_TYPE_OPTIONS = [
  { value: STEP_TYPES.TEXT, label: 'Texto' },
  { value: STEP_TYPES.DOCUMENT, label: 'PDF do orçamento' },
  { value: STEP_TYPES.PRODUCT_MEDIA, label: 'Mídia da biblioteca' },
];

const PREVIEW_CONTEXT = {
  '(Saudacao)': getTimeBasedGreeting(),
  '(nome)': 'Labo Buriti',
  '(primeiro_nome)': 'Labo',
  '(numero_pedido)': 'ORC-20261289',
  '(empresa)': 'Aspen Estamparia',
  '(link_orcamento)': 'https://orcamento.aspenestamparia.com/api/view?q=ORC-20261289',
  '(vendedora)': 'Juliana',
  '(produto_resumo)': 'cangas',
  '(produto_adjetivo_personalizado)': 'personalizadas',
  '(grupo_produto)': 'canga',
};

function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function createStep(type = 'text') {
  const id = `step_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 4)}`;
  switch (type) {
    case STEP_TYPES.TEXT:
      return { id, type: 'text', template: '' };
    case STEP_TYPES.DOCUMENT:
      return { id, type: 'document', source: 'quotation_pdf', caption: '' };
    case STEP_TYPES.PRODUCT_MEDIA:
      return {
        id,
        type: 'product_media',
        selection: 'product_group',
        max_items: 1,
        caption_template: '',
      };
    default:
      return { id, type: 'text', template: '' };
  }
}

function createFlow(index) {
  return {
    id: `flow_${Date.now().toString(36)}${index}`,
    name: `Novo Fluxo ${index + 1}`,
    description: '',
    context: 'email_first_contact',
    channel: 'whatsapp',
    vendor_name: 'Juliana',
    delay_min_seconds: 5,
    delay_max_seconds: 8,
    max_media_per_product_group: 1,
    enabled: true,
    steps: [createStep(STEP_TYPES.TEXT)],
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function FlowEditorTab() {
  const [flows, setFlows] = useState([]);
  const [savedFlows, setSavedFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [expandedFlow, setExpandedFlow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isDirty = JSON.stringify(flows) !== JSON.stringify(savedFlows);
  const selectedFlow = flows.find((f) => f.id === selectedFlowId) || flows[0];

  // Load flows
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchFlows();
        const loaded = (data.flows || []).map((f, i) => ({ ...f, id: f.id || `flow_${i}` }));
        setFlows(loaded);
        setSavedFlows(loaded);
        setSelectedFlowId(data.selectedFlowId || loaded[0]?.id || '');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Save
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      await saveFlows(flows, selectedFlowId);
      setSavedFlows(JSON.parse(JSON.stringify(flows)));
      setSuccessMsg('Fluxos salvos com sucesso.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [flows, selectedFlowId]);

  // Flow mutations
  const addFlow = () => {
    const newFlow = createFlow(flows.length);
    setFlows((prev) => [...prev, newFlow]);
    setSelectedFlowId(newFlow.id);
    setExpandedFlow(newFlow.id);
  };

  const duplicateFlow = (flowId) => {
    const idx = flows.findIndex((f) => f.id === flowId);
    if (idx === -1) return;
    const dup = JSON.parse(JSON.stringify(flows[idx]));
    dup.id = `flow_${Date.now().toString(36)}`;
    dup.name = `${dup.name} (cópia)`;
    const next = [...flows];
    next.splice(idx + 1, 0, dup);
    setFlows(next);
    setSelectedFlowId(dup.id);
  };

  const deleteFlow = (flowId) => {
    if (flows.length <= 1) {
      setError('É necessário pelo menos um fluxo.');
      return;
    }
    const next = flows.filter((f) => f.id !== flowId);
    setFlows(next);
    if (selectedFlowId === flowId) setSelectedFlowId(next[0]?.id || '');
  };

  const updateFlow = (flowId, field, value) => {
    setFlows((prev) => prev.map((f) => (f.id === flowId ? { ...f, [field]: value } : f)));
  };

  // Step mutations
  const addStep = (flowId) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        return { ...f, steps: [...f.steps, createStep(STEP_TYPES.TEXT)] };
      })
    );
  };

  const updateStep = (flowId, stepId, field, value) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        return {
          ...f,
          steps: f.steps.map((s) => (s.id === stepId ? { ...s, [field]: value } : s)),
        };
      })
    );
  };

  const removeStep = (flowId, stepId) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        if (f.steps.length <= 1) return f; // keep at least one step
        return { ...f, steps: f.steps.filter((s) => s.id !== stepId) };
      })
    );
  };

  const moveStep = (flowId, stepId, direction) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        const idx = f.steps.findIndex((s) => s.id === stepId);
        if (idx === -1) return f;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= f.steps.length) return f;
        const steps = [...f.steps];
        [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
        return { ...f, steps };
      })
    );
  };

  const handleStepTypeChange = (flowId, stepId, newType) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        return {
          ...f,
          steps: f.steps.map((s) => {
            if (s.id !== stepId) return s;
            const fresh = createStep(newType);
            return { ...fresh, id: s.id };
          }),
        };
      })
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-framer-ink-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={addFlow} size="sm">
          <Plus size={14} /> Novo fluxo
        </Button>
        <Button
          onClick={handleSave}
          size="sm"
          variant={isDirty ? 'default' : 'outline'}
          disabled={saving || !isDirty}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar
        </Button>
        {successMsg && (
          <span className="text-xs text-green-600 dark:text-green-400">{successMsg}</span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>

      {/* Flow selector */}
      <div className="flex gap-2 flex-wrap">
        {flows.map((flow) => (
          <button
            key={flow.id}
            onClick={() => setSelectedFlowId(flow.id)}
            className={[
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              flow.id === selectedFlowId
                ? 'bg-primary text-white'
                : 'bg-framer-surface-2 text-framer-ink-muted hover:bg-framer-surface-2/80',
            ].join(' ')}
          >
            {flow.name}
          </button>
        ))}
      </div>

      {/* Flow editor */}
      {selectedFlow && (
        <div className="border border-framer-hairline rounded-xl bg-card overflow-hidden">
          {/* Flow metadata */}
          <button
            onClick={() =>
              setExpandedFlow(expandedFlow === selectedFlow.id ? null : selectedFlow.id)
            }
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-framer-surface-2 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-framer-ink">{selectedFlow.name}</span>
              <span className="text-xs text-framer-ink-muted">
                {selectedFlow.steps?.length || 0} etapa(s)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateFlow(selectedFlow.id);
                }}
                className="p-1 rounded hover:bg-framer-surface-2"
                title="Duplicar fluxo"
              >
                <Copy size={14} className="text-framer-ink-muted" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteFlow(selectedFlow.id);
                }}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                title="Remover fluxo"
              >
                <Trash2 size={14} className="text-red-500" />
              </button>
              <ChevronUp
                size={16}
                className={
                  expandedFlow === selectedFlow.id
                    ? 'rotate-180 transition-transform'
                    : 'transition-transform'
                }
              />
            </div>
          </button>

          {expandedFlow === selectedFlow.id && (
            <div className="px-4 pb-4 space-y-4 border-t border-framer-hairline pt-4">
              {/* Metadata fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-framer-ink-muted">Nome do fluxo</label>
                  <input
                    type="text"
                    value={selectedFlow.name}
                    onChange={(e) => updateFlow(selectedFlow.id, 'name', e.target.value)}
                    className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm text-framer-ink mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-framer-ink-muted">Vendedora</label>
                  <input
                    type="text"
                    value={selectedFlow.vendor_name || 'Juliana'}
                    onChange={(e) => updateFlow(selectedFlow.id, 'vendor_name', e.target.value)}
                    className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm text-framer-ink mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-framer-ink-muted">
                    Delay mínimo (seg)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={selectedFlow.delay_min_seconds || 1}
                    onChange={(e) =>
                      updateFlow(selectedFlow.id, 'delay_min_seconds', Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-framer-ink-muted">
                    Delay máximo (seg)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="45"
                    value={selectedFlow.delay_max_seconds || 3}
                    onChange={(e) =>
                      updateFlow(selectedFlow.id, 'delay_max_seconds', Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm mt-1"
                  />
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-framer-ink">Etapas do fluxo</h4>
                  <Button onClick={() => addStep(selectedFlow.id)} size="sm" variant="ghost">
                    <Plus size={14} /> Etapa
                  </Button>
                </div>

                {selectedFlow.steps?.map((step, idx) => {
                  const StepIcon = STEP_TYPE_ICONS[step.type] || MessageSquare;
                  const isLast = idx === (selectedFlow.steps?.length || 0) - 1;
                  const isFirst = idx === 0;

                  return (
                    <div
                      key={step.id}
                      className="border border-framer-hairline rounded-lg p-3 bg-framer-surface-2/50 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Etapa {idx + 1}
                        </span>
                        <StepIcon size={14} className="text-framer-ink-muted" />
                        <select
                          value={step.type}
                          onChange={(e) =>
                            handleStepTypeChange(selectedFlow.id, step.id, e.target.value)
                          }
                          className="text-xs rounded border border-framer-hairline bg-card px-1.5 py-0.5 text-framer-ink"
                        >
                          {STEP_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex-1" />
                        <button
                          onClick={() => moveStep(selectedFlow.id, step.id, -1)}
                          disabled={isFirst}
                          className="p-0.5 rounded hover:bg-framer-surface-2 disabled:opacity-30"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveStep(selectedFlow.id, step.id, 1)}
                          disabled={isLast}
                          className="p-0.5 rounded hover:bg-framer-surface-2 disabled:opacity-30"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => removeStep(selectedFlow.id, step.id)}
                          className="p-0.5 rounded hover:bg-red-50 text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* Step type-specific fields */}
                      {step.type === STEP_TYPES.TEXT && (
                        <div>
                          <textarea
                            value={step.template || ''}
                            onChange={(e) =>
                              updateStep(selectedFlow.id, step.id, 'template', e.target.value)
                            }
                            placeholder="Digite a mensagem. Use variáveis como (primeiro_nome), (produto_resumo)..."
                            className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm text-framer-ink min-h-[60px] resize-y"
                          />
                          <p className="text-[10px] text-framer-ink-muted mt-1">
                            Preview:{' '}
                            {renderFlowTemplate(step.template || '', PREVIEW_CONTEXT) || '(vazio)'}
                          </p>
                        </div>
                      )}

                      {step.type === STEP_TYPES.DOCUMENT && (
                        <div>
                          <input
                            type="text"
                            value={step.caption || ''}
                            onChange={(e) =>
                              updateStep(selectedFlow.id, step.id, 'caption', e.target.value)
                            }
                            placeholder="Legenda do PDF (opcional)"
                            className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm text-framer-ink"
                          />
                          <p className="text-[10px] text-framer-ink-muted mt-1">
                            Envia o PDF do orçamento como documento no WhatsApp.
                          </p>
                        </div>
                      )}

                      {step.type === STEP_TYPES.PRODUCT_MEDIA && (
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] font-medium text-framer-ink-muted">
                              Máx. mídias por grupo
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="5"
                              value={step.max_items || 1}
                              onChange={(e) =>
                                updateStep(
                                  selectedFlow.id,
                                  step.id,
                                  'max_items',
                                  Number(e.target.value)
                                )
                              }
                              className="w-20 rounded-lg border border-framer-hairline bg-card px-2 py-1 text-sm mt-0.5"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-framer-ink-muted">
                              Template de legenda (opcional)
                            </label>
                            <input
                              type="text"
                              value={step.caption_template || ''}
                              onChange={(e) =>
                                updateStep(
                                  selectedFlow.id,
                                  step.id,
                                  'caption_template',
                                  e.target.value
                                )
                              }
                              placeholder="Ex: Referência de (grupo_produto)"
                              className="w-full rounded-lg border border-framer-hairline bg-card px-3 py-1.5 text-sm mt-0.5"
                            />
                          </div>
                          <p className="text-[10px] text-framer-ink-muted">
                            Seleciona automaticamente mídias da biblioteca conforme os produtos do
                            orçamento.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Flow Preview Summary */}
              <div className="border-t border-framer-hairline pt-3">
                <p className="text-xs font-medium text-framer-ink-muted mb-2">Resumo do fluxo</p>
                <div className="space-y-1">
                  {(selectedFlow.steps || []).map((step, idx) => {
                    if (step.type === STEP_TYPES.TEXT) {
                      const preview =
                        renderFlowTemplate(step.template || '', PREVIEW_CONTEXT) || '(vazio)';
                      return (
                        <div key={step.id} className="flex gap-2 text-xs text-framer-ink">
                          <span className="text-framer-ink-muted shrink-0">{idx + 1}.</span>
                          <span className="truncate">{preview}</span>
                        </div>
                      );
                    }
                    if (step.type === STEP_TYPES.DOCUMENT) {
                      return (
                        <div key={step.id} className="flex gap-2 text-xs text-framer-ink">
                          <span className="text-framer-ink-muted shrink-0">{idx + 1}.</span>
                          <span>📎 PDF do orçamento</span>
                        </div>
                      );
                    }
                    if (step.type === STEP_TYPES.PRODUCT_MEDIA) {
                      return (
                        <div key={step.id} className="flex gap-2 text-xs text-framer-ink">
                          <span className="text-framer-ink-muted shrink-0">{idx + 1}.</span>
                          <span>🖼️ Mídia da biblioteca por grupo de produto</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
