import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

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
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const sendingRef = useRef(sending);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    if (!open) {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = focusableElements(dialog);
        const first = focusable[0];
        const last = focusable.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          event.shiftKey &&
          (active === dialog || active === first || !dialog.contains(active))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!sendingRef.current) onCancelRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [initialEmail, open]);

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quotation-email-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-2xl"
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
