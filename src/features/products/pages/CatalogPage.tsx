import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Boxes, Image as ImageIcon, PlusCircle, RefreshCw, X } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import { useHashQueryState, parseHashOption, parseHashString } from '@/hooks/useHashQueryState';
import { useHashRoute } from '@/hooks/useHashRoute';
import { listOrderTemplates, type OrderTemplate } from '@/lib/api/orderTemplatesApi';
import { EmptyState } from '@/components/shared/EmptyState';
import ExportCsvButton from '@/components/shared/ExportCsvButton';
import ProductsPage from './ProductsPage';
import OrderTemplateManager from '@/features/quotations/components/OrderTemplateManager';
import MediaLibrary from '@/features/communication/components/MediaLibrary';
import MediaUploader from '@/features/communication/components/MediaUploader';

const TABS = [
  { id: 'products', label: 'Produtos' },
  { id: 'sets', label: 'Conjuntos de produtos' },
  { id: 'media', label: 'Mídias', icon: ImageIcon },
] as const;
type CatalogTab = (typeof TABS)[number]['id'];
const parseCatalogTab = parseHashOption<CatalogTab>(TABS.map((tab) => tab.id));
const PRODUCT_SORTS = ['item_name asc', 'modified desc', 'modified asc', 'item_code asc'];
const parseCatalogStatus = parseHashOption(['active', 'archived', 'all']);
const parseCatalogSort = parseHashOption(PRODUCT_SORTS);

interface CatalogPageProps {
  legacy?: boolean;
}

