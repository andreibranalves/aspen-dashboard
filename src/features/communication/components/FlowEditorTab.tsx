// FlowEditorTab — full flow editor for CommunicationFlows.
// Adapted from SettingsPage WhatsApp section. Supports step types:
//   text, document(source:quotation_pdf|quotation_webp), product_media
//
// Uses communication-flows API (new KV namespace) for persistence.

import { useState, useEffect, useCallback, type ReactNode } from 'react';
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
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { fetchFlows, saveFlows } from '@/lib/api/communicationApi';
import type { CommunicationFlow, FlowContext, FlowChannel } from '@/lib/api/communicationApi';
import { renderFlowTemplate } from '@/lib/api/whatsappFlows';
import SkeletonComunicacao from '@/features/communication/components/SkeletonComunicacao';
import { useSetTopBarActions } from '@/components/layout/Layout';

// ── Constants ──────────────────────────────────────────────────────────────

const STEP_TYPES = {
  TEXT: 'text',
  DOCUMENT: 'document',
  PRODUCT_MEDIA: 'product_media',
} as const;

type StepType = typeof STEP_TYPES[keyof typeof STEP_TYPES];

const STEP_TYPE_ICONS: Record<StepType, typeof MessageSquare> = {
  [STEP_TYPES.TEXT]: MessageSquare,
  [STEP_TYPES.DOCUMENT]: FileText,
  [STEP_TYPES.PRODUCT_MEDIA]: Camera,
};

const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: STEP_TYPES.TEXT, label: 'Texto' },
  { value: STEP_TYPES.DOCUMENT, label: 'Orçamento (PDF/WebP)' },
  { value: STEP_TYPES.PRODUCT_MEDIA, label: 'Mídia da biblioteca' },
];

const PREVIEW_CONTEXT: Record<string, string> = {
  '(nome)': 'Labo Buriti',
  '(primeiro_nome)': 'Labo',
  '(numero_pedido)': 'ORC-20261289',
  '(empresa)': 'Aspen Estamparia',
  '(link_orcamento)': '(link público emitido no envio)',
  '(vendedora)': 'Juliana',
  '(produto_resumo)': 'cangas',
  '(produto_adjetivo_personalizado)': 'personalizadas',
  '(grupo_produto)': 'canga',
};

interface TextStep {
  id: string;
  type: 'text';
  template: string;
}

interface DocumentStep {
  id: string;
  type: 'document';
  source: 'quotation_pdf' | 'quotation_webp';
  caption?: string;
}

interface ProductMediaStep {
  id: string;
  type: 'product_media';
  selection?: string;
  max_items?: number;
  caption_template?: string;
}

type FlowStep = TextStep | DocumentStep | ProductMediaStep;

interface EditableFlow extends CommunicationFlow {
  steps: FlowStep[];
}

function createStep(type: StepType = STEP_TYPES.TEXT): FlowStep {
  const id = `step_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 4)}`;
  switch (type) {
    case STEP_TYPES.TEXT:
      return { id, type: STEP_TYPES.TEXT, template: '' };
    case STEP_TYPES.DOCUMENT:
      return { id, type: STEP_TYPES.DOCUMENT, source: 'quotation_pdf', caption: '' };
    case STEP_TYPES.PRODUCT_MEDIA:
      return {
        id,
        type: STEP_TYPES.PRODUCT_MEDIA,
        selection: 'product_group',
        max_items: 1,
        caption_template: '',
      };
    default:
      return { id, type: STEP_TYPES.TEXT, template: '' };
  }
}

