import { useCallback, useEffect, useState } from 'react';
import { Boxes, Image as ImageIcon, Package, PlusCircle, X } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import Skeleton from '@/components/shared/Skeleton';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/shared/ErrorState';
import { TabList, TabPanel, Tabs } from '@/components/ui/tabs';
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
  { value: 'products', label: 'Produtos', icon: Package },
  { value: 'sets', label: 'Conjuntos', icon: Boxes },
  { value: 'media', label: 'Mídias', icon: ImageIcon },
] as const;
type CatalogTab = (typeof TABS)[number]['value'];
const parseCatalogTab = parseHashOption<CatalogTab>(TABS.map((tab) => tab.value));
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
  const [productStatus] = useHashQueryState('status', 'all', parseCatalogStatus);
  const [productCount, setProductCount] = useState(0);
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
    <PageShell className="space-y-4 pb-28">
      <PageHeader
        title={legacy ? 'Produtos' : 'Catálogo'}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabList
            label="Seções do catálogo"
            items={TABS.map((tab) => (tab.value === 'products' ? { ...tab, badge: productCount } : tab))}
          />
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'products' && (
              <>
                <ExportCsvButton resource="products" filters={{ search: productSearch, status: productStatus, order_by: productSort }}>Exportar produtos</ExportCsvButton>
                <ExportCsvButton resource="product-pricing" filters={{ search: productSearch, status: productStatus, order_by: productSort }}>Exportar preços</ExportCsvButton>
                <Button onClick={() => navigate('/products/new')}><PlusCircle /> Novo produto</Button>
              </>
            )}
            {activeTab === 'sets' && <Button onClick={() => openTemplateManager(null)}><PlusCircle /> Novo conjunto</Button>}
          </div>
        </div>

        <TabPanel value="products">
          <ProductsPage showHeader={false} onCountChange={setProductCount} />
        </TabPanel>

        <TabPanel value="sets">
          <section className="space-y-4" aria-labelledby="catalog-sets-title">
            <h2 id="catalog-sets-title" className="sr-only">Conjuntos de produtos</h2>

            {templatesLoading && (
              <div role="status" aria-busy="true" aria-label="Carregando conjuntos" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="min-h-72 rounded-card" />
                ))}
              </div>
            )}
            {!templatesLoading && templatesError && (
              <ErrorState title="Não foi possível carregar os conjuntos" onRetry={() => void loadTemplates()} />
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
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {templates.map((template, index) => (
                  <article
                    key={template.id}
                    className="flex min-h-72 flex-col rounded-card bg-surface p-5 transition-colors hover:bg-surface-hover"
                  >
                    <h3 className="truncate text-sm font-semibold text-fg" title={template.name}>{template.name}</h3>
                    <div className={["mt-5 flex h-24 items-end justify-between rounded-control p-5", ['bg-sage text-sage-ink', 'bg-orange text-orange-ink', 'bg-taupe text-taupe-ink'][index % 3]].join(' ')}>
                      <Boxes size={34} strokeWidth={1.4} aria-hidden="true" />
                      <span className="text-lg font-semibold">{template.items.length} {template.items.length === 1 ? 'item' : 'itens'}</span>
                    </div>
                    <div className="mt-4 flex-1">
                      {template.items.map((item) => <div key={item.sku} className="flex items-center justify-between gap-2 border-b border-line py-3 text-xs"><span className="truncate">{item.name || item.sku}</span><span className="shrink-0 font-mono text-3xs text-fg-muted">{item.sku}</span></div>)}
                    </div>
                    <Button className="mt-4 self-start" variant="outline" size="sm" onClick={() => openTemplateManager(template)}>Editar conjunto</Button>
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
        </TabPanel>

        <TabPanel value="media">
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
        </TabPanel>
      </Tabs>
    </PageShell>
  );
}
