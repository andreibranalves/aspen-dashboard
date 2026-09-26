import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Paperclip, Send } from 'lucide-react';
import InlineAlert from '@/components/shared/InlineAlert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ApiError } from '@/lib/api/api';
import {
  fetchSendByRequest,
  sendOperatorMessage,
  uploadWhatsappAttachment,
  type AttendanceConversation,
  type SendResult,
} from '@/lib/api/attendanceApi';

export const MAX_REPLY_CHARS = 4_000;

interface PendingSend {
  clientRequestId: string;
  body: string;
  identityVersion: number;
  attachmentId?: string | null;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => readSession<string>(draftKey(conversationId)) || '');
  const [pending, setPending] = useState<PendingSend | null>(() => readSession<PendingSend>(pendingKey(conversationId)));
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState<{ id: string; fileName: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'destructive'; text: string } | null>(null);
  const currentConversation = useRef(conversationId);
  currentConversation.current = conversationId;
  const blocked = blockedReason(conversation);

  const settle = useCallback(
    (result: SendResult) => {
      writeSession(pendingKey(result.conversationId), null);
      if (currentConversation.current === result.conversationId) setPending(null);
      if (currentConversation.current === result.conversationId) setAttachment(null);
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
            attachmentId: intent.attachmentId,
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

  // Starts at one line, level with the buttons, and grows with the text up to max-h-48.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [draft]);

  const canSend = !blocked && !sending && !uploading && !pending && (draft.trim().length > 0 || Boolean(attachment)) && draft.length <= MAX_REPLY_CHARS;

  const send = () => {
    if (!canSend) return;
    const intent: PendingSend = {
      clientRequestId: globalThis.crypto.randomUUID(),
      body: draft,
      identityVersion: conversation.identityVersion,
      attachmentId: attachment?.id || null,
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

  const chooseAttachment = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setNotice({ tone: 'destructive', text: 'O anexo deve ter até 3 MB.' });
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      const uploaded = await uploadWhatsappAttachment(conversationId, file);
      if (currentConversation.current === conversationId) setAttachment(uploaded);
    } catch (error) {
      setNotice({ tone: 'destructive', text: error instanceof Error ? error.message : 'Não foi possível guardar o anexo.' });
    } finally {
      setUploading(false);
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
              <Button variant="outline" onClick={() => void recover()}>
                Verificar envio
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </InlineAlert>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => { void chooseAttachment(event.target.files?.[0]); event.target.value = ''; }}
        />
        <Button
          variant="ghost-muted"
          size="icon"
          aria-label="Anexar imagem ou PDF"
          title="Anexar imagem ou PDF"
          disabled={sending || uploading || Boolean(pending)}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden="true" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escreva uma resposta"
          aria-label="Resposta"
          rows={1}
          variant="inline"
          className="max-h-48 min-h-8 flex-1 resize-none"
        />
        <Button onClick={send} disabled={!canSend} aria-label="Enviar resposta">
          <Send aria-hidden="true" /> Enviar
        </Button>
      </div>
      {(uploading || attachment) && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          {uploading && <span>Guardando anexo…</span>}
          {attachment && <>
            <Paperclip size={12} aria-hidden="true" />
            <span className="min-w-0 truncate text-fg">{attachment.fileName}</span>
            <Button variant="ghost" size="xs" onClick={() => setAttachment(null)} disabled={sending || Boolean(pending)}>Remover</Button>
          </>}
        </div>
      )}
      {draft.length > MAX_REPLY_CHARS && (
        <p className="text-xs text-destructive" role="status">
          {draft.length}/{MAX_REPLY_CHARS} caracteres
        </p>
      )}
    </div>
  );
}
