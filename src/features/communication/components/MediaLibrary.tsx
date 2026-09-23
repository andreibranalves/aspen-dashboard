// MediaLibrary — dense view of media assets with product-group filtering.
// Delete confirmation and the existing media API calls are preserved.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Image as ImageIcon, PlusCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import { fetchMedia, deleteMedia, formatProductGroup } from '@/lib/api/communicationApi';
import type { MediaItem, ProductGroup } from '@/lib/api/communicationApi';
import MediaGridItem from '@/features/communication/components/MediaGridItem';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import EmptyState from '@/components/shared/EmptyState';
import { useToast } from '@/components/shared/toast';
import SkeletonComunicacao from '@/features/communication/components/SkeletonComunicacao';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface MediaLibraryProps {
  refreshKey?: number | string;
  onAdd?: () => void;
}

function errorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

export default function MediaLibrary({ refreshKey, onAdd }: MediaLibraryProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [filterGroup, setFilterGroup] = useState<ProductGroup | ''>('');
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  const deleteInFlightRef = useRef(false);

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
    const target = deleteTarget;
    if (!target || deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeleteTarget(null);
    setMutationError('');
    const removedTitle = target.title;
    try {
      await deleteMedia(target.id);
      setItems((current) => current.filter((item) => item.id !== target.id));
      toast(`Mídia “${removedTitle || 'selecionada'}” removida.`, 'success');
    } catch (deleteError) {
      setMutationError(errorMessage(deleteError, 'Não foi possível remover a mídia.'));
    } finally {
      deleteInFlightRef.current = false;
    }
  };

  const filtered = items.filter((item) =>
    (!filterGroup || item.product_group === filterGroup) &&
    (!query.trim() || `${item.title} ${item.caption || ''}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))
  );
  const groups = [...new Set(items.map((item) => item.product_group).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR')
  );

  return (
    <section className="space-y-4" aria-labelledby="media-library-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="media-library-title" className="text-xs text-fg-muted">Materiais reutilizáveis nas comunicações e propostas.</p>
        {onAdd && <Button onClick={onAdd}><PlusCircle size={15} /> Adicionar mídia</Button>}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-52 max-w-full"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar mídia ou descrição" aria-label="Buscar mídia ou descrição" className="h-10 pl-9 text-xs" /></div>
        {groups.length > 0 && <Select aria-label="Filtrar por grupo de produto" value={filterGroup} onChange={(event) => setFilterGroup(event.target.value as ProductGroup | '')} className="h-10 w-auto text-xs"><option value="">Todos os grupos</option>{groups.map((group) => <option key={group} value={group}>{formatProductGroup(group)}</option>)}</Select>}
      </div>

      {loading && <SkeletonComunicacao />}

      {!loading && error && (
        <InlineAlert title="Não foi possível carregar a biblioteca."
          action={
            <Button variant="outline" size="sm" onClick={() => void loadMedia()}>
              Tentar novamente
            </Button>
          }
        >
          {error}
        </InlineAlert>
      )}

      {!loading && mutationError && (
        <InlineAlert>{mutationError}</InlineAlert>
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
              : query.trim()
                ? 'Ajuste a busca para encontrar outros arquivos.'
              : onAdd
                ? 'Use Adicionar mídia para enviar imagens ou vídeos.'
                : 'Use o formulário acima para enviar imagens ou vídeos.'
          }
          actions={
            filterGroup ? (
              <Button variant="outline" onClick={() => setFilterGroup('')}>
                Limpar filtro
              </Button>
            ) : undefined
          }
          className="rounded-card border border-dashed border-line bg-raised py-12"
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
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
