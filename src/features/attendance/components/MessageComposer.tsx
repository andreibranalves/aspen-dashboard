import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import InlineAlert from '@/components/shared/InlineAlert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ApiError } from '@/lib/api/api';
import {
  fetchSendByRequest,
  sendOperatorMessage,
  type AttendanceConversation,
  type SendResult,
} from '@/lib/api/attendanceApi';

export const MAX_REPLY_CHARS = 4_000;

interface PendingSend {
  clientRequestId: string;
  body: string;
  identityVersion: number;
}

interface MessageComposerProps {
  conversation: AttendanceConversation;
  onSent: (result: SendResult) => void;
  /** Text of an earlier reply copied back for an explicit new attempt. */
  prefill: { text: string; token: number } | null;
}

const draftKey = (id: string) => `aspen-attendance-draft:${id}`;
const pendingKey = (id: string) => `aspen-attendance-pending:${id}`;

function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown): void {
  try {
    if (value === null || value === '') window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The composer still works without session storage.
  }
}

function blockedReason(conversation: AttendanceConversation): string | null {
  if (conversation.identityStatus === 'conflict') return 'Envio bloqueado: o telefone desta conversa está em conflito.';
  if (!conversation.phone || conversation.identityStatus === 'unresolved') {
    return 'Envio indisponível: o telefone desta conversa não foi identificado. Responda pelo WhatsApp.';
  }
  return null;
}

export default function MessageComposer({ conversation, onSent, prefill }: MessageComposerProps) {
  const conversationId = conversation.id;
  const [draft, setDraft] = useState(() => readSession<string>(draftKey(conversationId)) || '');
  const [pending, setPending] = useState<PendingSend | null>(() => readSession<PendingSend>(pendingKey(conversationId)));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'destructive'; text: string } | null>(null);
  const currentConversation = useRef(conversationId);
  currentConversation.current = conversationId;
  const blocked = blockedReason(conversation);

  const settle = useCallback(
    (result: SendResult) => {
      writeSession(pendingKey(result.conversationId), null);
      if (currentConversation.current === result.conversationId) setPending(null);
      onSent(result);
    },
    [onSent]
  );

  const submit = useCallback(
    async (intent: PendingSend) => {
      setSending(true);
      setNotice(null);
      try {
        settle(
          await sendOperatorMessage({
            clientRequestId: intent.clientRequestId,
            conversationId,
            expectedIdentityVersion: intent.identityVersion,
            body: intent.body,
          })
        );
      } catch (error) {
        const apiError = error as ApiError;
        if (apiError?.status && apiError.status < 500) {
          // Refused before anything was recorded: give the text back.
          writeSession(pendingKey(conversationId), null);
          setPending(null);
          setDraft((current) => current || intent.body);
          setNotice({ tone: 'destructive', text: apiError.message });
        } else {
          // The outcome is unknown: keep the same key so a retry recovers it.
          setNotice({
            tone: 'warning',
            text: 'Não foi possível confirmar o envio. Verifique antes de tentar de novo.',
          });
        }
      } finally {
        setSending(false);
      }
    },
    [conversationId, settle]
  );

  // A reload with a send in flight first recovers the recorded operation.
  const recover = useCallback(async () => {
    const intent = readSession<PendingSend>(pendingKey(conversationId));
    if (!intent) return;
    setSending(true);
    try {
      settle(await fetchSendByRequest(conversationId, intent.clientRequestId));
      setNotice(null);
    } catch (error) {
      if ((error as ApiError)?.status === 404) {
        // Never recorded: the same key can safely be submitted again.
        await submit(intent);
        return;
      }
      setNotice({ tone: 'warning', text: 'Não foi possível confirmar o envio. Verifique antes de tentar de novo.' });
    } finally {
      setSending(false);
    }
  }, [conversationId, settle, submit]);

  useEffect(() => {
    // Runs once per conversation: the composer is keyed by conversation id.
    if (readSession<PendingSend>(pendingKey(conversationId))) void recover();
  }, [conversationId, recover]);

  const updateDraft = useCallback(
    (value: string) => {
      setDraft(value);
      writeSession(draftKey(conversationId), value);
    },
    [conversationId]
  );

  useEffect(() => {
    if (!prefill) return;
    // Never overwrite what the operator is typing: append instead.
    setDraft((current) => {
      const next = current.trim() ? `${current}\n\n${prefill.text}` : prefill.text;
      writeSession(draftKey(conversationId), next);
      return next;
    });
  }, [prefill, conversationId]);

  const canSend = !blocked && !sending && !pending && draft.trim().length > 0 && draft.length <= MAX_REPLY_CHARS;

  const send = () => {
    if (!canSend) return;
    const intent: PendingSend = {
      clientRequestId: globalThis.crypto.randomUUID(),
      body: draft,
      identityVersion: conversation.identityVersion,
    };
    writeSession(pendingKey(conversationId), intent);
    setPending(intent);
    updateDraft('');
    void submit(intent);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  };

  if (blocked) {
    return <p className="border-t border-border-subtle px-4 py-3 text-xs text-fg-muted">{blocked}</p>;
  }

  return (
    <div className="space-y-2 border-t border-border-subtle p-3">
      {notice && (
        <InlineAlert
          tone={notice.tone}
          action={
            pending && !sending ? (
              <Button variant="outline" size="sm" onClick={() => void recover()}>
                Verificar envio
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </InlineAlert>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escreva uma resposta"
          aria-label="Resposta"
          rows={2}
          className="max-h-48 min-h-[44px] flex-1 resize-y"
        />
        <Button onClick={send} disabled={!canSend} aria-label="Enviar resposta">
          <Send aria-hidden="true" /> Enviar
        </Button>
      </div>
      {draft.length > MAX_REPLY_CHARS && (
        <p className="text-xs text-destructive" role="status">
          {draft.length}/{MAX_REPLY_CHARS} caracteres
        </p>
      )}
    </div>
  );
}
