import { type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { MarkdownManager } from '@tiptap/markdown';
import { attachmentIdFromSrc, survivesRoundTrip } from './inlineImages';

export type ImageLabels = { loading: string; missing: string };
type AttachmentImageOptions = {
  resolve: (id: string) => Promise<string>;
  labels: ImageLabels;
};

/**
 * Images are stored as attachment references and only decrypted into blob: URLs for display,
 * so encrypted files never need a public address and other image URLs are never fetched.
 */
export const AttachmentImage = Image.extend<AttachmentImageOptions>({
  addOptions() {
    return {
      ...this.parent!(),
      resolve: () => Promise.reject(new Error('missing resolver')),
      labels: { loading: '', missing: '' },
    };
  },
  addNodeView() {
    const { resolve, labels } = this.options;
    return ({ node }) => {
      const dom = document.createElement('figure');
      dom.className = 'inline-image';
      const img = document.createElement('img');
      img.draggable = false;
      dom.appendChild(img);
      let shown: string | null | undefined;
      const show = (next: typeof node) => {
        img.alt = next.attrs.alt || '';
        const id = attachmentIdFromSrc(next.attrs.src);
        if (id === shown) return;
        shown = id;
        img.removeAttribute('src');
        const state = (value: 'loading' | 'ready' | 'missing') => {
          dom.dataset.state = value;
          dom.dataset.label = value === 'ready' ? '' : labels[value];
        };
        if (!id) return state('missing');
        state('loading');
        resolve(id).then(
          (url) => {
            if (shown !== id) return;
            img.src = url;
            state('ready');
          },
          () => shown === id && state('missing'),
        );
      };
      show(node);
      return {
        dom,
        update: (next) => {
          if (next.type !== node.type) return false;
          show(next);
          return true;
        },
      };
    };
  },
});

/** Everything the note body can contain; shared by the editor and the round-trip check. */
export function contentExtensions(image: AnyExtension = AttachmentImage): AnyExtension[] {
  return [
    StarterKit.configure({
      // Underline has no Markdown form and would be saved as raw HTML.
      underline: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    image,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
  ];
}

let manager: MarkdownManager | null = null;
export function markdownRoundTrip(markdown: string) {
  manager ??= new MarkdownManager({ extensions: contentExtensions() });
  return manager.serialize(manager.parse(markdown));
}

/** Notes with Markdown the rich editor cannot represent open in source mode instead. */
export const richEditable = (markdown: string) => survivesRoundTrip(markdown, markdownRoundTrip);
