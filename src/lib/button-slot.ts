import { cn } from './utils.ts';

type RefLike = ((value: unknown) => void) | { current: unknown } | null | undefined;

function setRef(ref: RefLike, value: unknown): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref && typeof ref === 'object' && 'current' in ref) {
    ref.current = value;
  }
}

function mergeRefs(first: RefLike, second: RefLike): (value: unknown) => void {
  return (value) => {
    setRef(first, value);
    setRef(second, value);
  };
}

/**
 * Composição do contrato `asChild` do Button: as props do Button não são
 * descartadas — className é mesclado (classes do Button primeiro), handlers
 * `on*` são compostos (Button primeiro, filho depois), demais props do filho
 * prevalecem, e data-variant/ref do Button são preservados no elemento clonado.
 */
export function composeButtonSlotProps(
  buttonProps: Record<string, unknown>,
  childProps: Record<string, unknown>,
  options: { variant: string; classes: string },
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...buttonProps,
  };

  for (const [key, value] of Object.entries(childProps)) {
    const previous = merged[key];
    if (
      key.startsWith('on') &&
      typeof previous === 'function' &&
      typeof value === 'function'
    ) {
      merged[key] = (...args: unknown[]): void => {
        (previous as (...a: unknown[]) => void)(...args);
        (value as (...a: unknown[]) => void)(...args);
      };
    } else {
      merged[key] = value;
    }
  }

  const buttonRef = buttonProps.ref as RefLike;
  const childRef = childProps.ref as RefLike;
  if (buttonRef && childRef && buttonRef !== childRef) {
    merged.ref = mergeRefs(buttonRef, childRef);
  } else if (buttonRef) {
    merged.ref = buttonRef;
  }

  // Preserve the explicit data attribute just like the native Button path;
  // otherwise expose the variant used to build the classes.
  merged['data-variant'] = buttonProps['data-variant'] ?? options.variant;
  merged.className = cn(options.classes, childProps.className as never);
  return merged;
}
