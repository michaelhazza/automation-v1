import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

// ---------------------------------------------------------------------------
// RichTextEditor — Tiptap wrapper used on the Unified Knowledge page for
// Reference notes (spec §7 G6.2). Memory Blocks intentionally keep a plain
// <textarea> — see spec line 1158 ("Only References ship Tiptap editing").
//
// The editor stores content as HTML; the caller persists that HTML in
// workspace_memory_entries.content. Server-side sanitisation lives in the
// update path (sanitizeReferenceHtml) — keeping the wrapper thin.
// ---------------------------------------------------------------------------

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 220, autoFocus = false }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2.5 min-h-[120px]',
        'data-placeholder': placeholder ?? '',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    autofocus: autoFocus,
  });

  // When the caller swaps the underlying reference (opening a different
  // Reference for edit), sync the editor content without creating a new
  // instance on every render.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  return (
    <div
      className="border border-slate-200 rounded-lg bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500"
      style={{ minHeight }}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btnBase =
    'px-2 py-1 text-[12px] font-medium rounded border border-transparent hover:bg-slate-100 cursor-pointer';
  const btnActive = 'bg-indigo-50 text-indigo-700 border-indigo-200';

  const tools: Array<{ key: string; label: string; active: boolean; apply: () => void }> = [
    {
      key: 'bold',
      label: 'Bold',
      active: editor.isActive('bold'),
      apply: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'Italic',
      active: editor.isActive('italic'),
      apply: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: 'h2',
      label: 'H2',
      active: editor.isActive('heading', { level: 2 }),
      apply: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      label: 'H3',
      active: editor.isActive('heading', { level: 3 }),
      apply: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: 'bullet',
      label: '• List',
      active: editor.isActive('bulletList'),
      apply: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      label: '1. List',
      active: editor.isActive('orderedList'),
      apply: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'quote',
      label: 'Quote',
      active: editor.isActive('blockquote'),
      apply: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      key: 'code',
      label: 'Code',
      active: editor.isActive('codeBlock'),
      apply: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
      {tools.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.apply}
          className={`${btnBase} ${t.active ? btnActive : 'text-slate-600'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
