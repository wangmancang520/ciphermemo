import { useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import {
  Bold,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react';
import { t } from './preferences';
import { attachmentSrc } from './inlineImages';
import { AttachmentImage, contentExtensions } from './richSchema';

export type InlineImage = { id: string; name: string };
/** Receives files dropped, pasted or picked; images are uploaded and handed back to `insert`. */
export type FilesHandler = (files: File[], insert: (images: InlineImage[]) => void) => void;

export default function RichEditor({
  value,
  placeholder,
  resolveImage,
  onChange,
  onFiles,
}: {
  value: string;
  placeholder: string;
  resolveImage: (id: string) => Promise<string>;
  onChange: (markdown: string) => void;
  onFiles: FilesHandler;
}) {
  // The editor is created once per note; callbacks read the latest props through refs.
  const latest = useRef({ resolveImage, onChange, onFiles });
  latest.current = { resolveImage, onChange, onFiles };
  const picker = useRef<HTMLInputElement>(null);
  const instance = useRef<Editor | null>(null);
  const insertAt = (editor: Editor, at: number | null) => (images: InlineImage[]) => {
    if (editor.isDestroyed || !images.length) return;
    const pos = Math.min(at ?? editor.state.selection.to, editor.state.doc.content.size);
    editor
      .chain()
      .focus()
      .insertContentAt(
        pos,
        images.map(({ id, name }) => ({
          type: 'image',
          attrs: { src: attachmentSrc(id), alt: name },
        })),
      )
      .run();
  };
  const editor = useEditor({
    extensions: [
      ...contentExtensions(
        AttachmentImage.configure({
          resolve: (id) => latest.current.resolveImage(id),
          labels: { loading: t('正在解密图片…'), missing: t('图片不可用') },
        }),
      ),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
    content: value,
    contentType: 'markdown',
    // The editor keeps an empty paragraph at the end; it is not part of the note.
    onUpdate: ({ editor }) => latest.current.onChange(editor.getMarkdown().replace(/\n+$/, '')),
    editorProps: {
      attributes: { class: 'rich-content', 'aria-label': t('正文'), spellcheck: 'false' },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !instance.current) return false;
        latest.current.onFiles(files, insertAt(instance.current, view.state.selection.to));
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (moved || !files.length || !instance.current) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        latest.current.onFiles(files, insertAt(instance.current, at));
        return true;
      },
    },
  });
  instance.current = editor;
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor.isActive('heading', { level: 2 }),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
    }),
  });
  if (!editor) return null;
  const tools = [
    [
      'heading',
      t('标题'),
      Heading2,
      () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    ],
    ['bold', t('粗体'), Bold, () => editor.chain().focus().toggleBold().run()],
    ['italic', t('斜体'), Italic, () => editor.chain().focus().toggleItalic().run()],
    ['strike', t('删除线'), Strikethrough, () => editor.chain().focus().toggleStrike().run()],
    ['bulletList', t('列表'), List, () => editor.chain().focus().toggleBulletList().run()],
    ['orderedList', t('编号'), ListOrdered, () => editor.chain().focus().toggleOrderedList().run()],
    ['taskList', t('待办'), ListChecks, () => editor.chain().focus().toggleTaskList().run()],
    ['blockquote', t('引用'), Quote, () => editor.chain().focus().toggleBlockquote().run()],
    ['codeBlock', t('代码'), SquareCode, () => editor.chain().focus().toggleCodeBlock().run()],
  ] as const;
  return (
    <div className="rich-editor">
      <div className="format-bar" role="toolbar" aria-label={t('格式')}>
        {tools.map(([key, label, Icon, run]) => (
          <button
            key={key}
            type="button"
            className={`icon-button ${active?.[key] ? 'active' : ''}`}
            aria-label={label}
            aria-pressed={!!active?.[key]}
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className="format-divider" />
        <button
          type="button"
          className="icon-button"
          aria-label={t('插入图片')}
          title={t('插入图片')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => picker.current?.click()}
        >
          <ImagePlus size={16} />
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) latest.current.onFiles(files, insertAt(editor, null));
          }}
        />
      </div>
      <EditorContent
        editor={editor}
        className="rich-surface"
        onMouseDown={(e) => {
          // Clicking the empty space below the text continues writing at the end.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            editor.commands.focus('end');
          }
        }}
      />
    </div>
  );
}
