import { useEffect, useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import { Dialog } from '@/components/ui/dialog';
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
  initialTemplate?: OrderTemplate | null;
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

export default function OrderTemplateManager({
  open,
  templates,
  initialTemplate = null,
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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(false);

  const editing = editingId !== null;

  useEffect(() => {
    if (!open || editingId === null) return;
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingId, open]);

  useEffect(() => {
    if (!open) return;
    setEditingId(initialTemplate?.id ?? null);
    setName(initialTemplate?.name ?? '');
    setSelectedItems(initialTemplate ? selectedFromTemplate(initialTemplate) : []);
    setSearchTerm('');
    setSearchResults([]);
    setError(null);
    setSaving(false);
    setArchiveTarget(null);
    operationRef.current = false;
  }, [initialTemplate, open]);

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
      setError('Informe o nome do modelo de pedido.');
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
      setError('Não foi possível salvar o modelo. Tente novamente.');
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
      setError('Não foi possível arquivar o modelo. Tente novamente.');
    } finally {
      operationRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open
        size="lg"
        onClose={() => {
          if (!operationRef.current) onClose();
        }}
        dismissible={!saving}
        title="Modelos de pedido"
        description="Conjuntos de produtos reutilizáveis, sem quantidades."
      >
            {error && (
              <InlineAlert className="mb-4">{error}</InlineAlert>
            )}

            {!editing ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-fg-muted">
                    {templates.length
                      ? `${templates.length} modelo${templates.length === 1 ? '' : 's'}`
                      : 'Nenhum modelo criado'}
                  </p>
                  <Button type="button" size="sm" onClick={startCreate} disabled={saving}>
                    <Plus size={14} />
                    Novo modelo
                  </Button>
                </div>
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex flex-col gap-3 rounded-control border border-border-subtle bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
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
                    {editingId === 'new' ? 'Novo modelo' : 'Editar modelo'}
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
                      <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-control border border-border-subtle bg-surface p-1 shadow-lg">
                        {searchLoading ? (
                          <p className="px-3 py-2 text-sm text-fg-muted">Buscando produtos…</p>
                        ) : searchResults.length ? (
                          searchResults.map((product) => (
                            <button
                              key={product.sku}
                              type="button"
                              aria-label={`Adicionar produto ${product.sku}`}
                              onClick={() => addProduct(product)}
                              className="flex w-full min-w-0 items-start gap-3 rounded-control px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover focus-inset"
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
                    <div className="rounded-control border border-dashed border-border-subtle bg-raised/50 px-3 py-6 text-center text-sm text-fg-muted">
                      Busque e selecione os produtos que entram neste modelo.
                    </div>
                  ) : (
                    selectedItems.map((item, index) => (
                      <div
                        key={item.sku}
                        aria-label={`SKU selecionado ${item.sku}`}
                        className="flex min-w-0 items-center gap-2 rounded-control border border-border-subtle bg-raised px-3 py-2"
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
                          className="rounded-control p-1 text-fg-muted hover:bg-surface-hover disabled:opacity-30"
                        >
                          <ChevronUp size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Mover ${item.sku} para baixo`}
                          onClick={() => moveItem(index, 1)}
                          disabled={saving || index === selectedItems.length - 1}
                          className="rounded-control p-1 text-fg-muted hover:bg-surface-hover disabled:opacity-30"
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
                          className="rounded-control p-1 text-fg-muted hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
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
      </Dialog>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Arquivar modelo"
        message={`Arquivar “${archiveTarget?.name || ''}”? Ele deixará de aparecer no seletor.`}
        confirmLabel="Arquivar"
        onCancel={() => !operationRef.current && setArchiveTarget(null)}
        onConfirm={archive}
      />
    </>
  );
}

export type { OrderTemplateManagerProps };