export default function CatalogPage({ legacy = false }: CatalogPageProps) {
  const [activeTab, setActiveTab] = useHashQueryState('tab', 'products', parseCatalogTab);
  const [productSearch] = useHashQueryState('search', '', parseHashString);
  const [productSort] = useHashQueryState('sort', 'modified desc', parseCatalogSort);
  const [productStatus] = useHashQueryState('status', 'active', parseCatalogStatus);
  const [, navigate] = useHashRoute();
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateManagerTarget, setTemplateManagerTarget] = useState<OrderTemplate | null>(null);
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  const [mediaUploadOpen, setMediaUploadOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const result = await listOrderTemplates();
      setTemplates((result.data || []).filter((template) => !template.archived));
    } catch {
      setTemplatesError('Não foi possível carregar os conjuntos de produtos.');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'sets') void loadTemplates();
  }, [activeTab, loadTemplates]);

  const reloadTemplates = useCallback(async () => {
    await loadTemplates();
  }, [loadTemplates]);

  const openTemplateManager = (template: OrderTemplate | null) => {
    setTemplateManagerTarget(template);
    setTemplateManagerOpen(true);
  };

  const closeTemplateManager = () => {
    setTemplateManagerOpen(false);
    setTemplateManagerTarget(null);
  };

  return (
    <PageShell className="space-y-6 pb-28">
      <PageHeader
        title={legacy ? 'Produtos' : 'Catálogo'}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeTab === 'products' && (
              <>
                <ExportCsvButton
                  resource="products"
                  filters={{ search: productSearch, status: productStatus, order_by: productSort }}
                >
                  Exportar produtos
                </ExportCsvButton>
                <ExportCsvButton
                  resource="product-pricing"
                  filters={{ search: productSearch, status: productStatus, order_by: productSort }}
                >
                  Exportar preços
                </ExportCsvButton>
                <Button size="md" onClick={() => navigate('/products/new')}>
                  <PlusCircle /> Novo produto
                </Button>
              </>
            )}
            {activeTab === 'sets' && (
              <Button size="md" onClick={() => openTemplateManager(null)}>
                <PlusCircle /> Novo conjunto
              </Button>
            )}
          </div>
        }
      />

      <div
        role="tablist"
        aria-label="Seções do catálogo"
        className="-mx-1 overflow-x-auto border-b border-line px-1"
      >
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = 'icon' in tab ? tab.icon : null;
            return (
              <button
                key={tab.id}
                id={`catalog-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`catalog-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  const currentIndex = TABS.findIndex((item) => item.id === tab.id);
                  const nextIndex =
                    event.key === 'ArrowRight'
                      ? (currentIndex + 1) % TABS.length
                      : event.key === 'ArrowLeft'
                        ? (currentIndex - 1 + TABS.length) % TABS.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? TABS.length - 1
                            : -1;
                  if (nextIndex < 0) return;
                  event.preventDefault();
                  setActiveTab(TABS[nextIndex].id);
                  window.requestAnimationFrame(() => {
                    document.getElementById(`catalog-tab-${TABS[nextIndex].id}`)?.focus();
                  });
                }}
                className={[
                  'flex min-h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                  isActive
                    ? 'border-primary text-primary-text'
                    : 'border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
                ].join(' ')}
              >
                {Icon && <Icon size={16} aria-hidden="true" />}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`catalog-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`catalog-tab-${activeTab}`}
        tabIndex={0}
        className="min-h-[400px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        {activeTab === 'products' && <ProductsPage showHeader={false} />}

        {activeTab === 'sets' && (
          <section className="space-y-4" aria-labelledby="catalog-sets-title">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 id="catalog-sets-title" className="text-base font-semibold text-fg">
                  Conjuntos de produtos
                </h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Seleções reutilizáveis para montar orçamentos.
                </p>
              </div>
              <span className="text-xs text-fg-muted" aria-live="polite">
                {templatesLoading
                  ? 'Carregando…'
                  : `${templates.length} conjunto${templates.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {templatesLoading && (
              <p
                className="rounded-md border border-line bg-surface px-4 py-10 text-center text-sm text-fg-muted"
                role="status"
              >
                Carregando conjuntos…
              </p>
            )}
            {!templatesLoading && templatesError && (
              <div
                className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-12 text-center"
                role="alert"
              >
                <AlertTriangle size={28} className="text-destructive" aria-hidden="true" />
                <p className="text-sm text-fg">{templatesError}</p>
                <Button variant="outline" onClick={() => void loadTemplates()}>
                  <RefreshCw size={15} /> Tentar novamente
                </Button>
              </div>
            )}
            {!templatesLoading && !templatesError && templates.length === 0 && (
              <EmptyState
                icon={Boxes}
                title="Nenhum conjunto criado"
                description="Crie um conjunto para reutilizar uma seleção de produtos nos orçamentos."
                actions={
                  <Button onClick={() => openTemplateManager(null)}>
                    <PlusCircle /> Novo conjunto
                  </Button>
                }
              />
            )}
            {!templatesLoading && !templatesError && templates.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                  <article
                    key={template.id}
                    className="flex min-h-32 flex-col justify-between rounded-md border border-line bg-surface p-4"
                  >
                    <div>
                      <h3 className="truncate font-medium text-fg" title={template.name}>
                        {template.name}
                      </h3>
                      <p className="mt-2 text-sm text-fg-muted">
                        {template.items.length} produto{template.items.length === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1 break-words font-mono text-xs text-fg-muted">
                        {template.items.map((item) => item.sku).join(' · ')}
                      </p>
                    </div>
                    <Button
                      className="mt-4 self-start"
                      variant="outline"
                      size="sm"
                      onClick={() => openTemplateManager(template)}
                    >
                      Editar conjunto
                    </Button>
                  </article>
                ))}
              </div>
            )}
            <OrderTemplateManager
              open={templateManagerOpen}
              templates={templates}
              initialTemplate={templateManagerTarget}
              onClose={closeTemplateManager}
              onChanged={reloadTemplates}
            />
          </section>
        )}

        {activeTab === 'media' && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
            <MediaLibrary refreshKey={mediaRefreshKey} onAdd={() => setMediaUploadOpen(true)} />
            {mediaUploadOpen && (
              <aside className="space-y-3">
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setMediaUploadOpen(false)}>
                    <X size={15} /> Fechar painel
                  </Button>
                </div>
                <MediaUploader onUploadComplete={() => setMediaRefreshKey((key) => key + 1)} />
              </aside>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
