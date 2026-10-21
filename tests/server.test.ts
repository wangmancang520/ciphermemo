import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker, { initialize, digest, cleanup } from '../src/server/index';
import {
  random,
  base64,
  importKey,
  seal,
  sealChunk,
  open,
  openChunk,
  newKdf,
  sealBytes,
} from '../src/client/crypto';
import { PROFILE_OWNER_ID, type Envelope } from '../src/shared/types';

let mf: Miniflare;
let env: any;
let cookie = '';
let auth: string;
let recoveryAuth: string;
let wrapped: Envelope;
let key: CryptoKey;
const origin = 'https://vault.test';
const setupToken = 'test-only-setup-token-not-a-real-secret-123';
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  custom: Record<string, string> = {},
  authenticated = true,
) {
  const isBinary = body instanceof Uint8Array;
  const headers: Record<string, string> = {
    ...(method === 'GET' ? {} : { Origin: origin }),
    ...(authenticated && cookie ? { Cookie: cookie } : {}),
    ...(body ? { 'Content-Type': isBinary ? 'application/octet-stream' : 'application/json' } : {}),
    ...custom,
  };
  if (isBinary) headers['Content-Length'] = String(body.length);
  return worker.fetch(
    new Request(origin + '/api' + path, {
      method,
      headers,
      body: body === undefined ? undefined : isBinary ? new Uint8Array(body) : JSON.stringify(body),
    }),
    env,
    {} as ExecutionContext,
  );
}
async function login(trusted = false) {
  const r = await request(
    '/auth/login',
    'POST',
    { username: 'tester', auth, trusted, label: 'Test browser' },
    {},
    false,
  );
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0];
  return r;
}
async function note() {
  const id = crypto.randomUUID();
  const payload = await seal(
    key,
    { title: '私密测试', body: 'do not expose this', kind: 'note', tags: [] },
    `note:${id}`,
  );
  const r = await request('/notes/' + id, 'PUT', { payload, revision: 0 });
  expect(r.status).toBe(200);
  return { id, payload };
}
async function attachment(nid: string) {
  const id = crypto.randomUUID();
  const metadata = await seal(
    key,
    { name: 'secret.txt', type: 'text/plain', size: 4 },
    `attachment:${id}`,
  );
  expect((await request('/attachments', 'POST', { id, noteId: nid, metadata })).status).toBe(200);
  return id;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: '2026-10-21',
      d1Databases: ['DB'],
      r2Buckets: ['FILES'],
    }),
  );
  env = {
    DB: await mf.getD1Database('DB'),
    FILES: await mf.getR2Bucket('FILES'),
    ASSETS: { fetch: () => new Response('app') },
    SETUP_TOKEN: setupToken,
  };
  await initialize(env.DB);
  key = await importKey(random());
  wrapped = await sealBytes(key, random(), 'test');
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await env.DB.batch(
    [
      'profiles',
      'vault',
      'sessions',
      'notes',
      'attachments',
      'chunks',
      'attempts',
      'deletions',
      'maintenance',
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  for (const obj of (await env.FILES.list()).objects) await env.FILES.delete(obj.key);
  auth = base64(random());
  recoveryAuth = base64(random());
  cookie = '';
  const r = await request(
    '/setup',
    'POST',
    {
      username: 'tester',
      setupToken,
      auth,
      kdf: newKdf(),
      wrappedKey: wrapped,
      recoveryAuth,
      recoveryWrappedKey: wrapped,
      label: 'Temporary',
    },
    {},
    false,
  );
  expect(r.status).toBe(200);
  cookie = r.headers.get('set-cookie')!.split(';')[0];
});

