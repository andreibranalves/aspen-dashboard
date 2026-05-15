import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Copy, ChevronUp, ChevronDown,
  Image, FileText, MessageSquare, Camera,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
  loadWhatsappFlows,
  saveWhatsappFlows,
  getSelectedFlowId,
  saveSelectedFlowId,
  getFlowSummary,
  createId,
  normalizeFlow,
  renderFlowTemplate,
  STEP_TYPES,
  DEFAULT_WA_FLOWS,
} from '@/lib/whatsappFlows.js';
import {
  PRINT_FORMAT_OPTIONS,
  getPrintFormatLabel,
  loadActivePrintFormat,
  saveActivePrintFormat,
} from '@/lib/printFormats.js';

const STEP_TYPE_LABELS = {
  [STEP_TYPES.TEXT]: 'Texto',
  [STEP_TYPES.IMAGE]: 'Imagem por URL',
  [STEP_TYPES.PRODUCT_IMAGES]: 'Fotos por categoria',
};

const STEP_TYPE_ICONS = {
  [STEP_TYPES.TEXT]: MessageSquare,
  [STEP_TYPES.IMAGE]: Image,
  [STEP_TYPES.DOCUMENT]: FileText,
  [STEP_TYPES.PRODUCT_IMAGES]: Camera,
};

const STEP_TYPE_OPTIONS = [
  { value: STEP_TYPES.TEXT, label: 'Texto' },
  { value: STEP_TYPES.IMAGE, label: 'Imagem por URL' },
  { value: STEP_TYPES.PRODUCT_IMAGES, label: 'Fotos por categoria' },
];

const STEP_TYPE_DESCRIPTIONS = {
  [STEP_TYPES.TEXT]: 'Envia uma mensagem de texto normal no WhatsApp.',
  [STEP_TYPES.IMAGE]: 'Envia uma imagem a partir de uma URL pública.',
  [STEP_TYPES.PRODUCT_IMAGES]: 'Envia as fotos de referência conforme a categoria dos produtos no orçamento.',
};

const PREVIEW_CONTEXT = {
  '(Saudacao)': getTimeBasedGreeting(),
  '(nome)': 'Labo Buriti',
  '(primeiro_nome)': 'Labo',
  '(numero_pedido)': 'ORC-20261289',
  '(empresa)': 'Aspen Estamparia',
  '(link_orcamento)': 'https://orcamento.aspenestamparia.com/api/view?q=ORC-20261289',
  '(vendedora)': 'Juliana',
  '(produto_resumo)': 'canga',
};

