import { useEffect, useRef, useState } from 'react';
import InlineAlert from '@/components/shared/InlineAlert';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import {
  fetchAttendanceAiVersion,
  generateAttendanceAi,
  type AttendanceAiAction,
  type AttendanceAiResult,
} from '@/lib/api/atendimentoAiApi';

const ACTIONS: Array<{ id: AttendanceAiAction; label: string }> = [
  { id: 'suggest_reply', label: 'Sugerir resposta' },
  { id: 'identify_missing', label: 'Identificar pendências' },
  { id: 'summarize', label: 'Resumir negociação' },
];

const FIELD_LABELS: Record<string, string> = {
  preco_confirmado: 'Preço a confirmar',
  prazo_confirmado: 'Prazo a confirmar',
};

export default function AiAssistantPanel({ conversationId, onUseSuggestion }: {
  conversationId: string;
  onUseSuggestion: (text: string) => void;
}) {
  const [result, setResult] = useState<AttendanceAiResult | null>(null);
  const [pending, setPending] = useState<AttendanceAiAction | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setResult(null);
    setStale(false);
    setError(null);
    setPending(null);
    return () => { request.current += 1; };
  }, [conversationId]);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    const check = async () => {
      try {
        const current = await fetchAttendanceAiVersion(conversationId);
        if (!cancelled && current.contextVersion !== result.contextVersion) setStale(true);
      } catch {
        // A temporary version read failure is handled when the operator uses the text.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [conversationId, result]);

  const run = async (action: AttendanceAiAction) => {
    const current = ++request.current;
    setPending(action);
    setResult(null);
    setStale(false);
    setError(null);
    try {
      const answer = await generateAttendanceAi(conversationId, action);
      if (current !== request.current || answer.conversationId !== conversationId) return;
      setResult(answer);
    } catch {
      if (current === request.current) setError('Assistência indisponível. Continue o atendimento manualmente.');
    } finally {
      if (current === request.current) setPending(null);
    }
  };

  const useSuggestion = async () => {
    if (!result || result.action !== 'suggest_reply' || !result.text.trim()) return;
    const currentRequest = request.current;
    if (stale) {
      onUseSuggestion(result.text);
      return;
    }
    try {
      const current = await fetchAttendanceAiVersion(conversationId);
      if (currentRequest !== request.current) return;
      if (current.conversationId !== result.conversationId || current.contextVersion !== result.contextVersion) {
        setStale(true);
        return;
      }
      onUseSuggestion(result.text);
    } catch {
      setError('Não foi possível confirmar o contexto. Tente novamente.');
    }
  };

  return (
    <section aria-label="Assistência de IA" className="space-y-2 border-t border-border-subtle pt-3">
      <Heading level="eyebrow">Assistência de IA</Heading>
      <div className="flex flex-wrap gap-1">
        {ACTIONS.map((action) => (
          <Button key={action.id} variant="outline" size="xs" disabled={Boolean(pending)} onClick={() => void run(action.id)}>
            {pending === action.id ? 'Gerando…' : action.label}
          </Button>
        ))}
      </div>
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}
      {result && (
        <div className="space-y-2 rounded-card border border-border-subtle bg-raised p-2">
          {stale && <InlineAlert tone="warning">Contexto atualizado; revise a sugestão antes de inserir.</InlineAlert>}
          {result.text && <p className="whitespace-pre-wrap break-words">{result.text}</p>}
          {result.missingFields.length > 0 && (
            <p className="text-xs text-fg-muted">Pendências: {result.missingFields.map((field) => FIELD_LABELS[field] || field).join(', ')}.</p>
          )}
          {result.warnings.length > 0 && <p className="text-xs text-fg-muted">{result.warnings.join(' ')}</p>}
          {result.action === 'suggest_reply' && result.text.trim() && (
            <Button variant="outline" size="xs" onClick={() => void useSuggestion()}>
              {stale ? 'Inserir após revisar' : 'Usar sugestão'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
