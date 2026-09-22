import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Field — rótulo + controle + mensagem em um contrato único.
 * Conecta automaticamente id, aria-describedby e aria-invalid no controle
 * (Input, Select, Textarea, SearchableSelect…), exceto quando o consumidor
 * já os definiu.
 */
export interface FieldProps {
  label: string;
  /** Controle. Recebe id/aria-* automaticamente quando não definidos. */
  children: ReactElement;
  /** Mensagem de validação inline; tem precedência sobre hint. */
  error?: string | null;
  /** Texto auxiliar exibido quando não há erro. */
  hint?: string;
  required?: boolean;
  className?: string;
}

export function Field({ label, children, error, hint, required, className }: FieldProps) {
  const fallbackId = useId();
  const messageId = `${fallbackId}-message`;
  const message = error || hint;

  let control: ReactNode = children;
  let controlId: string | undefined = fallbackId;
  if (isValidElement(children)) {
    const props = children.props as Record<string, unknown>;
    controlId = (props.id as string | undefined) ?? fallbackId;
    control = cloneElement(children as ReactElement<Record<string, unknown>>, {
      id: controlId,
      'aria-describedby': message
        ? ((props['aria-describedby'] as string | undefined) ?? messageId)
        : props['aria-describedby'],
      'aria-invalid': error ? true : props['aria-invalid'],
    });
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={controlId} className="block text-xs font-medium text-fg-muted">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {control}
      {message && (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-destructive' : 'text-fg-muted')}
        >
          {message}
        </p>
      )}
    </div>
  );
}