function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function SettingsPage() {
  const [flows, setFlows] = useState([]);
  const [savedFlows, setSavedFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [expandedFlow, setExpandedFlow] = useState(null);
  const [brokenImages, setBrokenImages] = useState({});
  const [activePrintFormat, setActivePrintFormat] = useState(loadActivePrintFormat);

  const isDirty = JSON.stringify(flows) !== JSON.stringify(savedFlows);

  useEffect(() => {
    const loaded = loadWhatsappFlows();
    setFlows(loaded);
    setSavedFlows(loaded);
    const sfId = getSelectedFlowId(loaded);
    setSelectedFlowId(sfId);
  }, []);

  const handleSaveFlows = useCallback(() => {
    if (!window.confirm('Salvar alterações nos fluxos de WhatsApp neste navegador?')) return;
    saveWhatsappFlows(flows);
    setSavedFlows(structuredClone(flows));
  }, [flows]);

  const handleDiscardChanges = useCallback(() => {
    if (!window.confirm('Descartar alterações não salvas?')) return;
    setFlows(structuredClone(savedFlows));
    const nextId = savedFlows.some(f => f.id === selectedFlowId) ? selectedFlowId : getSelectedFlowId(savedFlows);
    setSelectedFlowId(nextId);
  }, [savedFlows, selectedFlowId]);

  const updateFlows = useCallback((updater) => {
    setFlows((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
  }, []);

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) || null;

  const handlePrintFormatChange = useCallback((value) => {
    setActivePrintFormat(saveActivePrintFormat(value));
  }, []);

  const updateSelectedFlow = useCallback(
    (patch) => {
      updateFlows((prev) =>
        prev.map((f) =>
          f.id === selectedFlowId ? normalizeFlow({ ...f, ...patch }) : f,
        ),
      );
    },
    [selectedFlowId, updateFlows],
  );

  const selectFlow = useCallback(
    (id) => {
      setSelectedFlowId(id);
      saveSelectedFlowId(id);
    },
    [],
  );

  // --- Step helpers ---

  const updateStep = useCallback(
    (stepId, patch) => {
      updateFlows((prev) =>
        prev.map((f) => {
          if (f.id !== selectedFlowId) return f;
          return normalizeFlow({
            ...f,
            steps: f.steps.map((s) =>
              s.id === stepId ? { ...s, ...patch } : s,
            ),
          });
        }),
      );
    },
    [selectedFlowId, updateFlows],
  );

  const moveStep = useCallback(
    (index, direction) => {
      updateFlows((prev) =>
        prev.map((f) => {
          if (f.id !== selectedFlowId) return f;
          const steps = [...f.steps];
          const targetIndex = index + direction;
          if (targetIndex < 0 || targetIndex >= steps.length) return f;
          [steps[index], steps[targetIndex]] = [
            steps[targetIndex],
            steps[index],
          ];
          return normalizeFlow({ ...f, steps });
        }),
      );
    },
    [selectedFlowId, updateFlows],
  );

  const duplicateStep = useCallback(
    (stepId) => {
      updateFlows((prev) =>
        prev.map((f) => {
          if (f.id !== selectedFlowId) return f;
          const idx = f.steps.findIndex((s) => s.id === stepId);
          if (idx === -1) return f;
          const steps = [...f.steps];
          const newStep = { ...steps[idx], id: createId('step') };
          steps.splice(idx + 1, 0, newStep);
          return normalizeFlow({ ...f, steps });
        }),
      );
    },
    [selectedFlowId, updateFlows],
  );

  const removeStep = useCallback(
    (stepId) => {
      updateFlows((prev) =>
        prev.map((f) => {
          if (f.id !== selectedFlowId) return f;
          return normalizeFlow({
            ...f,
            steps: f.steps.filter((s) => s.id !== stepId),
          });
        }),
      );
    },
    [selectedFlowId, updateFlows],
  );

  const addStep = useCallback(() => {
    updateFlows((prev) =>
      prev.map((f) => {
        if (f.id !== selectedFlowId) return f;
        return normalizeFlow({
          ...f,
          steps: [
            ...f.steps,
            {
              id: createId('step'),
              type: STEP_TYPES.TEXT,
              template: '',
              media: '',
              source: '',
              caption: '',
            },
          ],
        });
      }),
    );
  }, [selectedFlowId, updateFlows]);

  // --- Flow CRUD ---

  const handleNewFlow = useCallback(() => {
    updateFlows((prev) => {
      const newFlow = normalizeFlow({
        id: createId('flow'),
        name: 'Novo fluxo',
        default: false,
        vendor_name: selectedFlow?.vendor_name || '',
        delay_min_seconds: selectedFlow?.delay_min_seconds || 1,
        delay_max_seconds: selectedFlow?.delay_max_seconds || 3,
        max_images_per_category: selectedFlow?.max_images_per_category || 0,
      });
      return [...prev, newFlow];
    });
  }, [updateFlows, selectedFlow]);

  const handleDuplicateFlow = useCallback(() => {
    if (!selectedFlow) return;
    updateFlows((prev) => {
      const newFlow = normalizeFlow({
        ...selectedFlow,
        id: createId('flow'),
        name: `${selectedFlow.name} (cópia)`,
        default: false,
        steps: selectedFlow.steps.map((s) => ({
          ...s,
          id: createId('step'),
        })),
      });
      return [...prev, newFlow];
    });
  }, [selectedFlow, updateFlows]);

  const handleDeleteFlow = useCallback(() => {
    if (!selectedFlow || flows.length <= 1) return;
    if (!window.confirm(`Excluir o fluxo "${selectedFlow.name}"?`)) return;

    const newFlows = flows.filter((f) => f.id !== selectedFlowId);
    updateFlows(newFlows);
    if (selectedFlowId === selectedFlow.id) {
      const nextId = newFlows.length > 0 ? newFlows[0].id : '';
      setSelectedFlowId(nextId);
      saveSelectedFlowId(nextId);
    }
  }, [selectedFlow, selectedFlowId, flows, updateFlows]);

  const handleRestoreDefaults = useCallback(() => {
    if (
      !window.confirm(
        'Restaurar fluxos padrão? Todos os fluxos personalizados serão perdidos.',
      )
    )
      return;
    const defaults = DEFAULT_WA_FLOWS.map((f, i) => normalizeFlow(f, i));
    setFlows(defaults);
    setSelectedFlowId(defaults[0].id);
    saveSelectedFlowId(defaults[0].id);
  }, []);

  // --- Render helpers ---

  function renderStepPreview(step) {
    const maxImages = selectedFlow?.max_images_per_category ?? 0;

    switch (step.type) {
      case STEP_TYPES.TEXT: {
        const rendered = renderFlowTemplate(step.template, PREVIEW_CONTEXT);
        return rendered || <span className="text-framer-ink-muted italic">Mensagem vazia</span>;
      }
      case STEP_TYPES.IMAGE:
        return (
          <div className="space-y-1">
            {step.media ? (
              <>
                {!brokenImages[step.id] ? (
                  <img
                    src={step.media}
                    alt=""
                    className="max-h-[200px] rounded-lg border border-framer-hairline object-cover"
                    onError={() => setBrokenImages(prev => ({ ...prev, [step.id]: true }))}
                  />
                ) : (
                  <p className="text-xs text-red-500">
                    Não foi possível carregar a imagem. Verifique se a URL está correta e acessível publicamente.
                  </p>
                )}
                {step.caption && (
                  <p className="text-sm leading-relaxed">
                    {renderFlowTemplate(step.caption, PREVIEW_CONTEXT)}
                  </p>
                )}
              </>
            ) : (
              <span className="text-framer-ink-muted italic">
                Nenhuma imagem configurada
              </span>
            )}
          </div>
        );
      case STEP_TYPES.DOCUMENT:
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-framer-ink">
              <MessageSquare size={16} className="text-framer-ink-muted" />
              <span>Envia link do orçamento (documento convertido)</span>
            </div>
            {step.caption && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {renderFlowTemplate(step.caption, PREVIEW_CONTEXT)}
                {step.caption.includes('(link_orcamento)') ? '' : '\n(link_orcamento)'}
              </p>
            )}
            {!step.caption && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-framer-ink-muted">
                Segue o orçamento (numero_pedido):{'\n'}(link_orcamento)
              </p>
            )}
          </div>
        );
      case STEP_TYPES.PRODUCT_IMAGES:
        return (
          <span className="text-sm text-framer-ink">
            Envia fotos das categorias detectadas no orçamento (até{' '}
            {maxImages} por categoria).
          </span>
        );
      default:
        return null;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Estas configurações ficam salvas neste navegador."
      />

      {/* Section: Modelo de visualização */}
      <div className="rounded-lg border border-framer-hairline bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-framer-ink">
            Modelo ativo do orçamento
          </h2>
          <p className="mt-1 text-sm text-framer-ink-muted">
            Define como os orçamentos serão visualizados neste navegador. O orçamento salvo no ERPNext não muda.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {PRINT_FORMAT_OPTIONS.map(option => {
            const selected = option.value === activePrintFormat;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handlePrintFormatChange(option.value)}
                className={`rounded-[16px] border p-4 text-left transition-all ${
                  selected
                    ? 'border-framer-accent-blue bg-framer-accent-blue/5 shadow-sm'
                    : 'border-framer-hairline bg-framer-surface-1/40 hover:border-framer-accent-blue/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-framer-ink">
                      {option.label}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-framer-ink-muted">
                      {option.description}
                    </p>
                  </div>
                  {selected && (
                    <span className="rounded-full bg-framer-accent-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-framer-accent-blue">
                      Ativo
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-framer-ink-muted">
          Modelo atual: {getPrintFormatLabel(activePrintFormat)}.
        </p>
      </div>

      {/* Section: Fluxos de WhatsApp */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-framer-ink">
            Fluxos de WhatsApp
          </h2>
          <Button variant="default" size="sm" onClick={handleNewFlow}>
            <Plus size={14} />
            Novo fluxo
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* --- Flow list (left column) --- */}
          <div className="space-y-2 lg:col-span-1">
            {flows.map((flow) => {
              const isSelected = flow.id === selectedFlowId;
              const isExpanded = expandedFlow === flow.id;
              return (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => {
                    selectFlow(flow.id);
                    setExpandedFlow(isExpanded ? null : flow.id);
                  }}
                  className={`w-full rounded-lg border p-4 text-left transition-all duration-200 ${
                    isSelected
                      ? 'border-framer-accent-blue bg-framer-accent-blue/5 shadow-sm'
                      : 'border-framer-hairline bg-card hover:border-framer-accent-blue/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-framer-ink">
                          {flow.name}
                        </span>
                        {flow.default && (
                          <span className="rounded-full bg-framer-accent-blue/10 px-2 py-0.5 text-[10px] font-semibold text-framer-accent-blue uppercase tracking-wide">
                            Padrão
                          </span>
                        )}
                      </div>
                      {flow.description && (
                        <p className="mt-0.5 truncate text-xs text-framer-ink-muted">
                          {flow.description}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-framer-ink-muted/70">
                        {getFlowSummary(flow)}
                      </p>
                      {!flow.default && (
                        <button
                          type="button"
                          className="mt-1 text-[10px] text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateFlows(prev => prev.map(f => ({
                              ...f,
                              default: f.id === flow.id
                            })));
                          }}
                        >
                          Definir como padrão
                        </button>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {flows.length === 0 && (
              <p className="py-4 text-center text-sm text-framer-ink-muted">
                Nenhum fluxo criado.
              </p>
            )}
          </div>

          {/* --- Flow editor (right column) --- */}
          <div className="lg:col-span-2">
            {selectedFlow ? (
              <div className="space-y-5">
                {/* Flow-level fields */}
                <div className="rounded-lg border border-framer-hairline bg-card p-5 shadow-sm">
                  <h3 className="mb-4 text-sm font-semibold text-framer-ink">
                    Dados do fluxo
                  </h3>
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Nome do fluxo
                        </span>
                        <input
                          className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                          value={selectedFlow.name}
                          onChange={(e) =>
                            updateSelectedFlow({ name: e.target.value })
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Descrição
                        </span>
                        <input
                          className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                          value={selectedFlow.description}
                          onChange={(e) =>
                            updateSelectedFlow({ description: e.target.value })
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Vendedora
                        </span>
                        <input
                          className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                          value={selectedFlow.vendor_name || ''}
                          onChange={(e) =>
                            updateSelectedFlow({
                              vendor_name: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Fotos por categoria
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="6"
                          className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                          value={selectedFlow.max_images_per_category ?? 0}
                          onChange={(e) =>
                            updateSelectedFlow({
                              max_images_per_category: Number(
                                e.target.value,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Intervalo mínimo (s)
                        </span>
                        <input
                          type="number"
                          min="0"
                          className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                          value={selectedFlow.delay_min_seconds ?? 0}
                          onChange={(e) =>
                            updateSelectedFlow({
                              delay_min_seconds: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-framer-ink-muted">
                          Intervalo máximo (s)
                        </span>
                        <input
                          type="number"
                          min="0"
                          className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                          value={selectedFlow.delay_max_seconds ?? 0}
                          onChange={(e) =>
                            updateSelectedFlow({
                              delay_max_seconds: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Flow action buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDuplicateFlow}
                  >
                    <Copy size={14} />
                    Duplicar fluxo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteFlow}
                    disabled={flows.length <= 1}
                  >
                    <Trash2 size={14} />
                    Excluir fluxo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRestoreDefaults}
                  >
                    Restaurar padrões
                  </Button>
                </div>

                {/* Steps editor */}
                <div className="rounded-lg border border-framer-hairline bg-card p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-framer-ink">
                      Etapas do fluxo
                    </h3>
                    <Button variant="default" size="sm" onClick={addStep}>
                      <Plus size={14} />
                      Adicionar etapa
                    </Button>
                  </div>

                  {selectedFlow.steps.length === 0 ? (
                    <p className="py-6 text-center text-sm text-framer-ink-muted">
                      Nenhuma etapa definida. Clique em "Adicionar etapa" para
                      começar.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {selectedFlow.steps.map((step, index) => {
                        const StepIcon =
                          STEP_TYPE_ICONS[step.type] || MessageSquare;
                        return (
                          <div
                            key={step.id}
                            className="rounded-lg border border-framer-hairline bg-framer-surface-1/40 p-4"
                          >
                            {/* Step header */}
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-framer-accent-blue/10 text-[11px] font-bold text-framer-accent-blue">
                                  {index + 1}
                                </span>
                                <StepIcon
                                  size={14}
                                  className="text-framer-ink-muted"
                                />
                                <span className="text-xs font-medium text-framer-ink">
                                  {STEP_TYPE_LABELS[step.type] || 'Etapa'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  title="Mover para cima"
                                  disabled={index === 0}
                                  onClick={() => moveStep(index, -1)}
                                  className="rounded p-1 text-framer-ink-muted transition-colors hover:bg-framer-surface-2 hover:text-framer-ink disabled:opacity-30"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  title="Mover para baixo"
                                  disabled={
                                    index === selectedFlow.steps.length - 1
                                  }
                                  onClick={() => moveStep(index, 1)}
                                  className="rounded p-1 text-framer-ink-muted transition-colors hover:bg-framer-surface-2 hover:text-framer-ink disabled:opacity-30"
                                >
                                  <ChevronDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  title="Duplicar etapa"
                                  onClick={() => duplicateStep(step.id)}
                                  className="rounded p-1 text-framer-ink-muted transition-colors hover:bg-framer-surface-2 hover:text-framer-ink"
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  type="button"
                                  title="Remover etapa"
                                  onClick={() => removeStep(step.id)}
                                  className="rounded p-1 text-framer-ink-muted transition-colors hover:bg-red-100 hover:text-red-600"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            {/* Type selector */}
                            <div className="mb-3">
                              <label className="text-xs font-medium text-framer-ink-muted">
                                Tipo
                              </label>
                              <select
                                className="mt-1 w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                                value={step.type}
                                onChange={(e) =>
                                  updateStep(step.id, {
                                    type: e.target.value,
                                    template: '',
                                    media: '',
                                    source:
                                      e.target.value === STEP_TYPES.DOCUMENT
                                        ? 'quotation_pdf'
                                        : '',
                                    caption: '',
                                  })
                                }
                              >
                                {STEP_TYPE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <p className="mt-1.5 text-[11px] text-framer-ink-muted leading-relaxed">
                                {STEP_TYPE_DESCRIPTIONS[step.type] || ''}
                              </p>
                            </div>

                            {/* Type-specific fields */}
                            {step.type === STEP_TYPES.TEXT && (
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-framer-ink-muted">
                                  Template
                                </label>
                                <textarea
                                  className="w-full min-h-[80px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                                  value={step.template || ''}
                                  onChange={(e) =>
                                    updateStep(step.id, {
                                      template: e.target.value,
                                    })
                                  }
                                  placeholder="Digite a mensagem..."
                                />
                                <p className="text-[11px] text-framer-ink-muted">
                                  Variáveis disponíveis:{' '}
                                  <span className="font-mono">
                                    (Saudacao) · (nome) · (primeiro_nome) ·
                                    (numero_pedido) · (empresa) ·
                                    (link_orcamento) · (vendedora) ·
                                    (produto_resumo)
                                  </span>
                                </p>
                              </div>
                            )}

                            {step.type === STEP_TYPES.IMAGE && (
                              <div className="space-y-3">
                                <label className="space-y-1">
                                  <span className="text-xs font-medium text-framer-ink-muted">
                                    URL da imagem
                                  </span>
                                  <input
                                    className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                                    value={step.media || ''}
                                    onChange={(e) =>
                                      updateStep(step.id, {
                                        media: e.target.value,
                                      })
                                    }
                                    placeholder="https://..."
                                  />
                                  <p className="text-[11px] text-framer-ink-muted">
                                    A imagem precisa estar em uma URL pública
                                    para a Evolution API conseguir enviar.
                                  </p>
                                </label>
                                {step.media && !brokenImages[step.id] && (
                                  <img
                                    src={step.media}
                                    alt="Preview"
                                    className="max-h-[200px] rounded-lg border border-framer-hairline object-cover"
                                    onError={() => setBrokenImages(prev => ({ ...prev, [step.id]: true }))}
                                  />
                                )}
                                {step.media && brokenImages[step.id] && (
                                  <p className="text-xs text-red-500">
                                    Não foi possível carregar a imagem. Verifique se a URL está correta e acessível publicamente.
                                  </p>
                                )}
                                <label className="space-y-1">
                                  <span className="text-xs font-medium text-framer-ink-muted">
                                    Legenda (opcional)
                                  </span>
                                  <textarea
                                    className="w-full min-h-[60px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                                    value={step.caption || ''}
                                    onChange={(e) =>
                                      updateStep(step.id, {
                                        caption: e.target.value,
                                      })
                                    }
                                    placeholder="Legenda da imagem..."
                                  />
                                </label>
                              </div>
                            )}

                            {step.type === STEP_TYPES.DOCUMENT && (
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 rounded-[10px] border border-framer-warning/30 bg-framer-warning/5 px-3 py-2 text-sm text-framer-ink-muted">
                                  <FileText size={16} className="text-framer-warning" />
                                  <span>Etapa antiga de PDF: será enviada como link do orçamento. Recomendado trocar para Texto.</span>
                                </div>
                              </div>
                            )}

                            {step.type === STEP_TYPES.PRODUCT_IMAGES && (
                              <p className="text-sm text-framer-ink-muted">
                                Envia as fotos configuradas abaixo para as
                                categorias detectadas no orçamento.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedFlow.steps.length > 0 && (
                    <div className="mt-3">
                      <Button variant="outline" size="sm" onClick={addStep}>
                        <Plus size={14} />
                        Adicionar etapa
                      </Button>
                    </div>
                  )}
                </div>

                {/* Sample images by category */}
                <div className="rounded-lg border border-framer-hairline bg-card p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-framer-ink">
                    Fotos por categoria
                  </h3>
                  <label className="space-y-1">
                    <textarea
                      className="w-full min-h-[96px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 font-mono text-xs resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                      value={selectedFlow.sample_images_text || ''}
                      onChange={(e) =>
                        updateSelectedFlow({
                          sample_images_text: e.target.value,
                        })
                      }
                      placeholder={
                        'canga: https://site/canga-01.jpg, https://site/canga-02.jpg\nlenço: https://site/lenco-01.jpg'
                      }
                    />
                    <p className="text-xs text-framer-ink-muted">
                      Uma categoria por linha. Separe múltiplas imagens por
                      vírgula. Categorias aceitas: canga, lenço, boné, chapéu,
                      toalha, ecobag, cachecol.
                    </p>
                  </label>
                </div>

                {/* Preview panel */}
                <div className="rounded-lg border border-framer-hairline bg-card p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-framer-ink">
                    Preview com dados de exemplo
                  </h3>
                  <div className="space-y-2">
                    {selectedFlow.steps.map((step, index) => {
                      const StepIcon =
                        STEP_TYPE_ICONS[step.type] || MessageSquare;
                      return (
                        <div
                          key={step.id}
                          className="rounded-[14px] bg-framer-surface-1/60 p-3 shadow-sm"
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <StepIcon
                              size={12}
                              className="text-framer-ink-muted"
                            />
                            <span className="text-[11px] font-medium text-framer-ink-muted">
                              Etapa {index + 1} —{' '}
                              {STEP_TYPE_LABELS[step.type] || step.type}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap text-sm leading-relaxed text-framer-ink">
                            {renderStepPreview(step)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Save indicator */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-4 border-t border-framer-hairline">
                  <p className="text-xs text-framer-ink-muted">
                    {isDirty ? 'Alterações não salvas.' : 'Tudo salvo neste navegador.'}
                  </p>
                  <div className="flex gap-2">
                    {isDirty && (
                      <Button variant="ghost" size="sm" onClick={handleDiscardChanges}>
                        Descartar alterações
                      </Button>
                    )}
                    <Button 
                      variant="default" 
                      size="sm" 
                      onClick={handleSaveFlows} 
                      disabled={!isDirty}
                    >
                      Salvar alterações
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-framer-hairline bg-card p-12">
                <p className="text-sm text-framer-ink-muted">
                  Selecione um fluxo ou crie um novo.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
