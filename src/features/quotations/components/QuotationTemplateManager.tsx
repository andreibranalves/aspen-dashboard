import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import Skeleton from '@/components/shared/Skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  archiveQuotationTemplate,
  createQuotationTemplate,
  getQuotationTemplate,
  listQuotationTemplates,
  saveQuotationTemplateVersion,
  setDefaultQuotationTemplate,
  validateQuotationTemplate,
  type QuotationTemplateDetail,
  type QuotationTemplateMetadata,
} from '@/lib/api/quotationTemplatesApi';

interface QuotationTemplateManagerProps {
  onTemplatesChanged?: (defaultKey?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function errorMessage(_error: unknown, fallback: string) {
  return fallback;
}

export function QuotationTemplateManager({
  onTemplatesChanged,
  onDirtyChange,
}: QuotationTemplateManagerProps) {
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [defaultKey, setDefaultKey] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuotationTemplateDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [source, setSource] = useState('');
  const [validation, setValidation] = useState<{ warnings: string[]; preview: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<'archive' | 'set_default' | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const detailRequestRef = useRef(0);
  const newFormIntentRef = useRef(false);

  const isDirty = detail
    ? name !== detail.name || source !== detail.current_source
    : newFormIntentRef.current && Boolean(name || key || source);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const result = await listQuotationTemplates();
      const available = result.templates || result.data || [];
      setTemplates(available);
      setDefaultKey(result.default_key || available.find((item) => item.is_default)?.key || '');
      setSelectedId(
        (current) => current || (newFormIntentRef.current ? null : available[0]?.id || null)
      );
    } catch (error) {
      setListError(errorMessage(error, 'Não foi possível carregar os modelos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await getQuotationTemplate(id);
      if (requestId !== detailRequestRef.current) return;
      setDetail(result);
      setName(result.name);
      setKey(result.key);
      setSource(result.current_source);
      setValidation(null);
      setMessage(null);
      setAdvancedOpen(false);
    } catch (error) {
      if (requestId !== detailRequestRef.current) return;
      setDetail(null);
      setDetailError(errorMessage(error, 'Não foi possível carregar o modelo.'));
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  function applyNew() {
    newFormIntentRef.current = true;
    detailRequestRef.current += 1;
    setSelectedId(null);
    setDetail(null);
    setName('');
    setKey('');
    setSource('');
    setValidation(null);
    setMessage(null);
    setAdvancedOpen(true);
  }

  function resetNew() {
    if (isDirty) {
      setPendingSelection('__new__');
      return;
    }
    applyNew();
  }

  function selectTemplate(id: string) {
    newFormIntentRef.current = false;
    setDetailError(null);
    if (id !== selectedId) {
      setDetail(null);
      setSelectedId(id);
    } else if (!detail && !detailLoading) {
      void loadDetail(id);
    }
  }

  async function validate() {
    setMessage(null);
    try {
      setValidation(await validateQuotationTemplate(source, key));
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível validar o modelo.'));
    }
  }

  async function save() {
    if (!name.trim() || !key.trim() || !source.trim()) {
      setMessage('Informe identificador, nome e conteúdo do modelo.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (detail) {
        await saveQuotationTemplateVersion(detail.id, { name, source });
        await loadDetail(detail.id);
      } else {
        const created = await createQuotationTemplate({ key, name, source });
        setSelectedId(created.id);
      }
      await loadTemplates();
      setMessage('Modelo salvo com sucesso.');
      onTemplatesChanged?.(defaultKey);
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível salvar o modelo.'));
    } finally {
      setSaving(false);
    }
  }

  async function setDefault() {
    if (!detail) return;
    setSaving(true);
    try {
      const result = await setDefaultQuotationTemplate(detail.id);
      setDefaultKey(result.default_key);
      await loadTemplates();
      onTemplatesChanged?.(result.default_key);
      setMessage('Modelo padrão alterado.');
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível alterar o modelo padrão.'));
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!detail) return;
    setSaving(true);
    try {
      await archiveQuotationTemplate(detail.id);
      await loadTemplates();
      await loadDetail(detail.id);
      setMessage('Modelo arquivado.');
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível arquivar o modelo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading && !templates.length && (
        <div role="status" aria-busy="true" aria-label="Carregando modelos" className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.5fr)]">
          <div className="space-y-3">
            <Skeleton className="h-9 w-36 rounded-control" />
            <Skeleton className="h-28 rounded-card" />
            <Skeleton className="h-28 rounded-card" />
          </div>
          <Skeleton className="h-[440px] rounded-card" />
        </div>
      )}
      {listError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-destructive/25 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p>{listError}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void loadTemplates()}
            >
              <RefreshCw size={14} /> Recarregar modelos
            </Button>
          </div>
        </div>
      )}
      {!listError && !(loading && !templates.length) && (
        <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.5fr)]">
          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" onClick={resetNew}>
              <Plus size={14} /> Novo modelo
            </Button>
            {templates.map((template) => (
              <button
                type="button"
                key={template.id}
                onClick={() => {
                  if (isDirty) setPendingSelection(template.id);
                  else selectTemplate(template.id);
                }}
                disabled={saving}
                className={`block w-full rounded-control border p-3 text-left transition-colors ${selectedId === template.id ? 'border-primary bg-surface-selected' : 'border-border-subtle bg-surface hover:bg-surface-hover'}`}
              >
                <span className="block font-medium text-fg">{template.name}</span>
                <span className="mt-1 block text-xs text-fg-muted">
                  {template.key} · Usado por {template.usage_count} revisões
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {template.is_default && <StatusBadge status="Open" label="Padrão" />}
                  <StatusBadge
                    status={template.archived ? 'Draft' : 'Issued'}
                    label={template.archived ? 'Arquivado' : 'Ativo'}
                  />
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {detailLoading && (
              <div role="status" aria-busy="true" aria-label="Carregando detalhes do modelo">
                <Skeleton className="h-[440px] rounded-card" />
              </div>
            )}
            {detailError && selectedId && (
              <div
                role="alert"
                className="rounded-control border border-destructive/25 bg-destructive/5 p-3 text-sm"
              >
                <p>{detailError}</p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => void loadDetail(selectedId)}
                >
                  <RefreshCw size={14} /> Tentar novamente
                </Button>
              </div>
            )}
            {!detailLoading && !detailError && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm text-fg">
                    <span className="font-medium">Nome</span>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <label className="space-y-1.5 text-sm text-fg">
                    <span className="font-medium">Identificador</span>
                    <Input
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      disabled={saving || !!detail}
                    />
                  </label>
                </div>
                {detail && (
                  <p className="text-xs text-fg-muted">
                    Versão atual: {detail.current_version || 1}
                  </p>
                )}
                {detail && !advancedOpen ? (
                  <div className="space-y-3">
                    {validation?.preview ? (
                      // Fundo branco intencional: preview de e-mail é sempre renderizado em fundo claro.
                      <iframe
                        title="Pré-visualização do modelo"
                        sandbox=""
                        srcDoc={validation.preview}
                        className="h-80 w-full rounded-control border border-border-subtle bg-white"
                      />
                    ) : (
                      <div className="flex min-h-48 items-center justify-center rounded-control border border-dashed border-border-subtle bg-raised p-5 text-center text-sm text-fg-muted">
                        Valide o modelo para gerar a prévia.
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="block space-y-1.5 text-sm text-fg">
                    <span className="font-medium">Conteúdo do modelo</span>
                    <Textarea
                      value={source}
                      onChange={(event) => setSource(event.target.value)}
                      disabled={saving}
                      rows={14}
                      className="min-h-72 resize-y font-mono text-xs leading-[1.4]"
                    />
                  </label>
                )}
                {validation?.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-warning">
                    Aviso: {warning}
                  </p>
                ))}
                {message && (
                  <p role="status" className="text-sm text-fg">
                    {message}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void validate()}
                    disabled={saving || !source || !key}
                  >
                    <Eye size={14} /> Validar e visualizar
                  </Button>
                  {detail && !advancedOpen && (
                    <Button type="button" variant="outline" onClick={() => setAdvancedOpen(true)}>
                      Editar avançado
                    </Button>
                  )}
                  {(advancedOpen || !detail) && (
                    <Button type="button" onClick={() => void save()} disabled={saving}>
                      {saving ? <Loader2 className="animate-spin" /> : <Save />}{' '}
                      {detail ? 'Salvar nova versão' : 'Criar modelo'}
                    </Button>
                  )}
                  {detail && !detail.is_default && !detail.archived && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingConfirm('set_default')}
                      disabled={saving}
                    >
                      Definir como padrão
                    </Button>
                  )}
                  {detail && !detail.is_default && !detail.archived && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setPendingConfirm('archive')}
                      disabled={saving}
                    >
                      <Trash2 size={14} /> Arquivar
                    </Button>
                  )}
                </div>
                {defaultKey && <p className="text-xs text-fg-muted">Modelo padrão: {defaultKey}</p>}
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingSelection !== null}
        title="Descartar alterações?"
        message="As alterações não salvas deste modelo serão perdidas."
        confirmLabel="Descartar e continuar"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingSelection;
          setPendingSelection(null);
          if (target === '__new__') applyNew();
          else if (target) selectTemplate(target);
        }}
        onCancel={() => setPendingSelection(null)}
      />
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm === 'archive' ? 'Arquivar este modelo?' : 'Definir como padrão?'}
        message={
          pendingConfirm === 'archive'
            ? 'O modelo deixará de estar disponível para novos orçamentos, mas o histórico é preservado.'
            : 'Novos orçamentos usarão este modelo por padrão.'
        }
        confirmLabel={pendingConfirm === 'archive' ? 'Arquivar' : 'Definir como padrão'}
        cancelLabel="Cancelar"
        variant={pendingConfirm === 'archive' ? 'destructive' : 'default'}
        onConfirm={() => {
          const action = pendingConfirm;
          setPendingConfirm(null);
          if (action === 'archive') void archive();
          if (action === 'set_default') void setDefault();
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
