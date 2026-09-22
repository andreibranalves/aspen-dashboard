import { useEffect, useRef, type MutableRefObject } from 'react';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from '@lexical/list';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import { Bold, Italic, List, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
}

function SynchronizePlugin({
  value,
  lastEditorValue,
  editorVersion,
  container,
}: {
  value: string;
  lastEditorValue: MutableRefObject<string>;
  editorVersion: MutableRefObject<number>;
  container: MutableRefObject<HTMLDivElement | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (value === lastEditorValue.current) return;
    const scheduledVersion = editorVersion.current;
    const synchronize = () => {
      if (editorVersion.current !== scheduledVersion || value === lastEditorValue.current) return;
      lastEditorValue.current = value;
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const document = new DOMParser().parseFromString(value || '<p></p>', 'text/html');
          root.select();
          $insertNodes($generateNodesFromDOM(editor, document));
        },
        { tag: SKIP_DOM_SELECTION_TAG }
      );
    };
    const containerElement = container.current;
    if (!containerElement?.contains(document.activeElement)) {
      synchronize();
      return;
    }
    const synchronizeAfterBlur = (event: FocusEvent) => {
      if (containerElement.contains(event.relatedTarget as Node | null)) return;
      containerElement.removeEventListener('focusout', synchronizeAfterBlur);
      synchronize();
    };
    containerElement.addEventListener('focusout', synchronizeAfterBlur);
    return () => containerElement.removeEventListener('focusout', synchronizeAfterBlur);
  }, [container, editor, editorVersion, lastEditorValue, value]);
  return null;
}

function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(editable), [editable, editor]);
  return null;
}

function Toolbar({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const actions = [
    { label: 'Negrito', icon: Bold, run: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold') },
    { label: 'Itálico', icon: Italic, run: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic') },
    { label: 'Lista com marcadores', icon: List, run: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) },
    { label: 'Lista numerada', icon: ListOrdered, run: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) },
  ];
  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface-muted p-1.5" role="toolbar" aria-label="Formatação de texto">
      {actions.map(({ label, icon: Icon, run }) => (
        <button key={label} type="button" title={label} aria-label={label} disabled={disabled} onClick={run} className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-40">
          <Icon size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function RichTextEditor({ value, onChange, disabled = false, ariaLabel, placeholder = 'Digite o conteúdo…' }: RichTextEditorProps) {
  const lastEditorValue = useRef('');
  const editorVersion = useRef(0);
  const container = useRef<HTMLDivElement | null>(null);
  return (
    <LexicalComposer initialConfig={{ namespace: ariaLabel, nodes: [ListNode, ListItemNode], editable: !disabled, onError: (error) => { throw error; }, theme: { paragraph: 'mb-2 last:mb-0', list: { ul: 'ml-5 list-disc', ol: 'ml-5 list-decimal', listitem: 'my-1' }, text: { bold: 'font-semibold', italic: 'italic' } } }}>
      <div ref={container} className={cn('overflow-hidden rounded-control border border-line bg-surface focus-within:ring-2 focus-within:ring-light-sage', disabled && 'opacity-50')}>
        <Toolbar disabled={disabled} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={ariaLabel} aria-placeholder={placeholder} placeholder={<span className="pointer-events-none absolute left-3 top-3 text-sm text-fg-muted">{placeholder}</span>} className="relative min-h-28 px-3 py-2.5 text-sm leading-6 text-fg outline-none" />}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <SynchronizePlugin value={value} lastEditorValue={lastEditorValue} editorVersion={editorVersion} container={container} />
        <EditablePlugin editable={!disabled} />
        <OnChangePlugin ignoreSelectionChange onChange={(_, editor, tags) => {
          if (tags.has(SKIP_DOM_SELECTION_TAG)) return;
          editor.read(() => {
          const html = $getRoot().getTextContent().trim() ? $generateHtmlFromNodes(editor) : '';
          editorVersion.current += 1;
          lastEditorValue.current = html;
          onChange(html);
          });
        }} />
      </div>
    </LexicalComposer>
  );
}
