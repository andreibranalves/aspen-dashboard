// src/hooks/useImageInput.ts
// Autocontained hook for image paste, drop, and file selection.
// Extracted from AutoQuotePage.jsx.

import { useState, useRef, useCallback, useEffect } from 'react';
import type { DragEvent } from 'react';

export interface ImageData {
  base64: string;
  mime: string;
}

export function useImageInput() {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

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
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, []);

  // Paste handler
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleImageFile(item.getAsFile());
          return;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handleImageFile]);

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
    imageInputRef,
    clearImage,
    handleImageFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