describe('鉴权与会话', () => {
  it('线上 HTTP 在提供页面或处理 API 前跳转到同域 HTTPS，保留路径和查询参数', async () => {
    for (const [path, method] of [
      ['/?view=notes', 'GET'],
      ['/api/auth/login?next=notes', 'POST'],
    ]) {
      const response = await worker.fetch(
        new Request('http://memo.example' + path, { method }),
        env,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe('https://memo.example' + path);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });
  it('本机 HTTP 开发地址保持可用，局域网 IP 需要 HTTPS', async () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const response = await worker.fetch(
        new Request(`http://${host}:8787/api/status`),
        env,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(200);
    }
    const response = await worker.fetch(
      new Request('http://192.168.1.2:8787/'),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://192.168.1.2:8787/');
  });
  it('只允许一次初始化，没有注册接口', async () => {
    expect((await request('/setup', 'POST', {})).status).toBe(409);
    expect((await request('/register', 'POST', {})).status).toBe(404);
  });
  it('未登录无法读取内容、设备、容量和文件', async () => {
    for (const path of ['/notes', '/usage', '/devices', '/attachments', '/session', '/profile'])
      expect((await request(path, 'GET', undefined, {}, false)).status).toBe(401);
  });
  it('拒绝跨来源写入，也拒绝缺少来源的写入', async () => {
    expect(
      (
        await request(
          '/auth/login',
          'POST',
          { username: 'tester', auth },
          { Origin: 'https://evil.test' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await request('/auth/login', 'POST', { username: 'tester', auth }, { Origin: '' })).status,
    ).toBe(403);
  });
  it('错误密码与用户名得到相同错误，重复失败会限流', async () => {
    const a = await request('/auth/login', 'POST', { username: 'tester', auth: 'wrong' });
    const b = await request('/auth/login', 'POST', { username: 'wrong', auth });
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    for (let i = 0; i < 14; i++)
      await request('/auth/login', 'POST', { username: 'tester', auth: 'wrong' });
    expect((await login()).status).toBe(429);
  });
  it('可信 Cookie 安全且固定 14 天到期', async () => {
    const r = await login(true);
    const h = r.headers.get('set-cookie')!;
    expect(h).toContain('HttpOnly');
    expect(h).toContain('Secure');
    expect(h).toContain('SameSite=Strict');
    expect(h).toContain('Max-Age=1209600');
    const body = (await r.json()) as any;
    expect(body.device.expires_at - body.device.created_at).toBe(14 * 86400000);
    const first = body.device.expires_at;
    expect(((await (await request('/session')).json()) as any).device.expires_at).toBe(first);
  });
  it('临时会话 30 分钟无操作后失效，可信会话不受短时限制', async () => {
    await env.DB.prepare('UPDATE sessions SET last_seen=?')
      .bind(Date.now() - 31 * 60000)
      .run();
    expect((await request('/session')).status).toBe(401);
    await login(true);
    await env.DB.prepare('UPDATE sessions SET last_seen=?')
      .bind(Date.now() - 31 * 60000)
      .run();
    expect((await request('/session')).status).toBe(200);
  });
  it('到期、退出与远程撤销均阻止后续访问', async () => {
    const info = (await (await request('/session')).json()) as any;
    await request('/devices/' + info.device.id, 'DELETE');
    expect((await request('/notes')).status).toBe(401);
    await login();
    await request('/auth/logout', 'POST');
    expect((await request('/notes')).status).toBe(401);
    await login(true);
    await env.DB.prepare('UPDATE sessions SET expires_at=?')
      .bind(Date.now() - 1)
      .run();
    expect((await request('/notes')).status).toBe(401);
  });
  it('修改密码后所有旧会话立即失效，恢复包装保持不变', async () => {
    const next = base64(random());
    expect(
      (
        await request('/auth/password', 'POST', {
          oldAuth: auth,
          auth: next,
          kdf: newKdf(),
          wrappedKey: wrapped,
        })
      ).status,
    ).toBe(200);
    expect((await request('/session')).status).toBe(401);
    expect((await login()).status).toBe(401);
    auth = next;
    expect((await login()).status).toBe(200);
    const v = await env.DB.prepare('SELECT recovery_hash,recovery_wrapped_key FROM vault').first();
    expect(v.recovery_hash).toBe(await digest(recoveryAuth));
    expect(JSON.parse(v.recovery_wrapped_key)).toEqual(wrapped);
  });
  it('恢复密钥可以重设凭证，旧设备会话失效', async () => {
    const next = base64(random());
    expect(
      (await request('/auth/recovery-key', 'POST', { username: 'tester', recoveryAuth: 'wrong' }))
        .status,
    ).toBe(401);
    expect(
      (
        await request('/auth/recover', 'POST', {
          username: 'tester',
          recoveryAuth,
          auth: next,
          kdf: newKdf(),
          wrappedKey: wrapped,
        })
      ).status,
    ).toBe(200);
    expect((await request('/session')).status).toBe(401);
    auth = next;
    expect((await login()).status).toBe(200);
  });
  it('敏感响应禁止缓存，设置 CSP 与防嵌入保护', async () => {
    const r = await request('/notes');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});
describe('加密条目与文件', () => {
  it('保存密文并检测版本冲突，拒绝覆盖其他设备更新', async () => {
    const n = await note();
    const first = await request('/notes/' + n.id, 'PUT', { payload: n.payload, revision: 1 });
    expect(first.status).toBe(200);
    const second = await request('/notes/' + n.id, 'PUT', { payload: n.payload, revision: 1 });
    expect(second.status).toBe(409);
    const row = await env.DB.prepare('SELECT payload FROM notes WHERE id=?').bind(n.id).first();
    expect(row.payload).not.toContain('do not expose');
  });
  it('回收站可恢复且保留用量，永久删除释放用量', async () => {
    const n = await note();
    const a = (await (await request('/usage')).json()) as any;
    await request('/notes/' + n.id + '/trash', 'POST');
    const b = (await (await request('/usage')).json()) as any;
    expect(b.total).toBe(a.total);
    expect(b.trash).toBe(a.total);
    expect(b.notes).toBe(0);
    await request('/notes/' + n.id + '/restore', 'POST');
    expect(((await (await request('/usage')).json()) as any).notes).toBe(1);
    expect((await request('/notes/' + n.id, 'DELETE')).status).toBe(409);
    await request('/notes/' + n.id + '/trash', 'POST');
    expect((await request('/notes/' + n.id, 'DELETE')).status).toBe(200);
    expect(((await (await request('/usage')).json()) as any).total).toBe(0);
  });
  it('上传分块幂等重试，完整后才能下载，重复分块不增加容量', async () => {
    const n = await note();
    const aid = await attachment(n.id);
    const chunk = await sealChunk(key, new TextEncoder().encode('test'), aid, 0);
    expect((await request(`/attachments/${aid}/complete`, 'POST', { chunks: 1 })).status).toBe(409);
    expect((await request(`/attachments/${aid}/chunks/0`, 'PUT', chunk)).status).toBe(200);
    expect((await request(`/attachments/${aid}/chunks/0`, 'PUT', chunk)).status).toBe(200);
    expect((await request(`/attachments/${aid}/chunks/0`)).status).toBe(404);
    expect((await request(`/attachments/${aid}/complete`, 'POST', { chunks: 1 })).status).toBe(200);
    const r = await request(`/attachments/${aid}/chunks/0`);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(chunk);
    const a = (await (await request('/attachments')).json()) as any[];
    expect(a[0].bytes).toBe(chunk.length);
    expect((await request(`/attachments/${aid}/chunks/0`, 'PUT', chunk)).status).toBe(409);
  });
  it('拒绝不连续分块与内容不一致的重试', async () => {
    const n = await note();
    const aid = await attachment(n.id);
    const chunk = await sealChunk(key, new Uint8Array(4), aid, 1);
    expect((await request(`/attachments/${aid}/chunks/1`, 'PUT', chunk)).status).toBe(200);
    expect((await request(`/attachments/${aid}/complete`, 'POST', { chunks: 1 })).status).toBe(409);
    expect(
      (
        await request(
          `/attachments/${aid}/chunks/1`,
          'PUT',
          await sealChunk(key, new Uint8Array(4), aid, 1),
        )
      ).status,
    ).toBe(409);
  });
  it('永久删除条目同步删除 R2 附件与数据库索引', async () => {
    const n = await note();
    const aid = await attachment(n.id);
    await request(
      `/attachments/${aid}/chunks/0`,
      'PUT',
      await sealChunk(key, new Uint8Array(4), aid, 0),
    );
    await request(`/attachments/${aid}/complete`, 'POST', { chunks: 1 });
    await request('/notes/' + n.id + '/trash', 'POST');
    await request('/notes/' + n.id, 'DELETE');
    expect((await env.FILES.list()).objects).toHaveLength(0);
    expect((await env.DB.prepare('SELECT * FROM chunks').all()).results).toHaveLength(0);
  });
  it('附件重命名保持密文并检测并发更新', async () => {
    const n = await note();
    const aid = await attachment(n.id);
    await request(
      `/attachments/${aid}/chunks/0`,
      'PUT',
      await sealChunk(key, new Uint8Array(4), aid, 0),
    );
    await request(`/attachments/${aid}/complete`, 'POST', { chunks: 1 });
    const a = (await (await request('/attachments')).json()) as any[];
    const metadata = await seal(
      key,
      { name: 'renamed.txt', type: 'text/plain', size: 4 },
      `attachment:${aid}`,
    );
    expect(
      (await request(`/attachments/${aid}`, 'PATCH', { metadata, previous: a[0].metadata })).status,
    ).toBe(200);
    expect(
      (await request(`/attachments/${aid}`, 'PATCH', { metadata, previous: a[0].metadata })).status,
    ).toBe(409);
    const stored = await env.DB.prepare('SELECT metadata FROM attachments WHERE id=?')
      .bind(aid)
      .first();
    expect(stored.metadata).not.toContain('renamed.txt');
  });
  it('正在永久删除的条目不能恢复', async () => {
    const n = await note();
    await request('/notes/' + n.id + '/trash', 'POST');
    await env.DB.prepare('INSERT INTO deletions(note_id) VALUES(?)').bind(n.id).run();
    expect((await request('/notes/' + n.id + '/restore', 'POST')).status).toBe(409);
  });
  it('定时清理过期回收站、未完成上传与过期会话', async () => {
    const n = await note();
    await attachment(n.id);
    await env.DB.prepare('UPDATE notes SET deleted_at=?')
      .bind(Date.now() - 31 * 86400000)
      .run();
    await cleanup(env);
    expect((await env.DB.prepare('SELECT * FROM notes').all()).results).toHaveLength(0);
    expect((await env.DB.prepare('SELECT * FROM attachments').all()).results).toHaveLength(0);
  });
});

describe('个人信息与头像', () => {
  async function saveProfile(nickname: string, avatarId: string | null = null, revision = 0) {
    return request('/profile', 'PUT', {
      payload: await seal(key, { nickname, avatarId }, 'profile'),
      avatarId,
      revision,
    });
  }
  async function avatar() {
    const aid = crypto.randomUUID();
    const plain = new TextEncoder().encode('private avatar image bytes');
    const metadata = await seal(
      key,
      { name: 'avatar.png', type: 'image/png', size: plain.length },
      `attachment:${aid}`,
    );
    expect(
      (await request('/attachments', 'POST', { id: aid, noteId: PROFILE_OWNER_ID, metadata }))
        .status,
    ).toBe(200);
    const encrypted = await sealChunk(key, plain, aid, 0);
    expect((await request(`/attachments/${aid}/chunks/0`, 'PUT', encrypted)).status).toBe(200);
    expect((await request(`/attachments/${aid}/complete`, 'POST', { chunks: 1 })).status).toBe(200);
    return { aid, plain };
  }
  it('昵称加密保存并同步，修改个人信息不更改登录账号或创建备忘录', async () => {
    expect(await (await request('/profile')).json()).toEqual({
      payload: null,
      avatarId: null,
      revision: 0,
    });
    const response = await saveProfile('我的创作空间');
    expect(response.status).toBe(200);
    const stored = (await response.json()) as any;
    expect(stored.revision).toBe(1);
    expect(await open(key, stored.payload, 'profile')).toEqual({
      nickname: '我的创作空间',
      avatarId: null,
    });
    expect(JSON.stringify(await (await request('/profile')).json())).not.toContain('我的创作空间');
    expect(((await (await request('/notes')).json()) as any[]).length).toBe(0);
    expect(((await (await request('/session')).json()) as any).vault.username).toBe('tester');
    expect((await login()).status).toBe(200);
    expect((await saveProfile('新昵称', null, 1)).status).toBe(200);
    expect((await saveProfile('过期修改', null, 1)).status).toBe(409);
    const current = (await (await request('/profile')).json()) as any;
    expect(await open(key, current.payload, 'profile')).toEqual({
      nickname: '新昵称',
      avatarId: null,
    });
  });
  it('头像共用 R2 加密分块、计入空间用量，且不混入备忘录列表', async () => {
    const { aid, plain } = await avatar();
    expect(await (await request('/attachments')).json()).toEqual([]);
    expect((await saveProfile('空间', aid)).status).toBe(200);
    const file = await request(`/attachments/${aid}/chunks/0`);
    expect(await openChunk(key, new Uint8Array(await file.arrayBuffer()), aid, 0)).toEqual(plain);
    const object = await env.FILES.get(`files/${aid}/0`);
    expect(await object.text()).not.toContain('private avatar image bytes');
    const attachments = (await (await request('/attachments')).json()) as any[];
    expect(attachments.map((a) => a.id)).toEqual([aid]);
    const usage = (await (await request('/usage')).json()) as any;
    expect(usage.notes).toBe(0);
    expect(usage.files).toBeGreaterThan(plain.length);
    expect(usage.text).toBeGreaterThan(0);
    expect(usage.attachments).toBe(1);
    expect(
      (await request(`/notes/${PROFILE_OWNER_ID}`, 'PUT', { payload: wrapped, revision: 0 }))
        .status,
    ).toBe(400);
  });
  it('拒绝未登录写入、错误修订、无效头像和普通备忘录附件作为头像', async () => {
    expect(
      (
        await request(
          '/profile',
          'PUT',
          { payload: wrapped, revision: 0, avatarId: null },
          {},
          false,
        )
      ).status,
    ).toBe(401);
    expect(
      (await request('/profile', 'PUT', { payload: wrapped, revision: -1, avatarId: null })).status,
    ).toBe(400);
    expect((await saveProfile('名字', crypto.randomUUID())).status).toBe(400);
    const n = await note();
    const aid = await attachment(n.id);
    expect((await saveProfile('名字', aid)).status).toBe(400);
    expect((await saveProfile('首次')).status).toBe(200);
    expect((await saveProfile('并发初始化')).status).toBe(409);
  });
  it('保护当前头像，更换后可以清理旧图；定时清理不会删除在用头像', async () => {
    const first = await avatar();
    const second = await avatar();
    expect((await saveProfile('名字', first.aid)).status).toBe(200);
    expect((await request(`/attachments/${first.aid}`, 'DELETE')).status).toBe(409);
    await env.DB.prepare('UPDATE attachments SET created_at=? WHERE note_id=?')
      .bind(Date.now() - 2 * 86400000, PROFILE_OWNER_ID)
      .run();
    await cleanup(env);
    expect(await env.FILES.get(`files/${first.aid}/0`)).not.toBeNull();
    expect(await env.FILES.get(`files/${second.aid}/0`)).toBeNull();
    const replacement = await avatar();
    expect((await saveProfile('名字', replacement.aid, 1)).status).toBe(200);
    expect((await request(`/attachments/${first.aid}`, 'DELETE')).status).toBe(200);
    expect(await env.FILES.get(`files/${first.aid}/0`)).toBeNull();
    expect((await saveProfile('名字', null, 2)).status).toBe(200);
    expect((await request(`/attachments/${replacement.aid}`, 'DELETE')).status).toBe(200);
    expect(((await (await request('/usage')).json()) as any).files).toBe(0);
  });
});
