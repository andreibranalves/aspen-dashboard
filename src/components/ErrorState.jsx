// src/components/ErrorState.jsx
// Standardized error state — for failed data loads with retry support.

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

export default function ErrorState({
  message = 'Erro ao carregar dados.',
  detail = '',
  onRetry,
  retryLabel = 'Tentar novamente',
  className,
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle size={36} className="text-destructive/60" />
      </div>
      <h3 className="text-lg font-medium text-destructive">
        {message}
      </h3>
      {detail && (
        <p className="mt-1 max-w-sm text-sm text-fg-muted">
          {detail}
        </p>
      )}
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-4"
        >
          <RefreshCw size={14} className="mr-2" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
