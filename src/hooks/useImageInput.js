// src/hooks/useImageInput.js
// Autocontained hook for image paste, drop, and file selection.
// Extracted from AutoQuotePage.jsx.

import { useState, useRef, useCallback, useEffect } from 'react';

export function useImageInput() {
  const [imageData, setImageData] = useState(null); // { base64, mime }
  const [imagePreview, setImagePreview] = useState(null); // data URL for <img>
  const imageInputRef = useRef(null);

  const handleImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageData({ base64: e.target.result.split(',')[1], mime: file.type });
      setImagePreview(e.target.result);
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
    const onPaste = (e) => {
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
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.add('ring-2', 'ring-primary');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.currentTarget.classList.remove('ring-2', 'ring-primary');
  }, []);

  const handleDrop = useCallback((e) => {
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
