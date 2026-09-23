import { Dialog as RadixDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dialog and Drawer are the only modal surfaces in Aspen.
 * Radix owns focus trap, Escape, outside click, stacking, scroll lock and
 * focus restoration; this file owns the Aspen geometry and header/footer rhythm.
 */

interface ModalBaseProps {
  open: boolean;
  /** Called on Escape, overlay click, close button or `DialogClose`. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** While false (e.g. saving), Escape, overlay and the close button do nothing. */
  dismissible?: boolean;
  /** Element focused on open; defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Element focused on close when the opener no longer exists (e.g. a closed menu item). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const overlayClass =
  'fixed inset-0 z-overlay bg-black/60 backdrop-blur-xs motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0';

const FOCUSABLE =
  'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function useModalHandlers({ open, onClose, dismissible = true, initialFocusRef, returnFocusRef }: ModalBaseProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Radix skips focus restoration when a consumer unmounts the whole dialog
  // (`{state && <Dialog open />}`); restore it ourselves when focus fell to body.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const target = returnFocusRef?.current ?? opener;
        if (target && document.contains(target)) target.focus();
      }, 0);
    };
  }, [open, returnFocusRef]);
  return {
    contentRef,
    onOpenChange: (next: boolean) => {
      if (!next && dismissible) onClose();
    },
    contentProps: {
      // Body first, then footer: the header close button is the last resort.
      onOpenAutoFocus: (event: Event) => {
        const content = contentRef.current;
        const target =
          initialFocusRef?.current ??
          content?.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE})`) ??
          content?.querySelector<HTMLElement>(`[data-modal-footer] :is(${FOCUSABLE})`);
        if (!target) return;
        event.preventDefault();
        target.focus();
      },
      onCloseAutoFocus: (event: Event) => {
        if (!returnFocusRef?.current || !document.contains(returnFocusRef.current)) return;
        event.preventDefault();
        returnFocusRef.current.focus();
      },
      onEscapeKeyDown: (event: KeyboardEvent) => {
        if (!dismissible) event.preventDefault();
      },
      onPointerDownOutside: (event: Event) => {
        if (!dismissible) event.preventDefault();
      },
    },
  };
}

function ModalHeader({
  title,
  description,
  icon,
  dismissible = true,
}: Pick<ModalBaseProps, 'title' | 'description' | 'dismissible'> & { icon?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-start gap-4 px-6 pb-4 pt-6">
      {icon}
      <div className="min-w-0 flex-1 pt-1">
        <RadixDialog.Title className="break-words text-lg font-bold leading-6 tracking-tight text-fg">
          {title}
        </RadixDialog.Title>
        {description && (
          <RadixDialog.Description className="mt-1.5 break-words text-sm leading-5 text-fg-muted">
            {description}
          </RadixDialog.Description>
        )}
      </div>
      <RadixDialog.Close
        disabled={!dismissible}
        aria-label="Fechar"
        className="-mr-2 -mt-1 grid size-9 shrink-0 place-items-center rounded-control text-fg-muted transition-colors hover:bg-raised hover:text-fg disabled:opacity-40"
      >
        <X size={20} aria-hidden="true" />
      </RadixDialog.Close>
    </div>
  );
}

function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div data-modal-footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
      {children}
    </div>
  );
}

const dialogSizes = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
} as const;

export interface DialogProps extends ModalBaseProps {
  size?: keyof typeof dialogSizes;
  /** Optional leading visual, e.g. the confirmation tone icon. */
  icon?: ReactNode;
}

export function Dialog(props: DialogProps) {
  const { open, title, description, children, footer, dismissible, size = 'sm', icon, className } = props;
  const { onOpenChange, contentProps, contentRef } = useModalHandlers(props);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          ref={contentRef}
          {...contentProps}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed left-1/2 top-1/2 z-overlay flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border border-line bg-surface text-fg shadow-overlay',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95',
            dialogSizes[size],
            className
          )}
        >
          <ModalHeader title={title} description={description} icon={icon} dismissible={dismissible} />
          {children != null && (
            <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {children}
            </div>
          )}
          {footer && <ModalFooter>{footer}</ModalFooter>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface DrawerProps extends ModalBaseProps {
  /** Content pinned under the header, above the scrolling body. */
  actions?: ReactNode;
}

export function Drawer(props: DrawerProps) {
  const { open, title, description, children, footer, actions, dismissible, className } = props;
  const { onOpenChange, contentProps, contentRef } = useModalHandlers(props);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          ref={contentRef}
          {...contentProps}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-y-3 right-3 z-overlay flex w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface text-fg shadow-overlay lg:max-w-xl',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-right-8 motion-safe:data-[state=open]:fade-in-0',
            className
          )}
        >
          <div className="border-b border-line">
            <ModalHeader title={title} description={description} dismissible={dismissible} />
          </div>
          {actions && <div className="shrink-0 border-b border-line px-6 py-3">{actions}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {children}
          </div>
          {footer && <ModalFooter>{footer}</ModalFooter>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Closes the surrounding Dialog/Drawer, honoring `dismissible`. */
export const DialogClose = RadixDialog.Close;
