/**
 * Inline images stay ordinary encrypted attachments. The note body (Markdown) only stores a
 * reference at the insertion point: ![name](attachment:<attachment id>).
 */
export const ATTACHMENT_SCHEME = 'attachment:';
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const reference = () => new RegExp(`(!\\[[^\\]]*\\]\\()${ATTACHMENT_SCHEME}(${ID})(?=[\\s)])`, 'g');

export const attachmentSrc = (id: string) => `${ATTACHMENT_SCHEME}${id}`;
export function attachmentIdFromSrc(src: unknown): string | null {
  if (typeof src !== 'string' || !src.startsWith(ATTACHMENT_SCHEME)) return null;
  const id = src.slice(ATTACHMENT_SCHEME.length);
  return new RegExp(`^${ID}$`).test(id) ? id : null;
}

/** Markdown for one inline image; brackets in the file name would end the alt text early. */
export function imageMarkdown(id: string, name: string) {
  return `![${name.replace(/[[\]\\]/g, '')}](${attachmentSrc(id)})`;
}

export function attachmentRefs(body: string): Set<string> {
  return new Set([...body.matchAll(reference())].map((m) => m[2]));
}

/** Backups re-upload files under new ids, so their inline references must follow. */
export function remapAttachmentRefs(body: string, ids: ReadonlyMap<string, string>) {
  return body.replace(reference(), (match, head: string, id: string) =>
    ids.has(id) ? `${head}${attachmentSrc(ids.get(id)!)}` : match,
  );
}

/** List previews show readable text: image markers instead of references, no formatting marks. */
export function previewText(body: string, imageLabel: string) {
  return body
    .replace(new RegExp(`!\\[([^\\]]*)\\]\\(${ATTACHMENT_SCHEME}${ID}\\)`, 'g'), (_, alt) =>
      alt ? `[${imageLabel}: ${alt}]` : `[${imageLabel}]`,
    )
    .replace(/^\s*```.*$/gm, '')
    .replace(/^(\s*)#{1,6}\s+/gm, '$1')
    .replace(/^(\s*)>\s?/gm, '$1')
    .replace(/^(\s*[-*+]\s+)\[[ xX]\]\s+/gm, '$1')
    .replace(/(?<!!)\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '');
}

/**
 * Equivalent Markdown spellings that the rich editor rewrites without changing what is shown:
 * blank lines and spacing, list markers, emphasis markers and table rule lengths.
 */
export function normalizeMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^(\s*)[*+](\s)/gm, '$1-$2')
    .replace(/__(?=\S)([^_]+?)__/g, '**$1**')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]+?)_(?![\w_])/g, '$1*$2*')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, '');
}

/** True when opening and saving in the rich editor would keep the note's meaning. */
export function survivesRoundTrip(markdown: string, roundTrip: (markdown: string) => string) {
  try {
    return normalizeMarkdown(roundTrip(markdown)) === normalizeMarkdown(markdown);
  } catch {
    return false;
  }
}
