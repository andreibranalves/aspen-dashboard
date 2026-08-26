// MediaGridItem — dense card for a single media asset.
// The delete action remains available without relying on hover.

import { useState } from 'react';
import { CalendarDays, Image, Trash2, Video } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { formatProductGroup } from '@/lib/api/communicationApi';
import type { MediaItem } from '@/lib/api/communicationApi';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

export interface MediaGridItemProps {
  item: MediaItem;
  onDelete?: (item: MediaItem) => void;
}

export default function MediaGridItem({ item, onDelete }: MediaGridItemProps) {
  const [imgError, setImgError] = useState(false);
  const isVideo = item.kind === 'video';
  const createdDate = formatDate(item.created_at);
  const size = formatBytes(item.size_bytes);

  return (
    <article className="group relative min-w-0 overflow-hidden rounded-md border border-line bg-surface transition-colors hover:border-primary/30">
      <div className="aspect-square overflow-hidden bg-surface-muted">
        {isVideo ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-fg-muted">
            <Video size={30} aria-hidden="true" />
            <span className="text-xs">{item.title || 'Vídeo sem título'}</span>
          </div>
        ) : imgError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-fg-muted">
            <Image size={30} aria-hidden="true" />
            <span className="text-xs">Prévia indisponível</span>
          </div>
        ) : (
          <img
            src={item.blob_url}
            alt={item.title ? `Prévia de ${item.title}` : 'Prévia da mídia'}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        )}
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p
            className="min-w-0 truncate text-sm font-medium text-fg"
            title={item.title || undefined}
          >
            {item.title || 'Sem título'}
          </p>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              aria-label={`Remover ${item.title || 'mídia'}`}
              title="Remover mídia"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className="max-w-full truncate rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            title={formatProductGroup(item.product_group)}
          >
            {formatProductGroup(item.product_group)}
          </span>
          {item.caption && (
            <span className="max-w-full truncate text-[10px] text-fg-muted" title={item.caption}>
              {item.caption}
            </span>
          )}
        </div>

        {(size || item.content_type || createdDate) && (
          <div className="space-y-1 text-[10px] text-fg-muted">
            {(size || item.content_type) && (
              <p>
                {size}
                {size && item.content_type ? ' · ' : ''}
                {item.content_type ? item.content_type.split('/')[1]?.toUpperCase() : ''}
              </p>
            )}
            {createdDate && (
              <p className="inline-flex items-center gap-1">
                <CalendarDays size={12} aria-hidden="true" />
                <time dateTime={item.created_at}>Adicionado em {createdDate}</time>
              </p>
            )}
          </div>
        )}

        {item.active === false && <StatusBadge status="Archived" label="Inativo" />}
      </div>
    </article>
  );
}
