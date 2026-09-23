import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
    if (open) setEmail(initialEmail);
  }, [initialEmail, open]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!sending}
      initialFocusRef={inputRef}
      title="Enviar orçamento por e-mail"
      footer={
        <>
          <Button type="button" variant="outline" disabled={sending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" form="quotation-email-form" disabled={sending}>
            {sending ? 'Enviando…' : 'Enviar e-mail'}
          </Button>
        </>
      }
    >
      <form
        id="quotation-email-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(email);
        }}
      >
        <label className="block text-sm font-medium text-fg" htmlFor="quotation-email-recipient">
          E-mail do destinatário
        </label>
        <Input
          ref={inputRef}
          id="quotation-email-recipient"
          className="mt-1.5"
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
      </form>
    </Dialog>
  );
}
