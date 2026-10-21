import { openDB } from 'idb';
import { openBytes, sealBytes, importKey, random } from './crypto';
import type { SessionInfo, Envelope } from '../shared/types';
type Trust = {
  sessionId: string;
  revision: number;
  expires: number;
  deviceKey: CryptoKey;
  wrapped: Envelope;
};
const db = () =>
  openDB('ciphermemo-device', 1, {
    upgrade(db) {
      db.createObjectStore('trust');
    },
  });
export async function forgetDevice() {
  const d = await db();
  await d.delete('trust', 'current');
  d.close();
}
export async function rememberDevice(raw: Uint8Array<ArrayBuffer>, info: SessionInfo) {
  const deviceKey = await importKey(random());
  const wrapped = await sealBytes(deviceKey, raw, `device:${info.device.id}`);
  const entry: Trust = {
    sessionId: info.device.id,
    revision: info.vault.revision,
    expires: info.device.expires_at,
    deviceKey,
    wrapped,
  };
  const d = await db();
  await d.put('trust', entry, 'current');
  d.close();
}
export async function rememberedDevice(info: SessionInfo) {
  const d = await db();
  const entry = (await d.get('trust', 'current')) as Trust | undefined;
  d.close();
  if (!entry) return null;
  if (
    !info.device.trusted ||
    entry.sessionId !== info.device.id ||
    entry.revision !== info.vault.revision ||
    entry.expires <= Date.now()
  ) {
    await forgetDevice();
    return null;
  }
  try {
    return await openBytes(entry.deviceKey, entry.wrapped, `device:${info.device.id}`);
  } catch {
    await forgetDevice();
    return null;
  }
}
