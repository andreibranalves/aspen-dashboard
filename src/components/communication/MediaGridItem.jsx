// MediaGridItem — thumbnail card for a single media asset.
// Shows preview, title, group badge, size, and delete action.

import { useState } from 'react';
import { Trash2, Image, Video } from 'lucide-react';
import { GROUP_LABELS } from '@/lib/communicationApi.js';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaGridItem({ item, onDelete }) {
  const [imgError, setImgError] = useState(false);
  const isVideo = item.kind === 'video';

  return (
    <div className="group relative rounded-xl border border-framer-hairline bg-card overflow-hidden hover:border-primary/30 transition-colors">
      {/* Thumbnail */}
      <div className="aspect-square bg-framer-surface-2 flex items-center justify-center overflow-hidden">
        {isVideo ? (
          <div className="flex flex-col items-center gap-1 text-framer-ink-muted">
            <Video size={32} />
            <span className="text-xs">{item.title || 'Vídeo'}</span>
          </div>
        ) : imgError ? (
          <div className="flex flex-col items-center gap-1 text-framer-ink-muted">
            <Image size={32} />
            <span className="text-xs">Sem preview</span>
          </div>
        ) : (
          <img
            src={item.blob_url}
            alt={item.title || 'Mídia'}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        )}

        {/* Hover overlay with delete */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <button
            onClick={() => onDelete?.(item)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg bg-red-500 text-white hover:bg-red-600"
            title="Remover mídia"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-medium text-framer-ink truncate" title={item.title}>
          {item.title || 'Sem título'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
            {GROUP_LABELS[item.product_group] || item.product_group}
          </span>
          {item.caption && (
            <span
              className="text-[10px] text-framer-ink-muted truncate max-w-[120px]"
              title={item.caption}
            >
              {item.caption}
            </span>
          )}
        </div>
        {item.size_bytes > 0 && (
          <p className="text-[10px] text-framer-ink-muted">
            {formatBytes(item.size_bytes)}
            {item.content_type ? ` · ${item.content_type.split('/')[1]?.toUpperCase()}` : ''}
          </p>
        )}
        {item.active === false && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">Inativo</span>
        )}
      </div>
    </div>
  );
}
