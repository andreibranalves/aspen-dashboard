import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Toast system ─────────────────────────────────────────────────────────
// Shared, lightweight feedback for mutations. Replaces the per-page ad-hoc
// toasts (some without auto-dismiss) and silent success states.
// Auto-dismisses after 5s; errors stay until dismissed (max 8s).

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-line bg-surface text-fg',
};

const TONE_ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const AUTO_DISMISS_MS: Record<ToastTone, number> = {
  success: 5000,
  info: 5000,
  error: 8000,
};
const ACTION_DISMISS_MS = 8000;

let nextToastId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = 'success', action?: ToastAction) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message, action }]);
    const timer = setTimeout(() => dismiss(id), action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS[tone]);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return createElement(
    ToastContext.Provider,
    { value },
    children,
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[60] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
    >
      {toasts.map((item) => {
        const Icon = TONE_ICONS[item.tone];
        return (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-nav border px-4 py-3.5 text-xs font-medium shadow-floating animate-fade-in',
              TONE_STYLES[item.tone],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(item.id);
                  item.action?.onClick();
                }}
                className="-my-1 shrink-0 rounded-control px-2 py-1 font-semibold underline-offset-2 transition-colors hover:bg-fg/5 hover:underline"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Fechar aviso"
              className="-m-1 rounded-control p-1 transition-colors hover:bg-fg/5"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider.');
  return ctx;
}
