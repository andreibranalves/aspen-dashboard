// MediaUploader — file drag-drop + picker for Vercel Blob client upload.
// Uses @vercel/blob/client upload() to send directly to Blob,
// then saves metadata via POST /api/communication-media.

import { useState, useRef, useCallback } from 'react';
import { Upload, Loader2, AlertCircle } from 'lucide-react';
import { upload } from '@vercel/blob/client';
import { createMedia, PRODUCT_GROUPS, GROUP_LABELS } from '@/lib/communicationApi.js';

export default function MediaUploader({ onUploadComplete }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(PRODUCT_GROUPS[0]);
  const fileInputRef = useRef(null);

  const handleFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;
      const file = files[0]; // Upload one at a time

      const isVideo = file.type.startsWith('video/');
      const maxSize = isVideo ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setError(`Arquivo muito grande. Máximo: ${isVideo ? '16 MB' : '5 MB'}.`);
        return;
      }

      setError('');
      setUploading(true);

      try {
        const pathname = `aspen-media/${selectedGroup}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

        const result = await upload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/communication-media-upload',
          clientPayload: JSON.stringify({ product_group: selectedGroup }),
        });

        // Save metadata
        const title = file.name.replace(/\.[^.]+$/, '');
        await createMedia({
          title,
          product_group: selectedGroup,
          kind: isVideo ? 'video' : 'image',
          blob_url: result.url,
          pathname: result.pathname || pathname,
          content_type: file.type,
          size_bytes: file.size,
          caption: '',
        });

        onUploadComplete?.();
      } catch (err) {
        console.error('[MediaUploader]', err);
        setError(err.message || 'Erro no upload. Verifique se o Blob Store está configurado.');
      } finally {
        setUploading(false);
      }
    },
    [selectedGroup, onUploadComplete]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer?.files);
    },
    [handleFiles]
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* Product group selector */}
      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          Grupo de produto
        </label>
        <select
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          className="w-full rounded-[12px] border border-line bg-surface px-3 py-2 text-sm text-fg"
          disabled={uploading}
        >
          {PRODUCT_GROUPS.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={[
          'relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-line hover:border-primary/50 hover:bg-surface-muted',
          uploading ? 'opacity-60 pointer-events-none' : '',
        ].join(' ')}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-sm text-fg-muted">Enviando arquivo...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={28} className="text-fg-muted" />
            <p className="text-sm text-fg-muted">
              Arraste uma imagem ou vídeo aqui, ou clique para selecionar
            </p>
            <p className="text-xs text-fg-muted/60">
              JPEG, PNG, WebP (até 5 MB) · MP4 (até 16 MB)
            </p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-red-700 dark:text-destructive/60">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
