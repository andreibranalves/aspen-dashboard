import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FieldControl {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}

/** Liga um controle ao Field que o envolve: id do rótulo, descrição e estado inválido. */
export function useFieldControl<P extends ControlProps>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby':
      [props['aria-describedby'], field.describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
  };
}

interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Nota que o rótulo não comunica: consequência, formato ou bloqueio. */
  hint?: ReactNode;
  error?: ReactNode;
  /** Rótulo só para leitores de tela, em filtros compactos. */
  labelHidden?: boolean;
  /** Id do controle quando ele não é um primitivo de `components/ui`. */
  htmlFor?: string;
  className?: string;
}

/** Field is the label/control/error composition for every form field. */
export function Field({
  label,
  children,
  hint,
  error,
  labelHidden = false,
  htmlFor,
  className,
}: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <label
          htmlFor={id}
          className={cn('text-xs font-medium text-fg-muted', labelHidden && 'sr-only')}
        >
          {label}
        </label>
        {children}
        {hint && (
          <p id={hintId} className="text-2xs text-fg-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
