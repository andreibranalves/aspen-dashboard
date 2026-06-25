// MediaLibrary — grid view of media assets with product group filtering.
// Shows MediaGridItem cards and a delete confirmation flow.

import { useState, useEffect, useCallback } from 'react';
import { Filter } from 'lucide-react';
import { fetchMedia, deleteMedia, PRODUCT_GROUPS, GROUP_LABELS } from '@/lib/communicationApi';
import MediaGridItem from '@/components/communication/MediaGridItem.jsx';
import ConfirmDialog from '@/components/ConfirmDialog.jsx';
import SkeletonComunicacao from '@/components/SkeletonComunicacao.jsx';

export default function MediaLibrary({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMedia({ active: true });
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMedia();
  }, [loadMedia, refreshKey]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMedia(deleteTarget.id);
      setItems((prev) => prev.filter((m) => m.id !== deleteTarget.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleteTarget(null);
    }
  };

  const filtered = filterGroup ? items.filter((m) => m.product_group === filterGroup) : items;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-fg-muted shrink-0" />
        <button
          onClick={() => setFilterGroup('')}
          className={[
            'text-xs px-2.5 py-1 rounded-full transition-colors',
            filterGroup === ''
              ? 'bg-primary text-white'
              : 'bg-surface-muted text-fg-muted hover:bg-surface-muted/80',
          ].join(' ')}
        >
          Todos ({items.length})
        </button>
        {PRODUCT_GROUPS.map((g) => {
          const count = items.filter((m) => m.product_group === g).length;
          if (count === 0) return null;
          return (
            <button
              key={g}
              onClick={() => setFilterGroup(g)}
              className={[
                'text-xs px-2.5 py-1 rounded-full transition-colors',
                filterGroup === g
                  ? 'bg-primary text-white'
                  : 'bg-surface-muted text-fg-muted hover:bg-surface-muted/80',
              ].join(' ')}
            >
              {GROUP_LABELS[g]} ({count})
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && <SkeletonComunicacao />}

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive p-3 rounded-lg bg-destructive/10">{error}</p>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-fg-muted">
          <p className="text-sm">
            {filterGroup
              ? `Nenhuma mídia cadastrada para ${GROUP_LABELS[filterGroup]}.`
              : 'Nenhuma mídia cadastrada. Faça upload de imagens ou vídeos.'}
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((item) => (
            <MediaGridItem key={item.id} item={item} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remover mídia"
        message={`Tem certeza que deseja remover "${deleteTarget?.title || 'esta mídia'}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
