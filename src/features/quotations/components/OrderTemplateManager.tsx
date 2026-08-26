import { useEffect, useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import {
  archiveOrderTemplate,
  createOrderTemplate,
  updateOrderTemplate,
  type OrderTemplate,
} from '@/lib/api/orderTemplatesApi';
import type { Product } from '@/types/domain';

interface OrderTemplateManagerProps {
  open: boolean;
  templates: OrderTemplate[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

interface SelectedItem {
  sku: string;
  name: string;
}

function selectedFromTemplate(template: OrderTemplate): SelectedItem[] {
  return [...template.items]
    .sort((a, b) => a.position - b.position)
    .map(({ sku, name }) => ({ sku, name }));
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export default function OrderTemplateManager({
  open,
  templates,
  onClose,
  onChanged,
}: OrderTemplateManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<OrderTemplate | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const archiveTargetRef = useRef<OrderTemplate | null>(null);
  const operationRef = useRef(false);

  const editing = editingId !== null;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    archiveTargetRef.current = archiveTarget;
  }, [archiveTarget]);

  useEffect(() => {
    if (!open) {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !archiveTargetRef.current) {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = focusableElements(dialog);
        const first = focusable[0];
        const last = focusable.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          event.shiftKey &&
          (active === dialog || active === first || !dialog.contains(active))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (operationRef.current) return;
      if (archiveTargetRef.current) {
        setArchiveTarget(null);
        return;
      }
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    if (!open || editingId === null) return;
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingId, open]);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setName('');
    setSelectedItems([]);
    setSearchTerm('');
    setSearchResults([]);
    setError(null);
    setSaving(false);
    setArchiveTarget(null);
    operationRef.current = false;
  }, [open]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let active = true;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      searchProducts(term, 8)
        .then((products) => {
          if (!active) return;
          setSearchResults(products.filter((product) => !isUnpricedProduct(product)));
        })
        .catch(() => {
          if (active) setSearchResults([]);
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  if (!open) return null;

  const startCreate = () => {
    if (operationRef.current || saving) return;
    setEditingId('new');
    setName('');
    setSelectedItems([]);
    setSearchTerm('');
    setSearchResults([]);
    setError(null);
  };

  const startEdit = (template: OrderTemplate) => {
    if (operationRef.current || saving) return;
    setEditingId(template.id);
    setName(template.name);
    setSelectedItems(selectedFromTemplate(template));
    setSearchTerm('');
    setSearchResults([]);
    setError(null);
  };

  const cancelEdit = (force = false) => {
    if (saving && !force) return;
    setEditingId(null);
    setName('');
    setSelectedItems([]);
    setSearchTerm('');
    setSearchResults([]);
    setError(null);
  };

  const addProduct = (product: Product) => {
    const sku = String(product.sku || '').trim();
    if (!sku || selectedItems.some((item) => item.sku === sku)) return;
    setSelectedItems((items) => [
      ...items,
      { sku, name: product.nome || product.item_name || sku },
    ]);
    setSearchTerm('');
    setSearchResults([]);
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setSelectedItems((items) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= items.length) return items;
      const next = [...items];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const save = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Informe o nome do template de pedido.');
      return;
    }
    if (selectedItems.length === 0) {
      setError('Adicione pelo menos um produto.');
      return;
    }
    if (operationRef.current) return;
    operationRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const input = { name: normalizedName, skus: selectedItems.map((item) => item.sku) };
      if (editingId === 'new') await createOrderTemplate(input);
      else if (editingId) await updateOrderTemplate(editingId, input);
      await onChanged();
      cancelEdit(true);
    } catch {
      setError('Não foi possível salvar o template. Tente novamente.');
    } finally {
      operationRef.current = false;
      setSaving(false);
    }
  };

  const archive = async () => {
    const target = archiveTarget;
    if (!target || operationRef.current) return;
    operationRef.current = true;
    setSaving(true);
    setArchiveTarget(null);
    setError(null);
    try {
      await archiveOrderTemplate(target.id);
      await onChanged();
      if (editingId === target.id) cancelEdit(true);
    } catch {
      setError('Não foi possível arquivar o template. Tente novamente.');
    } finally {
      operationRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <div
        data-testid="order-template-manager-backdrop"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
        onClick={(event) => {
          if (event.target === event.currentTarget && !saving && !operationRef.current) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-template-manager-title"
          tabIndex={-1}
          className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl focus:outline-none sm:max-h-[calc(100vh-3rem)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
            <div>
              <h2 id="order-template-manager-title" className="text-lg font-semibold text-fg">
                Templates de pedido
              </h2>
              <p className="text-xs text-fg-muted">
                Grupos compartilhados de SKUs, sem quantidades.
              </p>
            </div>
            <button
              type="button"
              aria-label="Fechar"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}

            {!editing ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-fg-muted">
                    {templates.length
                      ? `${templates.length} template${templates.length === 1 ? '' : 's'}`
                      : 'Nenhum template criado'}
                  </p>
                  <Button type="button" size="sm" onClick={startCreate} disabled={saving}>
                    <Plus size={14} />
                    Novo template
                  </Button>
                </div>
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex flex-col gap-3 rounded-lg border border-line bg-surface-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{template.name}</p>
                      <p className="mt-1 break-words text-xs text-fg-muted">
                        {template.items.map((item) => item.sku).join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(template)}
                        disabled={saving}
                      >
                        <Pencil size={13} />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Arquivar ${template.name}`}
                        onClick={() => !operationRef.current && setArchiveTarget(template)}
                        disabled={saving}
                      >
                        <Archive size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-fg">
                    {editingId === 'new' ? 'Novo template' : 'Editar template'}
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelEdit()}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                </div>

                <label className="block text-sm font-medium text-fg">
                  Nome
                  <Input
                    ref={nameInputRef}
                    aria-label="Nome"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Todos os lenços"
                    disabled={saving}
                    className="mt-1"
                  />
                </label>

                <div>
                  <label
                    className="block text-sm font-medium text-fg"
                    htmlFor="order-template-product-search"
                  >
                    Produtos
                  </label>
                  <div className="relative mt-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
                      size={15}
                    />
                    <Input
                      id="order-template-product-search"
                      aria-label="Buscar produto"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Buscar por SKU ou nome"
                      disabled={saving}
                      className="pl-9"
                    />
                    {searchTerm.trim().length >= 2 && (
                      <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
                        {searchLoading ? (
                          <p className="px-3 py-2 text-sm text-fg-muted">Buscando produtos…</p>
                        ) : searchResults.length ? (
                          searchResults.map((product) => (
                            <button
                              key={product.sku}
                              type="button"
                              aria-label={`Adicionar produto ${product.sku}`}
                              onClick={() => addProduct(product)}
                              className="flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted"
                            >
                              <span className="shrink-0 font-mono text-xs text-fg-muted">
                                {product.sku}
                              </span>
                              <span className="min-w-0 break-words text-fg">
                                {product.nome || product.item_name || 'Produto'}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-sm text-fg-muted">
                            Nenhum produto encontrado.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-fg">SKUs selecionados</p>
                  {selectedItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-fg-muted">
                      Busque e selecione os produtos que entram neste template.
                    </div>
                  ) : (
                    selectedItems.map((item, index) => (
                      <div
                        key={item.sku}
                        aria-label={`SKU selecionado ${item.sku}`}
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-line px-3 py-2"
                      >
                        <span className="w-6 shrink-0 text-center text-xs text-fg-muted">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm text-fg">{item.name}</p>
                          <p className="font-mono text-xs text-fg-muted">{item.sku}</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Mover ${item.sku} para cima`}
                          onClick={() => moveItem(index, -1)}
                          disabled={saving || index === 0}
                          className="rounded-md p-1 text-fg-muted hover:bg-surface-muted disabled:opacity-30"
                        >
                          <ChevronUp size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Mover ${item.sku} para baixo`}
                          onClick={() => moveItem(index, 1)}
                          disabled={saving || index === selectedItems.length - 1}
                          className="rounded-md p-1 text-fg-muted hover:bg-surface-muted disabled:opacity-30"
                        >
                          <ChevronDown size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remover ${item.sku}`}
                          onClick={() =>
                            setSelectedItems((items) =>
                              items.filter((_, itemIndex) => itemIndex !== index)
                            )
                          }
                          disabled={saving}
                          className="rounded-md p-1 text-fg-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/30"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-line pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => cancelEdit()}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" onClick={save} disabled={saving}>
                    {saving ? 'Salvando…' : 'Salvar'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Arquivar template"
        message={`Arquivar “${archiveTarget?.name || ''}”? Ele deixará de aparecer no seletor.`}
        confirmLabel="Arquivar"
        onCancel={() => !operationRef.current && setArchiveTarget(null)}
        onConfirm={archive}
      />
    </>
  );
}

export type { OrderTemplateManagerProps };
