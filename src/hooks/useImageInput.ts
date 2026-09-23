// src/hooks/useImageInput.ts
// Handles pasted or dropped images in the automatic quotation composer.

import { useState, useCallback } from 'react';
import type { DragEvent } from 'react';

export interface ImageData {
  base64: string;
  mime: string;
}

export function useImageInput() {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageFile = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result !== 'string') return;
      setImageData({ base64: result.split(',')[1] ?? '', mime: file.type });
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  }, []);

  const clearImage = useCallback(() => {
    setImageData(null);
    setImagePreview(null);
  }, []);

  // Drag handlers
  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add('ring-2', 'ring-primary');
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    e.currentTarget.classList.remove('ring-2', 'ring-primary');
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ring-2', 'ring-primary');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  }, [handleImageFile]);

  return {
    imageData,
    imagePreview,
    clearImage,
    handleImageFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
