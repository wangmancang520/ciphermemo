import { describe, it, expect } from 'vitest';
import {
  derive,
  newKdf,
  random,
  base64,
  importKey,
  seal,
  open,
  sealBytes,
  openBytes,
  sealChunk,
  openChunk,
  recoveryMaterials,
  validatePassword,
} from '../src/client/crypto';

describe('客户端加密', () => {
  it('相同口令与盐可跨设备得到相同凭证，不同盐产生不同凭证', async () => {
    const kdf = newKdf();
    const a = await derive('a long test passphrase!', kdf);
    const b = await derive('a long test passphrase!', kdf);
    const c = await derive('a long test passphrase!', newKdf());
    expect(a.auth).toBe(b.auth);
    expect(a.auth).not.toBe(c.auth);
    const raw = random();
    expect(
      await openBytes(b.wrapping, await sealBytes(a.wrapping, raw, 'vault-key'), 'vault-key'),
    ).toEqual(raw);
  });
  it('错误密码无法解开数据密钥', async () => {
    const kdf = newKdf();
    const a = await derive('correct test password!', kdf);
    const b = await derive('incorrect test password!', kdf);
    await expect(
      openBytes(b.wrapping, await sealBytes(a.wrapping, random(), 'vault-key'), 'vault-key'),
    ).rejects.toThrow();
  });
  it('正文加密，随机 IV，不同记录不能替换密文', async () => {
    const key = await importKey(random());
    const text = { title: '账户', password: 'secret-value', body: '中文测试' };
    const a = await seal(key, text, 'note:a');
    const b = await seal(key, text, 'note:a');
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toContain('secret-value');
    expect(await open(key, a, 'note:a')).toEqual(text);
    await expect(open(key, a, 'note:b')).rejects.toThrow();
    const damaged = { ...a, data: (a.data[0] === 'A' ? 'B' : 'A') + a.data.slice(1) };
    await expect(open(key, damaged, 'note:a')).rejects.toThrow();
  });
  it('文件分块认证绑定文件和顺序，支持空文件', async () => {
    const key = await importKey(random());
    const data = new TextEncoder().encode('sensitive file');
    const encrypted = await sealChunk(key, data, 'a', 0);
    expect(await openChunk(key, encrypted, 'a', 0)).toEqual(data);
    await expect(openChunk(key, encrypted, 'b', 0)).rejects.toThrow();
    await expect(openChunk(key, encrypted, 'a', 1)).rejects.toThrow();
    expect(
      await openChunk(key, await sealChunk(key, new Uint8Array(), 'a', 2), 'a', 2),
    ).toHaveLength(0);
  });
  it('恢复密钥与密码包装相互独立，可以重新包装同一数据密钥', async () => {
    const raw = random();
    const recovery = await recoveryMaterials(`cmr1-${base64(random())}`);
    const wrapped = await sealBytes(recovery.wrapping, raw, 'recovery-vault-key');
    expect(await openBytes(recovery.wrapping, wrapped, 'recovery-vault-key')).toEqual(raw);
    const newPassword = await derive('another long password!', newKdf());
    const rewrapped = await sealBytes(newPassword.wrapping, raw, 'vault-key');
    expect(await openBytes(newPassword.wrapping, rewrapped, 'vault-key')).toEqual(raw);
    await expect(openBytes(newPassword.wrapping, wrapped, 'recovery-vault-key')).rejects.toThrow();
  });
  it('拒绝短密码与不支持的派生参数', async () => {
    expect(() => validatePassword('short')).toThrow();
    await expect(derive('long password', { ...newKdf(), memory: 1 })).rejects.toThrow();
  });
});
