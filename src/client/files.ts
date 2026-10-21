import { api, post } from './api';
import { CHUNK_SIZE, seal, open, sealChunk, openChunk, base64, unbase64 } from './crypto';
import type { Attachment, AttachmentMeta } from '../shared/types';
export async function uploadFile(
  key: CryptoKey,
  noteId: string,
  file: File,
  progress: (n: number) => void,
) {
  const id = crypto.randomUUID();
  const metadata = await seal(
    key,
    { name: file.name, type: file.type || 'application/octet-stream', size: file.size },
    `attachment:${id}`,
  );
  await post('/attachments', { id, noteId, metadata });
  try {
    const chunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    for (let part = 0; part < chunks; part++) {
      const bytes = new Uint8Array(
        await file.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE).arrayBuffer(),
      );
      const encrypted = await sealChunk(key, bytes, id, part);
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await api(`/attachments/${id}/chunks/${part}`, {
            method: 'PUT',
            body: encrypted,
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          last = null;
          break;
        } catch (e) {
          last = e;
        }
      }
      if (last) throw last;
      progress(Math.round(((part + 1) / chunks) * 100));
    }
    await post(`/attachments/${id}/complete`, { chunks });
    return id;
  } catch (error) {
    await api(`/attachments/${id}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}
export async function encryptedChunk(id: string, part: number) {
  const r = await fetch(`/api/attachments/${id}/chunks/${part}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!r.ok) throw new Error(r.status === 401 ? '登录已过期，请重新登录' : '文件下载失败');
  return new Uint8Array(await r.arrayBuffer());
}
export async function fileBlob(key: CryptoKey, a: Attachment) {
  const meta = await open<AttachmentMeta>(key, a.metadata, `attachment:${a.id}`);
  if (a.chunks !== Math.max(1, Math.ceil(meta.size / CHUNK_SIZE)))
    throw new Error('文件分块数量校验失败');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (let i = 0; i < a.chunks; i++) {
    const part = await openChunk(key, await encryptedChunk(a.id, i), a.id, i);
    parts.push(part);
    total += part.length;
  }
  if (total !== meta.size) throw new Error('文件长度校验失败');
  return { blob: new Blob(parts, { type: meta.type }), meta };
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const fileBackup = { encryptedChunk, base64, unbase64 };
