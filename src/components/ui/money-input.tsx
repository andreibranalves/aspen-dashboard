import { forwardRef, useState, type FocusEvent } from 'react';
import { Input, type InputProps } from '@/components/ui/input';
import { formatDecimalBR, parseDecimalBR } from '@/lib/formatting/formatters';

interface MoneyInputProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> {
  value: number | null;
  onValueChange: (value: number | null) => void;
  fractionDigits?: number;
}

/**
 * MoneyInput shows pt-BR decimals (1.234,56). While focused it keeps what the
 * operator typed; on blur it normalizes to the formatted value.
 */
const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, fractionDigits = 2, onFocus, onBlur, ...props }, ref) => {
    const [draft, setDraft] = useState<string | null>(null);
    const formatted = value === null ? '' : formatDecimalBR(value, fractionDigits);

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? formatted}
        onFocus={(event: FocusEvent<HTMLInputElement>) => {
          setDraft(formatted);
          onFocus?.(event);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onValueChange(parseDecimalBR(event.target.value));
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          setDraft(null);
          onBlur?.(event);
        }}
        {...props}
      />
    );
  }
);
MoneyInput.displayName = 'MoneyInput';

export { MoneyInput };
export type { MoneyInputProps };
