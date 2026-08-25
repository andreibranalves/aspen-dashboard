// MediaLibrary — dense view of media assets with product-group filtering.
// Delete confirmation and the existing media API calls are preserved.

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Filter, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchMedia, deleteMedia, formatProductGroup } from '@/lib/api/communicationApi';
import type { MediaItem, ProductGroup } from '@/lib/api/communicationApi';
import MediaGridItem from '@/features/communication/components/MediaGridItem';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import EmptyState from '@/components/shared/EmptyState';
import { useToast } from '@/components/shared/toast';
import SkeletonComunicacao from '@/features/communication/components/SkeletonComunicacao';

export interface MediaLibraryProps {
  refreshKey?: number | string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function MediaLibrary({ refreshKey }: MediaLibraryProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterGroup, setFilterGroup] = useState<ProductGroup | ''>('');
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMedia({ active: true });
      setItems(data.items || []);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Não foi possível carregar a biblioteca de mídias.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia, refreshKey]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const removedTitle = deleteTarget.title;
    try {
      await deleteMedia(deleteTarget.id);
      setItems((current) => current.filter((item) => item.id !== deleteTarget.id));
      toast(`Mídia “${removedTitle || 'selecionada'}” removida.`, 'success');
    } catch (deleteError) {
      setError(errorMessage(deleteError, 'Não foi possível remover a mídia.'));
    } finally {
      setDeleteTarget(null);
    }
  };

  const filtered = filterGroup ? items.filter((item) => item.product_group === filterGroup) : items;
  const groups = [...new Set(items.map((item) => item.product_group).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR')
  );

  return (
    <section className="space-y-4" aria-labelledby="media-library-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="media-library-title" className="text-base font-semibold text-fg">
            Biblioteca de mídias
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Arquivos disponíveis para etapas de mídia dos fluxos.
          </p>
        </div>
        <span className="text-xs text-fg-muted">
          {items.length} {items.length === 1 ? 'mídia' : 'mídias'}
        </span>
      </div>

      <fieldset className="flex flex-wrap items-center gap-2" disabled={loading}>
        <legend className="sr-only">Filtrar biblioteca por grupo de produto</legend>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Filter size={14} aria-hidden="true" /> Grupo de produto
        </span>
        <button
          type="button"
          aria-pressed={filterGroup === ''}
          onClick={() => setFilterGroup('')}
          className={[
            'min-h-9 rounded-sm border px-3 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
            filterGroup === ''
              ? 'border-primary bg-primary text-on-solid'
              : 'border-line bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
          ].join(' ')}
        >
          Todos ({items.length})
        </button>
        {groups.map((group) => {
          const count = items.filter((item) => item.product_group === group).length;
          return (
            <button
              key={group}
              type="button"
              aria-pressed={filterGroup === group}
              onClick={() => setFilterGroup(group)}
              className={[
                'min-h-9 rounded-sm border px-3 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page',
                filterGroup === group
                  ? 'border-primary bg-primary text-on-solid'
                  : 'border-line bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
              ].join(' ')}
            >
              {formatProductGroup(group)} ({count})
            </button>
          );
        })}
      </fieldset>

      {loading && <SkeletonComunicacao />}

      {!loading && error && (
        <div
          className="flex items-start gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-fg"
          role="alert"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">Não foi possível carregar a biblioteca.</p>
            <p className="mt-1 text-fg-muted">{error}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => void loadMedia()}>
              <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={ImageIcon}
          title={
            filterGroup
              ? `Nenhuma mídia cadastrada para ${formatProductGroup(filterGroup)}.`
              : 'Nenhuma mídia cadastrada.'
          }
          description={
            filterGroup
              ? 'Limpe o filtro para consultar os demais grupos.'
              : 'Use o formulário acima para enviar imagens ou vídeos.'
          }
          actions={
            filterGroup ? (
              <Button variant="outline" onClick={() => setFilterGroup('')}>
                Limpar filtro
              </Button>
            ) : undefined
          }
          className="rounded-md border border-dashed border-line bg-surface py-12"
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          aria-label="Mídias cadastradas"
        >
          {filtered.map((item) => (
            <MediaGridItem key={item.id} item={item} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remover mídia"
        message={`Tem certeza que deseja remover “${deleteTarget?.title || 'esta mídia'}”? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
