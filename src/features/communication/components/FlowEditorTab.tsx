// FlowEditorTab — editor for CommunicationFlows.
// Supports text, quotation documents and product media steps without changing
// the existing flow API or WhatsApp transport.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleOff,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import EmptyState from '@/components/shared/EmptyState';
import { fetchFlows, saveFlows } from '@/lib/api/communicationApi';
import type {
  CommunicationFlow,
  CommunicationFlowStep,
  FlowChannel,
  FlowContext,
} from '@/lib/api/communicationApi';
import SkeletonComunicacao from '@/features/communication/components/SkeletonComunicacao';
const STEP_TYPES = {
  TEXT: 'text',
  DOCUMENT: 'document',
  PRODUCT_MEDIA: 'product_media',
} as const;

type StepType = (typeof STEP_TYPES)[keyof typeof STEP_TYPES];
type FlowStep = CommunicationFlowStep;

const STEP_TYPE_ICONS: Record<StepType, typeof MessageSquare> = {
  [STEP_TYPES.TEXT]: MessageSquare,
  [STEP_TYPES.DOCUMENT]: FileText,
  [STEP_TYPES.PRODUCT_MEDIA]: Camera,
};

const STEP_TYPE_LABELS: Record<StepType, string> = {
  [STEP_TYPES.TEXT]: 'Texto',
  [STEP_TYPES.DOCUMENT]: 'Orçamento',
  [STEP_TYPES.PRODUCT_MEDIA]: 'Mídia da biblioteca',
};

const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: STEP_TYPES.TEXT, label: 'Texto' },
  { value: STEP_TYPES.DOCUMENT, label: 'Orçamento (PDF/WebP)' },
  { value: STEP_TYPES.PRODUCT_MEDIA, label: 'Mídia da biblioteca' },
];

const CONTEXT_LABELS: Record<FlowContext, string> = {
  already_talking: 'Já conversando',
  email_first_contact: 'Primeiro contato por e-mail',
  form_first_contact: 'Primeiro contato por formulário',
  manual: 'Manual',
};

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
    name: `Novo fluxo ${index + 1}`,
    description: '',
    context: 'email_first_contact' as FlowContext,
    channel: 'whatsapp' as FlowChannel,
    vendor_name: '',
    delay_min_seconds: 5,
    delay_max_seconds: 8,
    max_media_per_product_group: 1,
    enabled: true,
    steps: [createStep(STEP_TYPES.TEXT)],
  };
}

function errorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

function displayName(flow: Pick<CommunicationFlow, 'name'>): string {
  return flow.name?.trim() || 'Fluxo sem nome';
}

function contextLabel(value: string | undefined): string {
  if (!value) return 'Contexto não informado';
  return CONTEXT_LABELS[value as FlowContext] || value;
}

