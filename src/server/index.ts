import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import schema from '../../migrations/0001_initial.sql';
import type { Envelope, Kdf } from '../shared/types';

type Env = { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher; SETUP_TOKEN: string };
type Vault = {
  id: string;
  username: string;
  auth_hash: string;
  kdf: string;
  wrapped_key: string;
  recovery_hash: string;
  recovery_wrapped_key: string;
  revision: number;
};
type Session = {
  id: string;
  label: string;
  trusted: number;
  created_at: number;
  last_seen: number;
  expires_at: number;
  vault_revision: number;
};
type Bindings = { Bindings: Env; Variables: { session: Session; vault: Vault } };
type C = Context<Bindings>;
const app = new Hono<Bindings>();
const DAY = 86400000;
const TRUST = 14 * DAY;
const IDLE = 30 * 60000;
const encoder = new TextEncoder();
const initialized = new WeakMap<D1Database, Promise<void>>();
export function initialize(db: D1Database) {
  let promise = initialized.get(db);
  if (!promise) {
    promise = db
      .batch(
        schema
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => db.prepare(s)),
      )
      .then(() => {});
    initialized.set(db, promise);
    promise.catch(() => initialized.delete(db));
  }
  return promise;
}
export async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function equal(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function fail(message: string, status: 400 | 401 | 403 | 404 | 409 | 429 = 400): never {
  throw new HTTPException(status, { message });
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail('无效的凭证');
  return value;
}
function id(value: string): string {
  if (!/^[0-9a-f-]{36}$/.test(value)) fail('无效的对象标识');
  return value;
}
function envelope(value: unknown): Envelope {
  const v = value as Envelope;
  if (
    !v ||
    v.v !== 1 ||
    typeof v.iv !== 'string' ||
    !/^[A-Za-z0-9_-]{16}$/.test(v.iv) ||
    typeof v.data !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(v.data) ||
    v.data.length < 22
  )
    fail('无效的加密内容');
  return { v: 1, iv: v.iv, data: v.data };
}
function kdf(value: unknown): Kdf {
  const k = value as Kdf;
  if (
    !k ||
    k.name !== 'argon2id' ||
    k.memory !== 65536 ||
    k.iterations !== 3 ||
    k.parallelism !== 1 ||
    typeof k.salt !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/.test(k.salt)
  )
    fail('无效的密码派生参数');
  return k;
}
function header(v: Vault) {
  return {
    id: v.id,
    username: v.username,
    kdf: JSON.parse(v.kdf),
    wrappedKey: JSON.parse(v.wrapped_key),
    recoveryWrappedKey: JSON.parse(v.recovery_wrapped_key),
    revision: v.revision,
  };
}
function device(s: Session, current = true) {
  return {
    id: s.id,
    label: s.label,
    trusted: s.trusted,
    created_at: s.created_at,
    last_seen: s.last_seen,
    expires_at: s.expires_at,
    current,
  };
}
async function vault(c: C) {
  return c.env.DB.prepare('SELECT * FROM vault WHERE id = ?').bind('personal').first<Vault>();
}
async function limited(c: C, route: string, max = 10) {
  const bucket = await digest(`${route}:${c.req.header('CF-Connecting-IP') || 'local'}`);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `INSERT INTO attempts(bucket,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END RETURNING count`,
  )
    .bind(bucket, now + 15 * 60000, now, now)
    .first<{ count: number }>();
  if (row && row.count > max) fail('尝试次数过多，请 15 分钟后重试', 429);
}
function cookieName(c: C) {
  return new URL(c.req.url).protocol === 'https:' ? '__Host-ciphermemo' : 'ciphermemo-dev';
}
async function issue(c: C, v: Vault, trusted: boolean, label: unknown) {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const now = Date.now();
  const s: Session = {
    id: crypto.randomUUID(),
    label: typeof label === 'string' ? label.slice(0, 120) : '浏览器',
    trusted: trusted ? 1 : 0,
    created_at: now,
    last_seen: now,
    expires_at: now + (trusted ? TRUST : DAY),
    vault_revision: v.revision,
  };
  await c.env.DB.prepare(
    'INSERT INTO sessions(id,token_hash,label,trusted,created_at,last_seen,expires_at,vault_revision) VALUES(?,?,?,?,?,?,?,?)',
  )
    .bind(s.id, await digest(raw), s.label, s.trusted, now, now, s.expires_at, v.revision)
    .run();
  setCookie(c, cookieName(c), raw, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    ...(trusted ? { maxAge: TRUST / 1000 } : {}),
  });
  return c.json({ vault: header(v), device: device(s) });
}
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !local) {
    url.protocol = 'https:';
    return c.redirect(url.toString(), 308);
  }
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  c.header('Cache-Control', 'no-store');
  if (new URL(c.req.url).protocol === 'https:')
    c.header('Strict-Transport-Security', 'max-age=31536000');
  if (c.req.path.startsWith('/api/')) {
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      c.req.header('Origin') !== new URL(c.req.url).origin
    )
      fail('请求来源不受信任', 403);
    await initialize(c.env.DB);
  }
  await next();
});
app.get('/api/status', async (c) =>
  c.json({
    initialized: !!(await vault(c)),
    setupAvailable: !!c.env.SETUP_TOKEN && c.env.SETUP_TOKEN.length >= 32,
  }),
);
app.post('/api/setup', async (c) => {
  await limited(c, 'setup');
  if (await vault(c)) fail('空间已经初始化', 409);
  const b = await c.req.json();
  if (
    !c.env.SETUP_TOKEN ||
    c.env.SETUP_TOKEN.length < 32 ||
    !equal(await digest(String(b.setupToken)), await digest(c.env.SETUP_TOKEN))
  )
    fail('初始化口令不正确', 403);
  if (typeof b.username !== 'string' || !b.username.trim() || b.username.length > 128)
    fail('请填写用户名');
  const now = Date.now();
  const r = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO vault(id,username,auth_hash,kdf,wrapped_key,recovery_hash,recovery_wrapped_key,created_at) VALUES('personal',?,?,?,?,?,?,?)`,
  )
    .bind(
      b.username.trim(),
      await digest(token(b.auth)),
      JSON.stringify(kdf(b.kdf)),
      JSON.stringify(envelope(b.wrappedKey)),
      await digest(token(b.recoveryAuth)),
      JSON.stringify(envelope(b.recoveryWrappedKey)),
      now,
    )
    .run();
  if (!r.meta.changes) fail('空间已经初始化', 409);
  return issue(c, (await vault(c))!, false, b.label);
});
app.get('/api/auth/params', async (c) => {
  const v = await vault(c);
  if (!v) fail('尚未初始化', 404);
  return c.json({ kdf: JSON.parse(v.kdf) });
});
app.post('/api/auth/login', async (c) => {
  await limited(c, 'login', 15);
  const b = await c.req.json();
  const v = await vault(c);
  if (!v || !equal(await digest(String(b.auth)), v.auth_hash) || b.username !== v.username)
    fail('用户名或密码不正确', 401);
  return issue(c, v, b.trusted === true, b.label);
});
app.post('/api/auth/recover', async (c) => {
  await limited(c, 'recovery', 5);
  const b = await c.req.json();
  const v = await vault(c);
  if (
    !v ||
    b.username !== v.username ||
    !equal(await digest(String(b.recoveryAuth)), v.recovery_hash)
  )
    fail('用户名或恢复密钥不正确', 401);
  const r = await c.env.DB.prepare(
    'UPDATE vault SET auth_hash=?,kdf=?,wrapped_key=?,revision=revision+1 WHERE id=? AND revision=?',
  )
    .bind(
      await digest(token(b.auth)),
      JSON.stringify(kdf(b.kdf)),
      JSON.stringify(envelope(b.wrappedKey)),
      v.id,
      v.revision,
    )
    .run();
  if (!r.meta.changes) fail('账号已发生变化，请重试', 409);
  await c.env.DB.prepare('UPDATE sessions SET revoked=1').run();
  return c.json({ ok: true });
});
// Recovery only reveals a ciphertext encrypted by the separate, random recovery key.
app.post('/api/auth/recovery-key', async (c) => {
  await limited(c, 'recovery', 5);
  const b = await c.req.json();
  const v = await vault(c);
  if (
    !v ||
    b.username !== v.username ||
    !equal(await digest(String(b.recoveryAuth)), v.recovery_hash)
  )
    fail('用户名或恢复密钥不正确', 401);
  return c.json({ recoveryWrappedKey: JSON.parse(v.recovery_wrapped_key) });
});
app.use('/api/*', async (c, next) => {
  const raw = getCookie(c, cookieName(c));
  if (!raw) fail('请重新登录', 401);
  const s = await c.env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND revoked=0')
    .bind(await digest(raw))
    .first<Session>();
  const v = await vault(c);
  const now = Date.now();
  if (
    !s ||
    !v ||
    s.vault_revision !== v.revision ||
    s.expires_at <= now ||
    (!s.trusted && s.last_seen + IDLE <= now)
  )
    fail('登录已过期，请重新登录', 401);
  if (now - s.last_seen > 60000)
    await c.env.DB.prepare('UPDATE sessions SET last_seen=? WHERE id=?').bind(now, s.id).run();
  c.set('session', s);
  c.set('vault', v);
  await next();
});
app.get('/api/session', (c) =>
  c.json({ vault: header(c.get('vault')), device: device(c.get('session')) }),
);
app.post('/api/auth/logout', async (c) => {
  await c.env.DB.prepare('UPDATE sessions SET revoked=1 WHERE id=?')
    .bind(c.get('session').id)
    .run();
  deleteCookie(c, cookieName(c), { path: '/', secure: new URL(c.req.url).protocol === 'https:' });
  return c.json({ ok: true });
});
app.get('/api/devices', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM sessions WHERE revoked=0 AND expires_at>? AND vault_revision=? ORDER BY last_seen DESC',
  )
    .bind(Date.now(), c.get('vault').revision)
    .all<Session>();
  return c.json(result.results.map((s) => device(s, s.id === c.get('session').id)));
});
app.delete('/api/devices/:id', async (c) => {
  await c.env.DB.prepare('UPDATE sessions SET revoked=1 WHERE id=?')
    .bind(id(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});
app.post('/api/devices/revoke-all', async (c) => {
  await c.env.DB.prepare('UPDATE sessions SET revoked=1').run();
  return c.json({ ok: true });
});
app.post('/api/auth/password', async (c) => {
  await limited(c, 'password');
  const b = await c.req.json();
  const v = c.get('vault');
  if (!equal(await digest(String(b.oldAuth)), v.auth_hash)) fail('当前密码不正确', 403);
  const r = await c.env.DB.prepare(
    'UPDATE vault SET auth_hash=?,kdf=?,wrapped_key=?,revision=revision+1 WHERE id=? AND revision=?',
  )
    .bind(
      await digest(token(b.auth)),
      JSON.stringify(kdf(b.kdf)),
      JSON.stringify(envelope(b.wrappedKey)),
      v.id,
      v.revision,
    )
    .run();
  if (!r.meta.changes) fail('账号已发生变化，请重试', 409);
  await c.env.DB.prepare('UPDATE sessions SET revoked=1').run();
  return c.json({ ok: true });
});
function noteRow(n: Record<string, unknown>) {
  return { ...n, payload: JSON.parse(n.payload as string) };
}
app.get('/api/notes', async (c) => {
  const before = Number(c.req.query('before') || Number.MAX_SAFE_INTEGER);
  const cursorId = c.req.query('cursorId') || 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const rows = await c.env.DB.prepare(
    'SELECT * FROM notes WHERE updated_at<? OR (updated_at=? AND id<?) ORDER BY updated_at DESC,id DESC LIMIT 100',
  )
    .bind(before, before, cursorId)
    .all<Record<string, unknown>>();
  return c.json(rows.results.map(noteRow));
});
app.put('/api/notes/:id', async (c) => {
  const nid = id(c.req.param('id'));
  const b = await c.req.json();
  const p = JSON.stringify(envelope(b.payload));
  const bytes = encoder.encode(p).length;
  const now = Date.now();
  if (b.revision === 0) {
    const r = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO notes(id,payload,bytes,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
      .bind(nid, p, bytes, b.pinned ? 1 : 0, now, now)
      .run();
    if (!r.meta.changes) fail('内容已存在，请刷新后重试', 409);
  } else {
    const r = await c.env.DB.prepare(
      'UPDATE notes SET payload=?,bytes=?,pinned=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL',
    )
      .bind(p, bytes, b.pinned ? 1 : 0, now, nid, b.revision)
      .run();
    if (!r.meta.changes) fail('其他设备修改了这条内容。你的编辑仍保留，请另存为副本。', 409);
  }
  return c.json(
    noteRow(
      (await c.env.DB.prepare('SELECT * FROM notes WHERE id=?')
        .bind(nid)
        .first<Record<string, unknown>>())!,
    ),
  );
});
app.post('/api/notes/:id/trash', async (c) => {
  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE notes SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NULL',
  )
    .bind(now, now, id(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});
app.post('/api/notes/:id/restore', async (c) => {
  const r = await c.env.DB.prepare(
    'UPDATE notes SET deleted_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deletions WHERE note_id=notes.id)',
  )
    .bind(Date.now(), id(c.req.param('id')))
    .run();
  if (!r.meta.changes) fail('内容不存在或正在永久删除', 409);
  return c.json({ ok: true });
});
async function removeAttachment(env: Env, aid: string) {
  // Mark first: no new download or upload can start after a deletion is scheduled.
  await env.DB.prepare("UPDATE attachments SET status='deleting' WHERE id=?").bind(aid).run();
  let cursor: string | undefined;
  do {
    const list = await env.FILES.list({ prefix: `files/${aid}/`, cursor });
    if (list.objects.length) await env.FILES.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM chunks WHERE attachment_id=?').bind(aid),
    env.DB.prepare('DELETE FROM attachments WHERE id=?').bind(aid),
  ]);
}
async function removeNote(env: Env, nid: string) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO deletions(note_id) SELECT id FROM notes WHERE id=? AND deleted_at IS NOT NULL',
  )
    .bind(nid)
    .run();
  if (!(await env.DB.prepare('SELECT note_id FROM deletions WHERE note_id=?').bind(nid).first()))
    fail('内容已恢复，无法永久删除', 409);
  const rows = await env.DB.prepare('SELECT id FROM attachments WHERE note_id=?')
    .bind(nid)
    .all<{ id: string }>();
  for (const a of rows.results) await removeAttachment(env, a.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM notes WHERE id=? AND deleted_at IS NOT NULL').bind(nid),
    env.DB.prepare('DELETE FROM deletions WHERE note_id=?').bind(nid),
  ]);
}
app.delete('/api/notes/:id', async (c) => {
  const nid = id(c.req.param('id'));
  const n = await c.env.DB.prepare('SELECT id FROM notes WHERE id=? AND deleted_at IS NOT NULL')
    .bind(nid)
    .first();
  if (!n) fail('请先移入回收站', 409);
  await removeNote(c.env, nid);
  return c.json({ ok: true });
});
app.get('/api/usage', async (c) => {
  const n = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN bytes ELSE 0 END),0) AS text,COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN bytes ELSE 0 END),0) AS trash,COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) AS notes FROM notes',
  ).first<{ text: number; trash: number; notes: number }>();
  const a = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN n.deleted_at IS NULL AND a.status='ready' THEN a.bytes+LENGTH(CAST(a.metadata AS BLOB)) ELSE 0 END),0) AS files,COALESCE(SUM(CASE WHEN n.deleted_at IS NOT NULL THEN a.bytes+LENGTH(CAST(a.metadata AS BLOB)) ELSE 0 END),0) AS trash,COUNT(CASE WHEN n.deleted_at IS NULL AND a.status='ready' THEN 1 END) AS attachments,COALESCE(SUM(CASE WHEN n.deleted_at IS NULL AND a.status<>'ready' THEN a.bytes+LENGTH(CAST(a.metadata AS BLOB)) ELSE 0 END),0) AS pending FROM attachments a LEFT JOIN notes n ON n.id=a.note_id",
  ).first<{ files: number; trash: number; attachments: number; pending: number }>();
  const trash = n!.trash + a!.trash;
  return c.json({
    text: n!.text,
    files: a!.files,
    trash,
    pending: a!.pending,
    total: n!.text + a!.files + trash + a!.pending,
    notes: n!.notes,
    attachments: a!.attachments,
  });
});
app.get('/api/attachments', async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM attachments WHERE status='ready'").all<
    Record<string, unknown>
  >();
  return c.json(rows.results.map((a) => ({ ...a, metadata: JSON.parse(a.metadata as string) })));
});
app.post('/api/attachments', async (c) => {
  const b = await c.req.json();
  const aid = id(b.id);
  const nid = id(b.noteId);
  const meta = JSON.stringify(envelope(b.metadata));
  const r = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO attachments(id,note_id,metadata,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL)',
  )
    .bind(aid, nid, meta, Date.now(), nid)
    .run();
  if (!r.meta.changes) fail('附件已存在或备忘录不可用', 409);
  return c.json({ ok: true });
});
app.put('/api/attachments/:id/chunks/:part', async (c) => {
  const aid = id(c.req.param('id'));
  const part = Number(c.req.param('part'));
  if (!Number.isSafeInteger(part) || part < 0) fail('无效分块');
  const a = await c.env.DB.prepare(
    "SELECT a.id FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND a.status='pending' AND n.deleted_at IS NULL",
  )
    .bind(aid)
    .first();
  if (!a) fail('上传不存在或已结束', 409);
  // The protocol uses 4 MiB plaintext chunks. This is a transport bound, not a file-size quota.
  const length = Number(c.req.header('Content-Length'));
  if (!Number.isSafeInteger(length) || length < 28 || length > 4 * 1024 * 1024 + 28)
    fail('无效的传输分块');
  const body = await c.req.arrayBuffer();
  if (body.byteLength !== length) fail('分块长度不匹配');
  // Immutable object per chunk: reusing the same index must never overwrite an in-flight finalization.
  const key = `files/${aid}/${part}`;
  const object = await c.env.FILES.put(key, body, { onlyIf: { etagDoesNotMatch: '*' } });
  if (!object) {
    const old = await c.env.FILES.get(key);
    if (!old || !equal(await digestBytes(body), await digestBytes(await old.arrayBuffer())))
      fail('分块重试内容不一致', 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO chunks(attachment_id,part,bytes) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND a.status='pending' AND n.deleted_at IS NULL)",
    ).bind(aid, part, length, aid),
    c.env.DB.prepare(
      'UPDATE attachments SET bytes=(SELECT COALESCE(SUM(bytes),0) FROM chunks WHERE attachment_id=?) WHERE id=?',
    ).bind(aid, aid),
  ]);
  const accepted = await c.env.DB.prepare(
    "SELECT c.part FROM chunks c JOIN attachments a ON a.id=c.attachment_id WHERE c.attachment_id=? AND c.part=? AND a.status IN ('pending','ready')",
  )
    .bind(aid, part)
    .first();
  if (!accepted) {
    if (object) await c.env.FILES.delete(key);
    fail('上传已取消或结束', 409);
  }
  return c.json({ ok: true });
});
async function digestBytes(value: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
app.post('/api/attachments/:id/complete', async (c) => {
  const aid = id(c.req.param('id'));
  const b = await c.req.json();
  if (!Number.isSafeInteger(b.chunks) || b.chunks < 1) fail('分块数量不正确');
  const r = await c.env.DB.prepare(
    "UPDATE attachments SET status='ready',chunks=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM notes WHERE id=attachments.note_id AND deleted_at IS NULL) AND (SELECT COUNT(*) FROM chunks WHERE attachment_id=?)=? AND (SELECT MIN(part) FROM chunks WHERE attachment_id=?)=0 AND (SELECT MAX(part) FROM chunks WHERE attachment_id=?)=?",
  )
    .bind(b.chunks, aid, aid, b.chunks, aid, aid, b.chunks - 1)
    .run();
  if (!r.meta.changes) fail('上传尚未完整，请重试', 409);
  return c.json({ ok: true });
});
app.get('/api/attachments/:id/chunks/:part', async (c) => {
  const aid = id(c.req.param('id'));
  const part = Number(c.req.param('part'));
  if (!Number.isSafeInteger(part) || part < 0) fail('无效分块');
  const a = await c.env.DB.prepare(
    "SELECT id FROM attachments WHERE id=? AND status='ready' AND chunks>?",
  )
    .bind(aid, part)
    .first();
  if (!a) fail('文件不存在', 404);
  const obj = await c.env.FILES.get(`files/${aid}/${part}`);
  if (!obj) fail('分块不存在', 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
app.patch('/api/attachments/:id', async (c) => {
  const aid = id(c.req.param('id'));
  const b = await c.req.json();
  const metadata = JSON.stringify(envelope(b.metadata));
  const previous = JSON.stringify(envelope(b.previous));
  const r = await c.env.DB.prepare(
    "UPDATE attachments SET metadata=? WHERE id=? AND metadata=? AND status='ready'",
  )
    .bind(metadata, aid, previous)
    .run();
  if (!r.meta.changes) fail('文件已更改或不可用，请刷新后重试', 409);
  return c.json({ ok: true });
});
app.delete('/api/attachments/:id', async (c) => {
  await removeAttachment(c.env, id(c.req.param('id')));
  return c.json({ ok: true });
});
app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: '接口不存在' }, 404)
    : c.env.ASSETS.fetch(c.req.raw),
);
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: '请求格式错误' }, 400);
  return c.json({ error: '操作失败，请稍后重试；内容未确认保存前请保留当前页面。' }, 500);
});
export async function cleanup(env: Env) {
  await initialize(env.DB);
  const now = Date.now();
  const notes = await env.DB.prepare('SELECT id FROM notes WHERE deleted_at<? LIMIT 20')
    .bind(now - 30 * DAY)
    .all<{ id: string }>();
  for (const n of notes.results) await removeNote(env, n.id);
  const old = await env.DB.prepare(
    "SELECT id FROM attachments WHERE status='deleting' OR (status='pending' AND created_at<?) LIMIT 50",
  )
    .bind(now - DAY)
    .all<{ id: string }>();
  for (const a of old.results) await removeAttachment(env, a.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE revoked=1 OR expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM attempts WHERE reset_at<?').bind(now),
  ]);
  // A bounded, resumable sweep catches R2 writes interrupted between storage and D1 confirmation.
  const state = await env.DB.prepare('SELECT value FROM maintenance WHERE key=?')
    .bind('r2-cursor')
    .first<{ value: string }>();
  const page = await env.FILES.list({
    prefix: 'files/',
    limit: 100,
    cursor: state?.value || undefined,
  });
  const aged = page.objects.filter((o) => o.uploaded.getTime() < now - DAY);
  const aids = [...new Set(aged.map((o) => o.key.split('/')[1]))];
  if (aids.length) {
    const chunks = await env.DB.prepare(
      `SELECT attachment_id,part FROM chunks WHERE attachment_id IN (${aids.map(() => '?').join(',')})`,
    )
      .bind(...aids)
      .all<{ attachment_id: string; part: number }>();
    const live = new Set(chunks.results.map((c) => `files/${c.attachment_id}/${c.part}`));
    const orphan = aged.filter((o) => !live.has(o.key)).map((o) => o.key);
    if (orphan.length) await env.FILES.delete(orphan);
  }
  await env.DB.prepare(
    'INSERT INTO maintenance(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  )
    .bind('r2-cursor', page.truncated ? page.cursor : '')
    .run();
}
export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(cleanup(env)),
};
