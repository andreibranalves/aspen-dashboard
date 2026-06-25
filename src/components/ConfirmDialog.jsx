// src/components/ConfirmDialog.jsx
// Reusable confirmation dialog — replaces window.confirm().
// Uses AlertTriangle icon and PT-BR text by default.

import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ConfirmDialog({
  open,
  title = 'Confirmar ação',
  message = 'Tem certeza que deseja prosseguir?',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'destructive', // 'destructive' | 'default'
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle size={20} className="text-destructive" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-fg">
              {title}
            </h3>
            <p className="mt-2 text-sm text-fg-muted">
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1 text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
