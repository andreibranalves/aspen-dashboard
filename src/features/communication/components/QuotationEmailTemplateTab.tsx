import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ApiError } from '@/lib/api/api';
import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  QUOTATION_EMAIL_TEMPLATE_LIMITS,
  QUOTATION_EMAIL_TEMPLATE_TOKENS,
  getQuotationEmailTemplate,
  renderQuotationEmailTemplate,
  saveQuotationEmailTemplate,
  validateQuotationEmailTemplate,
} from '@/lib/api/quotationEmailTemplateApi';
import type {
  QuotationEmailTemplate,
  QuotationEmailTemplateField,
} from '@/lib/api/quotationEmailTemplateApi';

type TemplateFieldErrors = Partial<Record<QuotationEmailTemplateField | '_form', string>>;

type FieldConfig = {
  field: QuotationEmailTemplateField;
  label: string;
  multiline: boolean;
};

const FIELD_CONFIG: FieldConfig[] = [
  { field: 'subject', label: 'Assunto', multiline: false },
  { field: 'greeting', label: 'Saudação', multiline: true },
  { field: 'message', label: 'Mensagem principal', multiline: true },
  { field: 'button_label', label: 'Texto do botão', multiline: false },
  { field: 'signature', label: 'Assinatura', multiline: true },
];

const PREVIEW_INPUT = {
  customerName: 'Maria Silva',
  businessNumber: 'ORC-20260001',
  publicUrl: 'https://example.invalid/orcamento',
};

const TEMPLATE_FIELDS: QuotationEmailTemplateField[] = FIELD_CONFIG.map(({ field }) => field);

function sameTemplate(left: QuotationEmailTemplate | null, right: QuotationEmailTemplate | null) {
  if (!left || !right) return left === right;
  return TEMPLATE_FIELDS.every((field) => left[field] === right[field]);
}