function createFlow(index: number): EditableFlow {
  return {
    id: `flow_${Date.now().toString(36)}${index}`,
    name: `Novo Fluxo ${index + 1}`,
    description: '',
    context: 'email_first_contact' as FlowContext,
    channel: 'whatsapp' as FlowChannel,
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
  const [flows, setFlows] = useState<EditableFlow[]>([]);
  const [savedFlows, setSavedFlows] = useState<EditableFlow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [confirmDeleteFlowId, setConfirmDeleteFlowId] = useState<string | null>(null);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);
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
        const loaded = (data.flows || []).map((f, i) => ({ ...f, id: f.id || `flow_${i}` })) as EditableFlow[];
        setFlows(loaded);
        setSavedFlows(loaded);
        setSelectedFlowId(data.selectedFlowId || loaded[0]?.id || '');
      } catch (err) {
        setError((err as Error).message);
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
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [flows, selectedFlowId]);

  // Flow mutations
  const addFlow = useCallback(() => {
    const newFlow = createFlow(flows.length);
    setFlows((prev) => [...prev, newFlow]);
    setSelectedFlowId(newFlow.id);
    setExpandedFlow(newFlow.id);
  }, [flows.length]);

  const setTopBarActions = useSetTopBarActions();

  useEffect(() => {
    if (!setTopBarActions) return undefined;
    if (loading) {
      setTopBarActions(null);
      return () => setTopBarActions(null);
    }

    setTopBarActions(
      <div className="flex items-center gap-2">
        <Button onClick={addFlow} size="sm">
          <Plus size={14} /> Novo fluxo
        </Button>
        {(isDirty || saving) && (
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </Button>
        )}
      </div> as ReactNode,
    );

    return () => setTopBarActions(null);
  }, [addFlow, handleSave, isDirty, loading, saving, setTopBarActions]);

  const duplicateFlow = (flowId: string) => {
    const idx = flows.findIndex((f) => f.id === flowId);
    if (idx === -1) return;
    const dup = JSON.parse(JSON.stringify(flows[idx])) as EditableFlow;
    dup.id = `flow_${Date.now().toString(36)}`;
    dup.name = `${dup.name} (cópia)`;
    const next = [...flows];
    next.splice(idx + 1, 0, dup);
    setFlows(next);
    setSelectedFlowId(dup.id);
  };

  const deleteFlow = (flowId: string) => {
    if (flows.length <= 1) {
      setError('É necessário pelo menos um fluxo.');
      return;
    }
    const next = flows.filter((f) => f.id !== flowId);
    setFlows(next);
    if (selectedFlowId === flowId) setSelectedFlowId(next[0]?.id || '');
  };

  const updateFlow = (flowId: string, field: keyof EditableFlow, value: unknown) => {
    setFlows((prev) => prev.map((f) => (f.id === flowId ? { ...f, [field]: value } : f)));
  };

  // Step mutations
  const addStep = (flowId: string) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        return { ...f, steps: [...f.steps, createStep(STEP_TYPES.TEXT)] };
      })
    );
  };

  const updateStep = (flowId: string, stepId: string, field: string, value: unknown) => {
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

  const removeStep = (flowId: string, stepId: string) => {
    setFlows((prev) =>
      prev.map((f) => {
        if (f.id !== flowId) return f;
        if (f.steps.length <= 1) return f; // keep at least one step
        return { ...f, steps: f.steps.filter((s) => s.id !== stepId) };
      })
    );
  };

  const moveStep = (flowId: string, stepId: string, direction: number) => {
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

  const handleStepTypeChange = (flowId: string, stepId: string, newType: StepType) => {
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
    return <SkeletonComunicacao />;
  }

  return (
    <div className="space-y-6">
      {/* Status messages */}
      <div className="flex items-center gap-2 flex-wrap min-h-[20px]">
        {successMsg && (
          <span className="text-xs text-success dark:text-success/80">{successMsg}</span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {/* Flow selector */}
      <div className="flex gap-2 flex-wrap">
        {flows.map((flow) => (
          <button
            key={flow.id}
            onClick={() => setSelectedFlowId(flow.id)}
            className={[
              'px-3 py-1 rounded-full text-xs font-medium transition-colors',
              flow.id === selectedFlowId
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-muted text-fg-muted hover:bg-surface-muted/80',
            ].join(' ')}
          >
            {flow.name}
          </button>
        ))}
      </div>

      {/* Flow editor — hint quando nada selecionado */}
      {!selectedFlow && flows.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line text-center py-12">
          <MessageSquare size={28} className="text-fg-muted/40 mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-fg">Nenhum fluxo criado ainda</p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Use <strong>Novo fluxo</strong> para criar sua primeira automação de WhatsApp.
          </p>
        </div>
      )}

      {/* Flow editor */}
      {selectedFlow && (
        <div className="border border-line rounded-lg bg-surface overflow-hidden">
          {/* Flow metadata */}
          <button
            onClick={() =>
              setExpandedFlow(expandedFlow === selectedFlow.id ? null : selectedFlow.id)
            }
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-muted transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-fg">{selectedFlow.name}</span>
              <span className="text-xs text-fg-muted">
                {selectedFlow.steps?.length || 0} {selectedFlow.steps?.length === 1 ? 'etapa' : 'etapas'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateFlow(selectedFlow.id);
                }}
                className="p-1 rounded hover:bg-surface-muted"
                title="Duplicar fluxo"
              >
                <Copy size={14} className="text-fg-muted" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteFlowId(selectedFlow.id);
                }}
                className="p-1 rounded text-fg-muted hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Remover fluxo"
              >
                <Trash2 size={14} />
              </button>
              <ChevronDown
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
            <div className="px-4 pb-4 space-y-4 border-t border-line pt-4">
              {/* Metadata fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-fg-muted">Nome do fluxo</label>
                  <input
                    type="text"
                    value={selectedFlow.name}
                    onChange={(e) => updateFlow(selectedFlow.id, 'name', e.target.value)}
                    className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] text-fg mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Vendedora</label>
                  <input
                    type="text"
                    value={selectedFlow.vendor_name || 'Juliana'}
                    onChange={(e) => updateFlow(selectedFlow.id, 'vendor_name', e.target.value)}
                    className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] text-fg mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Delay mínimo (seg)</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={selectedFlow.delay_min_seconds || 1}
                    onChange={(e) =>
                      updateFlow(selectedFlow.id, 'delay_min_seconds', Number(e.target.value))
                    }
                    className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Delay máximo (seg)</label>
                  <input
                    type="number"
                    min="0"
                    max="45"
                    value={selectedFlow.delay_max_seconds || 3}
                    onChange={(e) =>
                      updateFlow(selectedFlow.id, 'delay_max_seconds', Number(e.target.value))
                    }
                    className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] mt-1"
                  />
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-fg">Etapas do fluxo</h4>
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
                      className="border border-line rounded-lg p-3 bg-surface-muted/50 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-fg-muted">Etapa {idx + 1}</span>
                        <StepIcon size={14} className="text-fg-muted" />
                        <select
                          value={step.type}
                          onChange={(e) =>
                            handleStepTypeChange(selectedFlow.id, step.id, e.target.value as StepType)
                          }
                          className="appearance-none rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
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
                          className="p-0.5 rounded hover:bg-surface-muted disabled:opacity-30"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveStep(selectedFlow.id, step.id, 1)}
                          disabled={isLast}
                          className="p-0.5 rounded hover:bg-surface-muted disabled:opacity-30"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => removeStep(selectedFlow.id, step.id)}
                          className="p-0.5 rounded hover:bg-destructive/10 text-destructive/60"
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
                            className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] text-fg min-h-[60px] resize-y"
                          />
                          <p className="text-[10px] text-fg-muted mt-1">
                            Preview:{' '}
                            {renderFlowTemplate(step.template || '', PREVIEW_CONTEXT) || '(vazio)'}
                          </p>
                        </div>
                      )}

                      {step.type === STEP_TYPES.DOCUMENT && (
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] font-medium text-fg-muted">
                              Formato do orçamento
                            </label>
                            <select
                              value={step.source}
                              onChange={(e) =>
                                updateStep(selectedFlow.id, step.id, 'source', e.target.value)
                              }
                              className="mt-0.5 w-full appearance-none rounded-full border border-line bg-surface px-3.5 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                            >
                              <option value="quotation_pdf">PDF (documento)</option>
                              <option value="quotation_webp">WebP (imagem)</option>
                            </select>
                          </div>
                          <input
                            type="text"
                            value={step.caption || ''}
                            onChange={(e) =>
                              updateStep(selectedFlow.id, step.id, 'caption', e.target.value)
                            }
                            placeholder="Legenda (opcional)"
                            className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] text-fg"
                          />
                          <p className="text-[10px] text-fg-muted mt-1">
                            {step.source === 'quotation_webp'
                              ? 'Envia uma imagem WebP por página do orçamento.'
                              : 'Envia o PDF do orçamento como documento no WhatsApp.'}
                          </p>
                        </div>
                      )}

                      {step.type === STEP_TYPES.PRODUCT_MEDIA && (
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] font-medium text-fg-muted">
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
                              className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-sm mt-0.5"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-fg-muted">
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
                              className="w-full flex h-10 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg transition-colors placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[15px] mt-0.5"
                            />
                          </div>
                          <p className="text-[10px] text-fg-muted">
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
              <div className="border-t border-line pt-3">
                <p className="text-xs font-medium text-fg-muted mb-2">Resumo do fluxo</p>
                <div className="space-y-1">
                  {(selectedFlow.steps || []).map((step, idx) => {
                    if (step.type === STEP_TYPES.TEXT) {
                      const preview =
                        renderFlowTemplate(step.template || '', PREVIEW_CONTEXT) || '(vazio)';
                      return (
                        <div key={step.id} className="flex gap-2 text-xs text-fg">
                          <span className="text-fg-muted shrink-0">{idx + 1}.</span>
                          <span className="truncate">{preview}</span>
                        </div>
                      );
                    }
                    if (step.type === STEP_TYPES.DOCUMENT) {
                      return (
                        <div key={step.id} className="flex gap-2 text-xs text-fg">
                          <span className="text-fg-muted shrink-0">{idx + 1}.</span>
                          <span>
                            {step.source === 'quotation_webp'
                              ? '🖼️ WebP do orçamento'
                              : '📎 PDF do orçamento'}
                          </span>
                        </div>
                      );
                    }
                    if (step.type === STEP_TYPES.PRODUCT_MEDIA) {
                      return (
                        <div key={step.id} className="flex gap-2 text-xs text-fg">
                          <span className="text-fg-muted shrink-0">{idx + 1}.</span>
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

      <ConfirmDialog
        open={confirmDeleteFlowId !== null}
        title="Remover fluxo?"
        message={`O fluxo "${flows.find((f) => f.id === confirmDeleteFlowId)?.name || ''}" será removido da lista local. Salve para persistir a alteração.`}
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (confirmDeleteFlowId) deleteFlow(confirmDeleteFlowId);
          setConfirmDeleteFlowId(null);
        }}
        onCancel={() => setConfirmDeleteFlowId(null)}
      />
    </div>
  );
}
