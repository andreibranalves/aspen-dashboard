import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface QuotationEmailDialogProps {
  open: boolean;
  initialEmail: string;
  sending: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (email: string) => Promise<void>;
}

export function QuotationEmailDialog({
  open,
  initialEmail,
  sending,
  error,
  onCancel,
  onSubmit,
}: QuotationEmailDialogProps) {
  const [email, setEmail] = useState(initialEmail);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    globalThis.queueMicrotask(() => inputRef.current?.focus());
  }, [initialEmail, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, open, sending]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar envio por e-mail"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        disabled={sending}
        onClick={onCancel}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="quotation-email-title"
        className="relative w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(email);
        }}
      >
        <h2 id="quotation-email-title" className="text-lg font-semibold text-fg">
          Enviar orçamento por e-mail
        </h2>
        <label
          className="mt-4 block text-sm font-medium text-fg"
          htmlFor="quotation-email-recipient"
        >
          E-mail do destinatário
        </label>
        <Input
          ref={inputRef}
          id="quotation-email-recipient"
          type="email"
          required
          autoComplete="email"
          value={email}
          disabled={sending}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={sending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={sending}>
            {sending ? 'Enviando...' : 'Enviar e-mail'}
          </Button>
        </div>
      </form>
    </div>
  );
}