function channelLabel(value: string | undefined): string {
  if (!value) return 'Canal não informado';
  return value === 'whatsapp' ? 'WhatsApp' : value;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function stepLabel(step: FlowStep): string {
  if (step.type === STEP_TYPES.DOCUMENT) {
    return step.source === 'quotation_webp' ? 'Orçamento em WebP' : 'Orçamento em PDF';
  }
  if (step.type === STEP_TYPES.PRODUCT_MEDIA) return 'Mídia da biblioteca';
  return step.template?.trim() || 'Texto sem conteúdo';
}

function stepCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'etapa' : 'etapas'}`;
}

interface FlowEditorTabProps {
  onDirtyChange?: (dirty: boolean) => void;
}

interface PendingTypeChange {
  flowId: string;
  stepId: string;
  type: StepType;
}

export default function FlowEditorTab({ onDirtyChange }: FlowEditorTabProps) {
  const [flows, setFlows] = useState<EditableFlow[]>([]);
  const [savedFlows, setSavedFlows] = useState<EditableFlow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [activeStepId, setActiveStepId] = useState('');
  const [confirmDeleteFlowId, setConfirmDeleteFlowId] = useState<string | null>(null);
  const [pendingTypeChange, setPendingTypeChange] = useState<PendingTypeChange | null>(null);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isDirty = JSON.stringify(flows) !== JSON.stringify(savedFlows);
  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) || flows[0];
  const delayRangeInvalid = Boolean(
    selectedFlow && selectedFlow.delay_max_seconds < selectedFlow.delay_min_seconds
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  const loadFlows = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setActionError('');
    setSaveError('');
    setSuccessMsg('');
    try {
      const data = await fetchFlows();
      const loaded = (data.flows || []).map((flow, index) => ({
        ...flow,
        id: flow.id || `flow_${index}`,
      })) as EditableFlow[];
      const nextSelectedId = data.selectedFlowId || loaded[0]?.id || '';
      setFlows(loaded);
      setSavedFlows(loaded);
      setSelectedFlowId(nextSelectedId);
      setExpandedFlow(nextSelectedId || null);
      setActiveStepId(loaded.find((flow) => flow.id === nextSelectedId)?.steps[0]?.id || '');
    } catch (error) {
      setLoadError(errorMessage(error, 'Não foi possível carregar os fluxos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    setSuccessMsg('');
    try {
      await saveFlows(flows, selectedFlowId);
      setSavedFlows(JSON.parse(JSON.stringify(flows)) as EditableFlow[]);
      setSuccessMsg('Fluxos salvos com sucesso.');
      window.setTimeout(() => setSuccessMsg(''), 3000);
    } catch (error) {
      setSaveError(errorMessage(error, 'Não foi possível salvar os fluxos.'));
    } finally {
      setSaving(false);
    }
  }, [flows, selectedFlowId]);

  const addFlow = useCallback(() => {
    const newFlow = createFlow(flows.length);
    setFlows((current) => [...current, newFlow]);
    setSelectedFlowId(newFlow.id);
    setExpandedFlow(newFlow.id);
    setActiveStepId(newFlow.steps[0]?.id || '');
    setActionError('');
    setSaveError('');
    setSuccessMsg('');
  }, [flows.length]);

  const duplicateFlow = (flowId: string) => {
    const index = flows.findIndex((flow) => flow.id === flowId);
    if (index === -1) return;
    const duplicate = JSON.parse(JSON.stringify(flows[index])) as EditableFlow;
    duplicate.id = `flow_${Date.now().toString(36)}`;
    duplicate.name = `${displayName(duplicate)} (cópia)`;
    const next = [...flows];
    next.splice(index + 1, 0, duplicate);
    setFlows(next);
    setSelectedFlowId(duplicate.id);
    setExpandedFlow(duplicate.id);
    setActiveStepId(duplicate.steps[0]?.id || '');
    setActionError('');
    setSaveError('');
    setSuccessMsg('');
  };

  const deleteFlow = (flowId: string) => {
    if (flows.length <= 1) {
      setActionError('É necessário manter pelo menos um fluxo.');
      return;
    }
    const next = flows.filter((flow) => flow.id !== flowId);
    setFlows(next);
    if (selectedFlowId === flowId) {
      setSelectedFlowId(next[0]?.id || '');
      setExpandedFlow(next[0]?.id || null);
      setActiveStepId(next[0]?.steps[0]?.id || '');
    }
    setActionError('');
    setSaveError('');
    setSuccessMsg('');
  };

  const updateFlow = (flowId: string, field: keyof EditableFlow, value: unknown) => {
    setFlows((current) =>
      current.map((flow) => (flow.id === flowId ? { ...flow, [field]: value } : flow))
    );
    setSaveError('');
    setSuccessMsg('');
  };

  const addStep = (flowId: string) => {
    const step = createStep(STEP_TYPES.TEXT);
    setFlows((current) =>
      current.map((flow) => (flow.id === flowId ? { ...flow, steps: [...flow.steps, step] } : flow))
    );
    setActiveStepId(step.id);
    setSaveError('');
    setSuccessMsg('');
  };

  const updateStep = (flowId: string, stepId: string, field: string, value: unknown) => {
    setFlows((current) =>
      current.map((flow) => {
        if (flow.id !== flowId) return flow;
        return {
          ...flow,
          steps: flow.steps.map((step) =>
            step.id === stepId ? { ...step, [field]: value } : step
          ),
        };
      })
    );
    setSaveError('');
    setSuccessMsg('');
  };

  const removeStep = (flowId: string, stepId: string) => {
    setFlows((current) =>
      current.map((flow) => {
        if (flow.id !== flowId || flow.steps.length <= 1) return flow;
        return { ...flow, steps: flow.steps.filter((step) => step.id !== stepId) };
      })
    );
    setSaveError('');
    setSuccessMsg('');
  };

  const moveStep = (flowId: string, stepId: string, direction: number) => {
    setFlows((current) =>
      current.map((flow) => {
        if (flow.id !== flowId) return flow;
        const index = flow.steps.findIndex((step) => step.id === stepId);
        const nextIndex = index + direction;
        if (index === -1 || nextIndex < 0 || nextIndex >= flow.steps.length) return flow;
        const steps = [...flow.steps];
        [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
        return { ...flow, steps };
      })
    );
    setSaveError('');
    setSuccessMsg('');
  };

  const applyStepTypeChange = (flowId: string, stepId: string, newType: StepType) => {
    setFlows((current) =>
      current.map((flow) => {
        if (flow.id !== flowId) return flow;
        return {
          ...flow,
          steps: flow.steps.map((step) => {
            if (step.id !== stepId) return step;
            const freshStep = createStep(newType);
            return { ...freshStep, id: step.id };
          }),
        };
      })
    );
    setSaveError('');
    setSuccessMsg('');
  };

  const handleStepTypeChange = (flowId: string, stepId: string, newType: StepType) => {
    const step = flows.find((flow) => flow.id === flowId)?.steps.find((item) => item.id === stepId);
    const hasContent =
      step?.type === STEP_TYPES.TEXT
        ? Boolean(step.template?.trim())
        : step?.type === STEP_TYPES.DOCUMENT
          ? Boolean(step.caption?.trim())
          : Boolean(step?.caption_template?.trim());
    if (hasContent) setPendingTypeChange({ flowId, stepId, type: newType });
    else applyStepTypeChange(flowId, stepId, newType);
  };

  useEffect(() => {
    if (!selectedFlow?.steps.length) {
      setActiveStepId('');
      return;
    }
    setActiveStepId((current) =>
      selectedFlow.steps.some((step) => step.id === current)
        ? current
        : selectedFlow.steps[0]!.id
    );
  }, [selectedFlow]);

  if (loading) return <SkeletonComunicacao variant="editor" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <details className="relative z-20 min-w-0 rounded-control border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-fg">Fluxos cadastrados · {flows.length} {flows.length === 1 ? 'fluxo' : 'fluxos'}</summary>
          <section aria-label="Fluxos cadastrados" className="mt-4 min-w-0 space-y-3 xl:absolute xl:left-0 xl:top-9 xl:w-[740px] xl:rounded-card xl:border xl:border-line xl:bg-surface xl:p-4 xl:shadow-xl">

          {flows.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="Nenhum fluxo criado ainda"
              description="Crie um fluxo para organizar mensagens, documentos e mídias enviados pelo WhatsApp."
              actions={
                <Button onClick={addFlow}>
                  <Plus size={14} aria-hidden="true" /> Novo fluxo
                </Button>
              }
              className="rounded-md border border-dashed border-line bg-surface py-12"
            />
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {flows.map((flow) => {
                const isSelected = flow.id === selectedFlow?.id;
                const date = formatDate(flow.updated_at || flow.created_at);
                return (
                  <button
                    key={flow.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedFlowId(flow.id);
                      setExpandedFlow(flow.id);
                      setActiveStepId(flow.steps?.[0]?.id || '');
                    }}
                    className={[
                      'min-w-0 rounded-control border p-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-line bg-surface hover:border-primary/40 hover:bg-surface-hover',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        {flow.enabled ? (
                          <CheckCircle2
                            size={17}
                            className="mt-0.5 shrink-0 text-success"
                            aria-hidden="true"
                          />
                        ) : (
                          <CircleOff
                            size={17}
                            className="mt-0.5 shrink-0 text-fg-muted"
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-fg">
                            {displayName(flow)}
                          </p>
                          <p className="mt-1 truncate text-xs text-fg-muted">
                            {contextLabel(flow.context)} · {channelLabel(flow.channel)}
                          </p>
                        </div>
                      </div>
                      <StatusBadge
                        status={flow.enabled ? 'Active' : 'Archived'}
                        label={flow.enabled ? 'Ativo' : 'Inativo'}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-xs text-fg-muted">
                      <span>{stepCountLabel(flow.steps?.length || 0)}</span>
                      <span className="text-fg-muted/60">·</span>
                      <span className="truncate">
                        {flow.steps?.length
                          ? flow.steps
                              .map((step) => STEP_TYPE_LABELS[step.type] || step.type)
                              .join(' · ')
                          : 'Sem etapas'}
                      </span>
                      {date && (
                        <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap">
                          <CalendarDays size={13} aria-hidden="true" />
                          <time dateTime={flow.updated_at || flow.created_at}>{date}</time>
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          </section>
        </details>
        <Button onClick={addFlow} size="sm">
          <Plus size={14} aria-hidden="true" /> Novo fluxo
        </Button>
      </div>

      {loadError && (
        <div
          className="flex items-start gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
          role="alert"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">Não foi possível carregar os fluxos.</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => void loadFlows()}>
              <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {actionError && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
          role="alert"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      {selectedFlow && <h2 className="text-base font-semibold text-fg">{displayName(selectedFlow)}</h2>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">


        {selectedFlow && (
          <section
            className="overflow-hidden rounded-card bg-surface"
            aria-labelledby="selected-flow-title"
          >
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface p-4">
              <button
                type="button"
                onClick={() =>
                  setExpandedFlow(expandedFlow === selectedFlow.id ? null : selectedFlow.id)
                }
                aria-expanded={expandedFlow === selectedFlow.id}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-raised">
                  <MessageSquare size={18} className="text-sage" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 id="selected-flow-title" className="truncate text-base font-semibold text-fg">
                    Sequência do fluxo
                  </h2>
                </div>
                {expandedFlow === selectedFlow.id ? (
                  <ChevronUp size={18} className="mt-1 shrink-0 text-fg-muted" aria-hidden="true" />
                ) : (
                  <ChevronDown
                    size={18}
                    className="mt-1 shrink-0 text-fg-muted"
                    aria-hidden="true"
                  />
                )}
              </button>

              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => duplicateFlow(selectedFlow.id)}
                  aria-label={`Duplicar ${displayName(selectedFlow)}`}
                  title="Duplicar fluxo"
                >
                  <Copy aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmDeleteFlowId(selectedFlow.id)}
                  aria-label={`Remover ${displayName(selectedFlow)}`}
                  title="Remover fluxo"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
                <span
                  className={[
                    'order-last flex w-full items-center justify-end gap-1.5 text-xs sm:order-none sm:w-auto',
                    saveError
                      ? 'text-destructive'
                      : successMsg
                        ? 'text-success'
                        : isDirty
                          ? 'text-warning'
                          : 'text-fg-muted',
                  ].join(' ')}
                  role={saveError ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : successMsg ? (
                    <CheckCircle2 size={14} aria-hidden="true" />
                  ) : isDirty ? (
                    <AlertCircle size={14} aria-hidden="true" />
                  ) : (
                    <CheckCircle2 size={14} aria-hidden="true" />
                  )}
                  {saving
                    ? 'Salvando alterações…'
                    : saveError ||
                      successMsg ||
                      (isDirty ? 'Alterações não salvas' : 'Sem alterações pendentes')}
                </span>
                <Button
                  type="button"
                  onClick={handleSave}
                  size="sm"
                  disabled={!isDirty || saving || delayRangeInvalid}
                >
                  <Save size={14} aria-hidden="true" />
                  Salvar
                </Button>
              </div>
            </div>

            {expandedFlow === selectedFlow.id && (
              <div className="space-y-5 p-4">
                <section
                  className="space-y-3"
                  aria-labelledby="flow-steps-title"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 id="flow-steps-title" className="text-sm font-semibold text-fg">
                        Etapas do fluxo
                      </h3>
                    </div>
                    <Button
                      type="button"
                      onClick={() => addStep(selectedFlow.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Plus size={14} aria-hidden="true" /> Etapa
                    </Button>
                  </div>

                  {selectedFlow.steps?.map((step, index) => {
                    const StepIcon = STEP_TYPE_ICONS[step.type] || MessageSquare;
                    const isFirst = index === 0;
                    const isLast = index === selectedFlow.steps.length - 1;
                    const isActive = activeStepId === step.id;
                    return (
                      <article
                        key={step.id}
                        className={[
                          'space-y-3 rounded-md border p-3',
                          isActive
                            ? 'border-primary bg-primary/5'
                            : 'border-line bg-surface-muted/40',
                        ].join(' ')}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveStepId(step.id)}
                            className="flex min-h-9 min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                            aria-label={`Editar etapa ${index + 1}`}
                            aria-pressed={isActive}
                          >
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-fg-muted"
                              aria-hidden="true"
                            >
                              {index + 1}
                            </span>
                            <StepIcon
                              size={16}
                              className="shrink-0 text-fg-muted"
                              aria-hidden="true"
                            />
                            <span className="text-sm font-medium text-fg">Etapa {index + 1}</span>
                          </button>
                          <Select
                            aria-label={`Tipo da etapa ${index + 1}`}
                            value={step.type}
                            onChange={(event) =>
                              handleStepTypeChange(
                                selectedFlow.id,
                                step.id,
                                event.target.value as StepType
                              )
                            }
                            className="min-w-0 flex-1 sm:max-w-xs"
                          >
                            {STEP_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => moveStep(selectedFlow.id, step.id, -1)}
                              disabled={isFirst}
                              aria-label={`Mover etapa ${index + 1} para cima`}
                              title="Mover para cima"
                            >
                              <ChevronUp aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => moveStep(selectedFlow.id, step.id, 1)}
                              disabled={isLast}
                              aria-label={`Mover etapa ${index + 1} para baixo`}
                              title="Mover para baixo"
                            >
                              <ChevronDown aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeStep(selectedFlow.id, step.id)}
                              disabled={selectedFlow.steps.length <= 1}
                              aria-label={`Remover etapa ${index + 1}`}
                              title="Remover etapa"
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        </div>

                        {isActive && step.type === STEP_TYPES.TEXT && (
                          <div className="space-y-1.5">
                            <label
                              htmlFor={`step-template-${step.id}`}
                              className="text-xs font-medium text-fg-muted"
                            >
                              Mensagem
                            </label>
                            <textarea
                              id={`step-template-${step.id}`}
                              value={step.template || ''}
                              onChange={(event) =>
                                updateStep(selectedFlow.id, step.id, 'template', event.target.value)
                              }
                              placeholder="Digite a mensagem. Use variáveis como (primeiro_nome) e (produto_resumo)."
                              className="min-h-[96px] w-full resize-y rounded-sm border border-line bg-surface px-3 py-2 text-sm leading-5 text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                            />
                          </div>
                        )}

                        {isActive && step.type === STEP_TYPES.DOCUMENT && (
                          <div className="grid gap-3 md:grid-cols-2">
                            <label
                              htmlFor={`step-source-${step.id}`}
                              className="space-y-1.5 text-sm text-fg"
                            >
                              <span className="text-xs font-medium text-fg-muted">
                                Formato do orçamento
                              </span>
                              <Select
                                id={`step-source-${step.id}`}
                                value={step.source}
                                onChange={(event) =>
                                  updateStep(selectedFlow.id, step.id, 'source', event.target.value)
                                }
                                className="w-full"
                              >
                                <option value="quotation_pdf">PDF (documento)</option>
                                <option value="quotation_webp">WebP (imagem)</option>
                              </Select>
                            </label>
                            <label
                              htmlFor={`step-caption-${step.id}`}
                              className="space-y-1.5 text-sm text-fg"
                            >
                              <span className="text-xs font-medium text-fg-muted">
                                Legenda (opcional)
                              </span>
                              <Input
                                id={`step-caption-${step.id}`}
                                type="text"
                                value={step.caption || ''}
                                onChange={(event) =>
                                  updateStep(
                                    selectedFlow.id,
                                    step.id,
                                    'caption',
                                    event.target.value
                                  )
                                }
                                placeholder="Legenda do documento"
                              />
                            </label>
                          </div>
                        )}

                        {isActive && step.type === STEP_TYPES.PRODUCT_MEDIA && (
                          <div className="grid gap-3 md:grid-cols-[minmax(0,160px)_minmax(0,1fr)]">
                            <label
                              htmlFor={`step-max-items-${step.id}`}
                              className="space-y-1.5 text-sm text-fg"
                            >
                              <span className="text-xs font-medium text-fg-muted">
                                Máx. mídias por grupo
                              </span>
                              <Input
                                id={`step-max-items-${step.id}`}
                                type="number"
                                min="1"
                                max="5"
                                value={step.max_items ?? ''}
                                onChange={(event) =>
                                  updateStep(
                                    selectedFlow.id,
                                    step.id,
                                    'max_items',
                                    Number(event.target.value)
                                  )
                                }
                              />
                            </label>
                            <label
                              htmlFor={`step-caption-template-${step.id}`}
                              className="space-y-1.5 text-sm text-fg"
                            >
                              <span className="text-xs font-medium text-fg-muted">
                                Template de legenda (opcional)
                              </span>
                              <Input
                                id={`step-caption-template-${step.id}`}
                                type="text"
                                value={step.caption_template || ''}
                                onChange={(event) =>
                                  updateStep(
                                    selectedFlow.id,
                                    step.id,
                                    'caption_template',
                                    event.target.value
                                  )
                                }
                                placeholder="Ex.: Referência de (grupo_produto)"
                              />
                            </label>
                            <p className="text-xs text-fg-muted md:col-span-2">
                              Seleciona mídias existentes na biblioteca conforme os produtos do
                              orçamento.
                            </p>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>

                <details className="rounded-control border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium text-fg">Configurações do fluxo</summary>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label
                    htmlFor={`flow-name-${selectedFlow.id}`}
                    className="space-y-1.5 text-sm text-fg"
                  >
                    <span className="font-medium">Nome do fluxo</span>
                    <Input
                      id={`flow-name-${selectedFlow.id}`}
                      type="text"
                      value={selectedFlow.name || ''}
                      onChange={(event) => updateFlow(selectedFlow.id, 'name', event.target.value)}
                    />
                  </label>
                  <label
                    htmlFor={`flow-vendor-${selectedFlow.id}`}
                    className="space-y-1.5 text-sm text-fg"
                  >
                    <span className="font-medium">Vendedora</span>
                    <Input
                      id={`flow-vendor-${selectedFlow.id}`}
                      type="text"
                      value={selectedFlow.vendor_name || ''}
                      onChange={(event) =>
                        updateFlow(selectedFlow.id, 'vendor_name', event.target.value)
                      }
                    />
                  </label>
                  <label
                    htmlFor={`flow-delay-min-${selectedFlow.id}`}
                    className="space-y-1.5 text-sm text-fg"
                  >
                    <span className="font-medium">Delay mínimo (segundos)</span>
                    <Input
                      id={`flow-delay-min-${selectedFlow.id}`}
                      type="number"
                      min="0"
                      max="30"
                      value={selectedFlow.delay_min_seconds ?? ''}
                      onChange={(event) =>
                        updateFlow(selectedFlow.id, 'delay_min_seconds', Number(event.target.value))
                      }
                    />
                  </label>
                  <label
                    htmlFor={`flow-delay-max-${selectedFlow.id}`}
                    className="space-y-1.5 text-sm text-fg"
                  >
                    <span className="font-medium">Delay máximo (segundos)</span>
                    <Input
                      id={`flow-delay-max-${selectedFlow.id}`}
                      type="number"
                      min="0"
                      max="45"
                      value={selectedFlow.delay_max_seconds ?? ''}
                      aria-invalid={delayRangeInvalid}
                      onChange={(event) =>
                        updateFlow(selectedFlow.id, 'delay_max_seconds', Number(event.target.value))
                      }
                    />
                    {delayRangeInvalid && (
                      <span className="text-xs text-destructive" role="alert">
                        O máximo deve ser maior ou igual ao mínimo.
                      </span>
                    )}
                  </label>
                </div>
                </details>

                <section
                  className="space-y-2 border-t border-line pt-4"
                  aria-labelledby="flow-summary-title"
                >
                  <h3 id="flow-summary-title" className="text-sm font-semibold text-fg">
                    Resumo das etapas
                  </h3>
                  <ol className="space-y-1.5">
                    {(selectedFlow.steps || []).map((step, index) => {
                      const StepIcon = STEP_TYPE_ICONS[step.type] || MessageSquare;
                      return (
                        <li
                          key={step.id}
                          className="flex min-w-0 items-start gap-2 text-sm text-fg"
                        >
                          <span className="w-5 shrink-0 text-right text-xs text-fg-muted">
                            {index + 1}.
                          </span>
                          <StepIcon
                            size={15}
                            className="mt-0.5 shrink-0 text-fg-muted"
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            className="min-w-0 truncate text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => setActiveStepId(step.id)}
                            aria-pressed={activeStepId === step.id}
                          >
                            {stepLabel(step)}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="text-xs text-fg-muted">
                    Nenhum valor de exemplo é aplicado nesta prévia; tokens serão resolvidos durante
                    o envio.
                  </p>
                </section>
              </div>
            )}
          </section>
        )}

        {selectedFlow && (
          <FlowPreview
            step={
              selectedFlow.steps?.find((step) => step.id === activeStepId) ||
              selectedFlow.steps?.[0]
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={pendingTypeChange !== null}
        title="Trocar tipo da etapa?"
        message="O conteúdo específico atual será substituído pelo novo tipo."
        confirmLabel="Trocar tipo"
        cancelLabel="Cancelar"
        variant="default"
        onConfirm={() => {
          const pending = pendingTypeChange;
          setPendingTypeChange(null);
          if (pending) applyStepTypeChange(pending.flowId, pending.stepId, pending.type);
        }}
        onCancel={() => setPendingTypeChange(null)}
      />
      <ConfirmDialog
        open={confirmDeleteFlowId !== null}
        title="Remover fluxo?"
        message={`O fluxo "${displayName(flows.find((flow) => flow.id === confirmDeleteFlowId) || { name: '' })}" será removido da lista local. Salve para persistir a alteração.`}
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

function FlowPreview({ step }: { step?: FlowStep }) {
  let title = 'Prévia da etapa';
  let content = 'Selecione uma etapa para consultar a prévia.';
  let note = 'Tokens permanecem sem resolver até o envio.';

  if (step?.type === STEP_TYPES.TEXT) {
    content = step.template?.trim() || 'Mensagem sem conteúdo.';
  } else if (step?.type === STEP_TYPES.DOCUMENT) {
    title = 'Prévia do orçamento';
    content = `${step.source === 'quotation_webp' ? 'Documento WebP' : 'Documento PDF'}\n${step.caption?.trim() || 'Orçamento selecionado no envio.'}`;
    note = 'O documento é gerado no fluxo de envio.';
  } else if (step?.type === STEP_TYPES.PRODUCT_MEDIA) {
    title = 'Prévia da mídia';
    content = `Mídia da biblioteca\nAté ${step.max_items || 1} arquivo por grupo${step.caption_template?.trim() ? `\n${step.caption_template.trim()}` : ''}`;
    note = 'A seleção depende dos produtos do orçamento.';
  }

  return (
    <aside
      className="min-w-0 rounded-card bg-surface p-4"
      aria-labelledby="flow-preview-title"
    >
      <h3 id="flow-preview-title" className="text-base font-semibold text-fg">Prévia no WhatsApp</h3>
      <p className="mt-1 text-xs text-fg-muted">{title}</p>
      <div className="mt-5 overflow-hidden rounded-card border-[7px] border-surface-subtle bg-light-sage">
        <div className="px-4 py-3 text-xs font-semibold text-on-solid">Aspen · prévia</div>
        <div className="min-h-48 bg-chat-background p-3">
          <div className="whitespace-pre-line rounded-control bg-shell p-3 text-xs leading-5 text-shell-text shadow-sm">{content}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-muted">{note}</p>
    </aside>
  );
}