function fieldErrorsFrom(error: unknown): TemplateFieldErrors | null {
  const data = (error as ApiError | undefined)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const fields = (data as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  return fields as TemplateFieldErrors;
}

export interface QuotationEmailTemplateTabProps {
  onDirtyChange?: (dirty: boolean) => void;
}

export default function QuotationEmailTemplateTab({
  onDirtyChange,
}: QuotationEmailTemplateTabProps) {
  const [saved, setSaved] = useState<QuotationEmailTemplate | null>(null);
  const [form, setForm] = useState<QuotationEmailTemplate | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TemplateFieldErrors>({});
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const fieldRefs = useRef<Partial<Record<QuotationEmailTemplateField, HTMLInputElement | HTMLTextAreaElement>>>({});
  const lastFocusedField = useRef<QuotationEmailTemplateField>('message');

  const dirty = Boolean(form && saved && !sameTemplate(form, saved));

  const loadTemplate = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setSuccess('');
    try {
      const next = await getQuotationEmailTemplate();
      setSaved({ ...next });
      setForm({ ...next });
      setFieldErrors({});
    } catch {
      setSaved(null);
      setForm(null);
      setLoadError('Não foi possível carregar o modelo de e-mail.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const updateField = useCallback((field: QuotationEmailTemplateField, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSaveError('');
    setSuccess('');
  }, []);

  const focusFirstInvalid = useCallback((errors: TemplateFieldErrors) => {
    const firstInvalid = TEMPLATE_FIELDS.find((field) => errors[field]);
    if (!firstInvalid) return;
    window.requestAnimationFrame(() => fieldRefs.current[firstInvalid]?.focus());
  }, []);

  const handleSave = useCallback(async () => {
    if (!form) return;

    const validation = validateQuotationEmailTemplate(form);
    if (!validation.ok) {
      setFieldErrors(validation.fields);
      setSaveError('Revise os campos destacados.');
      focusFirstInvalid(validation.fields);
      return;
    }

    setSaving(true);
    setSaveError('');
    setSuccess('');
    try {
      const next = await saveQuotationEmailTemplate(validation.value);
      setSaved({ ...next });
      setForm({ ...next });
      setFieldErrors({});
      setSuccess('Modelo salvo. Os próximos envios usarão esta configuração.');
    } catch (error) {
      const fields = fieldErrorsFrom(error);
      if (fields) {
        setFieldErrors(fields);
        focusFirstInvalid(fields);
      }
      setSaveError((error as ApiError)?.message || 'Não foi possível salvar o modelo de e-mail.');
    } finally {
      setSaving(false);
    }
  }, [focusFirstInvalid, form]);

  const insertToken = useCallback((token: string) => {
    if (!form) return;
    const field = lastFocusedField.current;
    const target = fieldRefs.current[field];
    const value = form[field];
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    updateField(field, next);
    window.requestAnimationFrame(() => {
      const nextTarget = fieldRefs.current[field];
      const cursor = start + token.length;
      nextTarget?.focus();
      nextTarget?.setSelectionRange(cursor, cursor);
    });
  }, [form, updateField]);

  const rendered = form ? renderQuotationEmailTemplate(form, PREVIEW_INPUT) : null;
  const formDisabled = loading || saving || !form;

  return (
    <>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-fg">E-mail de orçamento</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Configure o conteúdo usado nos próximos envios de orçamento.
          </p>
          {dirty && (
            <p className="mt-2 text-sm font-medium text-warning" role="status">
              Alterações não salvas.
            </p>
          )}
        </div>

        {loading && (
          <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted" aria-busy="true">
            Carregando modelo de e-mail...
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-fg" role="alert">
            <div className="flex items-start gap-2">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Não foi possível carregar o modelo de e-mail.</p>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadTemplate()}
                >
                  <RefreshCw size={14} />
                  Tentar novamente
                </Button>
              </div>
            </div>
          </div>
        )}

        {!loading && !loadError && form && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-surface p-6">
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSave();
                }}
              >
                {FIELD_CONFIG.map(({ field, label, multiline }) => {
                  const id = `quotation-email-template-${field}`;
                  const countId = `${id}-count`;
                  const errorId = `${id}-error`;
                  const describedBy = fieldErrors[field]
                    ? `${countId} ${errorId}`
                    : countId;
                  const commonProps = {
                    id,
                    value: form[field],
                    maxLength: QUOTATION_EMAIL_TEMPLATE_LIMITS[field],
                    disabled: formDisabled,
                    'aria-invalid': Boolean(fieldErrors[field]),
                    'aria-describedby': describedBy,
                    onFocus: () => {
                      lastFocusedField.current = field;
                    },
                    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                      updateField(field, event.target.value);
                    },
                    ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
                      if (element) fieldRefs.current[field] = element;
                      else delete fieldRefs.current[field];
                    },
                  };

                  return (
                    <div key={field} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor={id} className="text-sm font-medium text-fg">
                          {label}
                        </label>
                        <span id={countId} className="text-xs text-fg-muted">
                          {form[field].length}/{QUOTATION_EMAIL_TEMPLATE_LIMITS[field]} caracteres
                        </span>
                      </div>
                      {multiline ? (
                        <textarea
                          {...commonProps}
                          rows={field === 'message' ? 7 : 3}
                          className="w-full resize-y rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-[1.3] text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      ) : (
                        <Input {...commonProps} />
                      )}
                      {fieldErrors[field] && (
                        <p id={errorId} className="text-xs text-destructive" role="alert">
                          {fieldErrors[field]}
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="space-y-2 border-t border-line pt-4">
                  <p className="text-sm font-medium text-fg">Variáveis disponíveis</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={formDisabled}
                      onClick={() => insertToken(QUOTATION_EMAIL_TEMPLATE_TOKENS[0])}
                    >
                      Inserir nome do cliente
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={formDisabled}
                      onClick={() => insertToken(QUOTATION_EMAIL_TEMPLATE_TOKENS[1])}
                    >
                      Inserir número do orçamento
                    </Button>
                  </div>
                </div>

                {(saveError || fieldErrors._form) && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
                    role="alert"
                  >
                    <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
                    {saveError && <span>{saveError}</span>}
                    {fieldErrors._form && <span>{fieldErrors._form}</span>}
                  </div>
                )}

                {success && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/10 p-3 text-sm text-fg"
                    role="status"
                  >
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                    <span>{success}</span>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={formDisabled}
                    onClick={() => setRestoreOpen(true)}
                  >
                    <RotateCcw size={16} />
                    Restaurar modelo padrão
                  </Button>
                  <Button type="submit" disabled={formDisabled}>
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    {saving ? 'Salvando...' : 'Salvar alterações'}
                  </Button>
                </div>
              </form>
            </section>

            <section className="rounded-xl border border-line bg-surface p-6" aria-label="Preview do e-mail">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-fg">Preview</h2>
                <p className="mt-1 text-xs text-fg-muted">Dados fictícios para visualização.</p>
              </div>
              {rendered && (
                <div className="space-y-3">
                  <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">
                    <span className="font-medium">Assunto:</span> {rendered.subject}
                  </p>
                  <iframe
                    title="Preview do e-mail"
                    sandbox=""
                    srcDoc={rendered.html}
                    className="pointer-events-none h-[420px] w-full rounded-lg border border-line bg-white"
                  />
                  <div className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-fg">
                    Anexo: orcamento-ORC-20260001.pdf
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={restoreOpen}
        title="Restaurar modelo padrão?"
        message="O formulário será restaurado, mas a alteração só será ativada após salvar."
        confirmLabel="Restaurar padrão"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          setForm({ ...DEFAULT_QUOTATION_EMAIL_TEMPLATE });
          setFieldErrors({});
          setSaveError('');
          setSuccess('');
          setRestoreOpen(false);
        }}
        onCancel={() => setRestoreOpen(false)}
      />
    </>
  );
}
