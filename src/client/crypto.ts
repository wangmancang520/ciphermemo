import { argon2id } from 'hash-wasm';
import type { Envelope, Kdf } from '../shared/types';
const enc = new TextEncoder();
const dec = new TextDecoder();
export const CHUNK_SIZE = 4 * 1024 * 1024;
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unbase64(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('加密数据格式不正确');
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
export function random(size = 32) {
  return crypto.getRandomValues(new Uint8Array(size));
}
export function newKdf(): Kdf {
  return {
    name: 'argon2id',
    salt: base64(random(16)),
    memory: 65536,
    iterations: 3,
    parallelism: 1,
  };
}
export function validatePassword(password: string) {
  if (password.length < 14) throw new Error('请使用至少 14 个字符的长密码或口令');
}
export async function derive(password: string, kdf: Kdf) {
  if (
    kdf.name !== 'argon2id' ||
    kdf.memory !== 65536 ||
    kdf.iterations !== 3 ||
    kdf.parallelism !== 1 ||
    unbase64(kdf.salt).length !== 16
  )
    throw new Error('不支持的密码派生参数');
  const derived = await argon2id({
    password,
    salt: unbase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memory,
    hashLength: 32,
    outputType: 'binary',
  });
  const root = new Uint8Array(derived);
  derived.fill(0);
  const [auth, wrapping] = await Promise.all([hkdf(root, 'login'), hkdf(root, 'password-wrap')]);
  root.fill(0);
  return { auth: base64(auth), wrapping: await importKey(wrapping) };
}
async function hkdf(root: Uint8Array<ArrayBuffer>, purpose: string) {
  const key = await crypto.subtle.importKey('raw', root, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode('ciphermemo-v1'),
        info: enc.encode(purpose),
      },
      key,
      256,
    ),
  );
}
export async function recoveryMaterials(secret: string) {
  const cleaned = secret.trim().replace(/^cmr1-/, '');
  const root = unbase64(cleaned);
  if (root.length !== 32) throw new Error('恢复密钥格式不正确');
  const [auth, wrap] = await Promise.all([
    hkdf(root, 'recovery-login'),
    hkdf(root, 'recovery-wrap'),
  ]);
  root.fill(0);
  return { auth: base64(auth), wrapping: await importKey(wrap) };
}
export async function importKey(bytes: Uint8Array<ArrayBuffer>, extractable = false) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}
export async function sealBytes(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
  context: string,
): Promise<Envelope> {
  const iv = random(12);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`ciphermemo:v1:${context}`) },
    key,
    bytes,
  );
  return { v: 1, iv: base64(iv), data: base64(new Uint8Array(data)) };
}
export async function openBytes(
  key: CryptoKey,
  value: Envelope,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (value.v !== 1 || unbase64(value.iv).length !== 12) throw new Error('不支持的加密格式');
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: unbase64(value.iv),
        additionalData: enc.encode(`ciphermemo:v1:${context}`),
      },
      key,
      unbase64(value.data),
    ),
  );
}
export async function seal(key: CryptoKey, value: unknown, context: string) {
  return sealBytes(key, enc.encode(JSON.stringify(value)), context);
}
export async function open<T>(key: CryptoKey, value: Envelope, context: string): Promise<T> {
  return JSON.parse(dec.decode(await openBytes(key, value, context)));
}
export async function sealChunk(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
  aid: string,
  part: number,
) {
  const iv = random(12);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`ciphermemo:v1:file:${aid}:${part}`) },
    key,
    bytes,
  );
  const result = new Uint8Array(12 + data.byteLength);
  result.set(iv);
  result.set(new Uint8Array(data), 12);
  return result;
}
export async function openChunk(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
  aid: string,
  part: number,
) {
  if (bytes.length < 28) throw new Error('文件分块损坏');
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(0, 12),
        additionalData: enc.encode(`ciphermemo:v1:file:${aid}:${part}`),
      },
      key,
      bytes.slice(12),
    ),
  );
}
