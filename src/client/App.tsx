import {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  type FormEvent,
} from 'react';
import {
  Plus,
  Search,
  FileText,
  KeyRound,
  Ticket,
  FolderOpen,
  Pin,
  Trash2,
  Settings,
  LogOut,
  ArrowLeft,
  Paperclip,
  Download,
  Eye,
  EyeOff,
  Check,
  Copy,
  X,
  Pencil,
  Monitor,
  Cloud,
  LoaderCircle,
  RotateCcw,
  Upload,
  Menu,
  Lock,
  File,
  CheckCheck,
  Save,
} from 'lucide-react';
import { t, locale, clockTime, usePreferences } from './preferences';
import Preferences from './PreferenceControls';
import Brand, { LogoMark } from './Brand';
import Modal from './Modal';
import MotionPresence from './MotionPresence';
import { useMotionSwitch, prefersReducedMotion } from './motion';
import ProfileEditor, { useAvatar, openProfile, emptyProfile } from './ProfileEditor';
import { PROFILE_OWNER_ID, type ProfileContent, type ProfileRecord } from '../shared/types';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, post, ApiError } from './api';
import * as crypt from './crypto';
import { forgetDevice, rememberDevice, rememberedDevice } from './trust';
import { fileBlob, saveBlob, uploadFile, fileBackup } from './files';
import type {
  Attachment,
  AttachmentMeta,
  Device,
  Kdf,
  NoteContent,
  NoteKind,
  NoteRecord,
  OpenNote,
  SessionInfo,
  Usage,
  VaultHeader,
} from '../shared/types';

type Unlocked = { key: CryptoKey; info: SessionInfo };
type Filter = 'all' | 'pinned' | 'trash' | NoteKind;
const STORAGE_REFERENCE = 5 * 1024 ** 3;
const kinds: Record<NoteKind, { name: string; icon: typeof FileText; color: string }> = {
  note: { name: '备忘录', icon: FileText, color: 'blue' },
  credential: { name: '账号密码', icon: KeyRound, color: 'amber' },
  license: { name: '激活密钥', icon: Ticket, color: 'violet' },
  file: { name: '文件', icon: FolderOpen, color: 'green' },
};
export const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;
const date = (n: number) =>
  new Intl.DateTimeFormat(locale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(n);
const shortDate = (n: number) =>
  new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(n);
const deviceLabel = () =>
  `${/Android|iPhone|iPad/.test(navigator.userAgent) ? '移动设备' : '电脑'} · ${navigator.userAgent.includes('Edg/') ? 'Edge' : navigator.userAgent.includes('Firefox/') ? 'Firefox' : navigator.userAgent.includes('Chrome/') ? 'Chrome' : 'Safari'}`;
const newContent = (kind: NoteKind): NoteContent => ({
  title: '',
  body: '',
  tags: [],
  kind,
  username: '',
  password: '',
  url: '',
  license: '',
});
function message(e: unknown) {
  return e instanceof Error ? e.message : '操作失败，请重试';
}
function Spinner() {
  return <LoaderCircle size={17} className="spin" />;
}
function SecretField({
  label,
  value,
  onChange,
  large = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  large?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 20000);
    return () => clearTimeout(t);
  }, [visible]);
  return (
    <label className="field">
      <span>{t(String(label))}</span>
      <div className={`secret-input ${large ? 'large' : ''}`}>
        <input
          autoComplete="off"
          spellCheck={false}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={visible ? t('隐藏内容') : t('显示内容')}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`${t('复制')} ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setVisible(true);
            }
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
    </label>
  );
}
function Auth({
  initialized,
  setupAvailable,
  onUnlock,
  notice,
  signingOut = false,
}: {
  signingOut?: boolean;
  initialized: boolean;
  setupAvailable: boolean;
  onUnlock: (u: Unlocked, raw: Uint8Array<ArrayBuffer>) => void;
  notice: string;
}) {
  const [mode, setMode] = useState<'login' | 'setup' | 'recover'>(initialized ? 'login' : 'setup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [recovery, setRecovery] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [created, setCreated] = useState<{
    u: Unlocked;
    raw: Uint8Array<ArrayBuffer>;
    recovery: string;
  } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const authCard = useRef<HTMLElement>(null);
  useMotionSwitch(authCard, `${mode}:${!!created}`);
  const cryptoStatus = crypt.cryptoAvailability();
  const cryptoError =
    cryptoStatus === 'insecure'
      ? '请通过 HTTPS 安全连接打开网站后再登录。'
      : cryptoStatus === 'unsupported'
        ? '当前浏览器未提供所需的加密功能，请使用最新版 Chrome、Edge、Firefox 或 Safari 打开。'
        : '';
  const secureUrl = new URL(location.href);
  secureUrl.protocol = 'https:';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signingOut) return;
    setError('');
    setBusy(true);
    try {
      crypt.requireCrypto();
      if (mode === 'login') {
        const { kdf } = await api<{ kdf: Kdf }>('/auth/params');
        const material = await crypt.derive(password, kdf);
        const info = await post<SessionInfo>('/auth/login', {
          username: username.trim(),
          auth: material.auth,
          trusted,
          label: deviceLabel(),
        });
        let raw: Uint8Array<ArrayBuffer>;
        try {
          raw = await crypt.openBytes(material.wrapping, info.vault.wrappedKey, 'vault-key');
        } catch {
          await post('/auth/logout');
          throw new Error('无法解密空间，请使用恢复密钥恢复');
        }
        const key = await crypt.importKey(raw);
        await forgetDevice();
        if (trusted) {
          try {
            await rememberDevice(raw, info);
          } catch {
            await post('/auth/logout');
            raw.fill(0);
            throw new Error('浏览器无法保存可信设备，请取消勾选后登录');
          }
        }
        setPassword('');
        onUnlock({ key, info }, raw);
      } else {
        crypt.validatePassword(password);
        if (password !== confirm) throw new Error('两次输入的密码不一致');
        const kdf = crypt.newKdf();
        const material = await crypt.derive(password, kdf);
        if (mode === 'setup') {
          const raw = crypt.random();
          const recovery = `cmr1-${crypt.base64(crypt.random())}`;
          const r = await crypt.recoveryMaterials(recovery);
          const [wrappedKey, recoveryWrappedKey] = await Promise.all([
            crypt.sealBytes(material.wrapping, raw, 'vault-key'),
            crypt.sealBytes(r.wrapping, raw, 'recovery-vault-key'),
          ]);
          const info = await post<SessionInfo>('/setup', {
            setupToken,
            username: username.trim(),
            auth: material.auth,
            kdf,
            wrappedKey,
            recoveryAuth: r.auth,
            recoveryWrappedKey,
            label: deviceLabel(),
          });
          setCreated({ u: { key: await crypt.importKey(raw), info }, raw, recovery });
          setPassword('');
          setConfirm('');
          setSetupToken('');
        } else {
          const r = await crypt.recoveryMaterials(recovery);
          const { recoveryWrappedKey } = await post<{
            recoveryWrappedKey: VaultHeader['recoveryWrappedKey'];
          }>('/auth/recovery-key', { username: username.trim(), recoveryAuth: r.auth });
          const raw = await crypt.openBytes(r.wrapping, recoveryWrappedKey, 'recovery-vault-key');
          const wrappedKey = await crypt.sealBytes(material.wrapping, raw, 'vault-key');
          raw.fill(0);
          await post('/auth/recover', {
            username: username.trim(),
            recoveryAuth: r.auth,
            auth: material.auth,
            kdf,
            wrappedKey,
          });
          await forgetDevice();
          setRecovery('');
          setPassword('');
          setConfirm('');
          setMode('login');
          setSuccess('密码已重设，所有设备已退出，请使用新密码登录。');
        }
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header>
        <Brand />
        <Preferences />
      </header>
      <main className="auth-layout">
        <section className="auth-card" ref={authCard}>
          {created ? (
            <>
              <h2>{t('保存恢复密钥')}</h2>
              <p className="muted">{t('忘记密码时，只能用它恢复访问。请保存在本空间之外。')}</p>
              <code className="recovery-code">{created.recovery}</code>
              <button
                className="button secondary full"
                onClick={() => {
                  saveBlob(
                    new Blob(
                      [
                        `CipherMemo 恢复密钥\n邮箱：${created.u.info.vault.username}\n地址：${location.origin}\n恢复密钥：${created.recovery}\n请离线安全保存，不要上传到本空间。`,
                      ],
                      { type: 'text/plain;charset=utf-8' },
                    ),
                    'ciphermemo-recovery.txt',
                  );
                  setDownloaded(true);
                }}
              >
                <Download size={17} />
                {t('下载恢复密钥')}
              </button>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={downloaded}
                  onChange={(e) => setDownloaded(e.target.checked)}
                />
                {t('我已保存恢复密钥')}
              </label>
              <button
                className="button primary full"
                disabled={!downloaded}
                onClick={() => onUnlock(created.u, created.raw)}
              >
                {t('进入空间')}
              </button>
            </>
          ) : (
            <>
              <h2>
                {mode === 'setup' ? t('创建空间') : mode === 'recover' ? t('重设密码') : t('登录')}
              </h2>
              {mode === 'recover' && <p className="muted">{t('使用恢复密钥设置新密码。')}</p>}
              {notice && <div className="notice">{t(notice)}</div>}
              {success && <div className="notice">{t(success)}</div>}
              {mode === 'setup' && !setupAvailable && (
                <div className="error">
                  {t(
                    '请在 Cloudflare 中打开此 Worker → Settings → Variables and Secrets，添加名为 SETUP_TOKEN 的 Secret（至少 32 字符），保存并部署后刷新本页。构建变量不能代替运行时 Secret。',
                  )}
                </div>
              )}
              {cryptoError && (
                <div className="error" role="alert">
                  <p>{t(cryptoError)}</p>
                  {cryptoStatus === 'insecure' && (
                    <a className="text-button" href={secureUrl.href}>
                      {t('使用 HTTPS 安全连接')}
                    </a>
                  )}
                </div>
              )}
              <form onSubmit={submit}>
                {mode === 'setup' && (
                  <label className="field">
                    <span>{t('初始化口令')}</span>
                    <input
                      type="password"
                      required
                      autoComplete="off"
                      value={setupToken}
                      onChange={(e) => setSetupToken(e.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  <span>{t('邮箱')}</span>
                  <input
                    required
                    name="email"
                    type={mode === 'setup' ? 'email' : 'text'}
                    inputMode="email"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                {mode === 'recover' && (
                  <label className="field">
                    <span>{t('恢复密钥')}</span>
                    <input
                      required
                      type="password"
                      autoComplete="off"
                      placeholder="cmr1-…"
                      value={recovery}
                      onChange={(e) => setRecovery(e.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  <span>{mode === 'recover' ? t('新密码') : t('密码')}</span>
                  <input
                    required
                    name="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'login' ? undefined : t('至少 14 个字符')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {mode !== 'login' && (
                  <label className="field">
                    <span>{t('确认密码')}</span>
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                )}
                {mode === 'login' && (
                  <>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={trusted}
                        onChange={(e) => setTrusted(e.target.checked)}
                      />
                      {t('信任此设备 14 天')}
                    </label>
                    <p className="field-help">{t('仅在个人设备上勾选。')}</p>
                  </>
                )}
                {error && (
                  <div role="alert" className="error">
                    {t(error)}
                  </div>
                )}
                <button
                  className="button primary full"
                  disabled={
                    busy || signingOut || !!cryptoError || (mode === 'setup' && !setupAvailable)
                  }
                >
                  {busy || signingOut ? (
                    <>
                      <Spinner />
                      {t(signingOut ? '正在退出…' : '处理中…')}
                    </>
                  ) : (
                    t(mode === 'login' ? '登录' : mode === 'recover' ? '重设密码' : '创建空间')
                  )}
                </button>
              </form>
              {initialized && (
                <button
                  className="text-button auth-switch"
                  onClick={() => {
                    setMode(mode === 'login' ? 'recover' : 'login');
                    setError('');
                  }}
                >
                  {mode === 'login' ? t('忘记密码？') : t('返回登录')}
                </button>
              )}
            </>
          )}
        </section>
      </main>
      <footer className="auth-footer">CipherMemo 0.1 · Powered by GPT-6.1 Sol</footer>
    </div>
  );
}

type PendingDraft = { id: string; payload: NoteRecord['payload'] };
type EditorHandle = { flush: () => Promise<void>; capture: () => Promise<PendingDraft | null> };
const Editor = forwardRef<
  EditorHandle,
  {
    note: OpenNote;
    vaultKey: CryptoKey;
    attachments: Attachment[];
    onSaved: (n: OpenNote) => void;
    onFilesChanged: () => Promise<void>;
    onError: (e: unknown) => void;
    onState: (s: string) => void;
    onTrash: () => void;
    onCopy: (content: NoteContent) => void;
  }
>(function Editor(
  { note, vaultKey, attachments, onSaved, onFilesChanged, onError, onState, onTrash, onCopy },
  ref,
) {
  const [draft, setDraft] = useState(note.content);
  const [tagsText, setTagsText] = useState(note.content.tags.join(', '));
  const [preview, setPreview] = useState(false);
  const bodyPanel = useRef<HTMLDivElement>(null);
  useMotionSwitch(bodyPanel, preview);
  const [uploading, setUploading] = useState('');
  const draftRef = useRef(draft);
  const recordRef = useRef(note);
  const savedRef = useRef(JSON.stringify(note.content));
  const task = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState('已保存');
  const [savedAt, setSavedAt] = useState(note.updated_at);
  const [conflict, setConflict] = useState(false);
  const change = (partial: Partial<NoteContent>) => {
    const next = { ...draftRef.current, ...partial };
    draftRef.current = next;
    setDraft(next);
    setState('尚未保存');
    onState('尚未保存');
  };
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (task.current) return task.current;
    const work = async () => {
      while (JSON.stringify(draftRef.current) !== savedRef.current) {
        const snapshot = structuredClone(draftRef.current);
        const stamp = JSON.stringify(snapshot);
        const current = recordRef.current;
        setState('保存中');
        onState('保存中');
        try {
          const payload = await crypt.seal(vaultKey, snapshot, `note:${current.id}`);
          const stored = await api<NoteRecord>(`/notes/${current.id}`, {
            method: 'PUT',
            body: JSON.stringify({ payload, revision: current.revision, pinned: current.pinned }),
          });
          const n = { ...stored, content: snapshot };
          recordRef.current = n;
          savedRef.current = stamp;
          setSavedAt(Date.now());
          onSaved(n);
          setState('已保存');
          onState('已保存');
        } catch (e) {
          setState('保存失败');
          onState('保存失败');
          if (e instanceof ApiError && e.status === 409) setConflict(true);
          throw e;
        }
      }
    };
    task.current = work().finally(() => {
      task.current = null;
    });
    return task.current;
  }, [vaultKey, onSaved, onState]);
  useImperativeHandle(
    ref,
    () => ({
      flush,
      capture: async () =>
        JSON.stringify(draftRef.current) === savedRef.current
          ? null
          : {
              id: note.id,
              payload: await crypt.seal(vaultKey, draftRef.current, `note:${note.id}`),
            },
    }),
    [flush, note.id, vaultKey],
  );
  useEffect(() => {
    if (JSON.stringify(draft) === savedRef.current) return;
    timer.current = setTimeout(() => {
      flush().catch(onError);
    }, 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, flush, onError]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(draftRef.current) !== savedRef.current || task.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function upload(files: FileList | File[] | null) {
    // Copy before the first await: an input's FileList is live and is emptied when its value resets.
    const list = Array.from(files ?? []);
    if (!list.length) return;
    try {
      await flush();
      for (const file of list) {
        setUploading(`${file.name} · 0%`);
        await uploadFile(vaultKey, note.id, file, (p) => setUploading(`${file.name} · ${p}%`));
      }
      await onFilesChanged();
    } catch (e) {
      onError(e);
    } finally {
      setUploading('');
    }
  }
  const KIcon = kinds[draft.kind].icon;
  const content = DOMPurify.sanitize(marked.parse(draft.body, { async: false }) as string, {
    FORBID_TAGS: ['img', 'style', 'input', 'form'],
    FORBID_ATTR: ['style'],
  });
  return (
    <article
      className="editor"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="editor-toolbar">
        <div className={`kind-label ${kinds[draft.kind].color}`}>
          <KIcon size={15} />
          {t(kinds[draft.kind].name)}
        </div>
        <div className="toolbar-actions">
          <div className="segmented" data-preview={preview}>
            <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
              {t('编辑')}
            </button>
            <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
              {t('预览')}
            </button>
          </div>
          <button
            className="icon-button"
            aria-label={recordRef.current.pinned ? t('取消置顶') : t('置顶')}
            onClick={async () => {
              try {
                await flush();
                const current = recordRef.current;
                const stored = await api<NoteRecord>(`/notes/${note.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    payload: current.payload,
                    revision: current.revision,
                    pinned: !current.pinned,
                  }),
                });
                recordRef.current = { ...stored, content: draftRef.current };
                onSaved(recordRef.current);
              } catch (e) {
                onError(e);
              }
            }}
          >
            <Pin size={17} fill={recordRef.current.pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            className="icon-button danger"
            aria-label={t('移入回收站')}
            onClick={async () => {
              try {
                await flush();
                onTrash();
              } catch (e) {
                onError(e);
              }
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      <div className="editor-main">
        <input
          className="title-input"
          aria-label={t('标题')}
          placeholder={t('标题')}
          autoFocus={!note.content.title && !note.content.body}
          value={draft.title}
          onChange={(e) => change({ title: e.target.value })}
        />
        {draft.kind === 'credential' && (
          <div className="credential-fields">
            <label className="field">
              <span>{t('网站地址')}</span>
              <input
                value={draft.url || ''}
                placeholder="https://"
                onChange={(e) => change({ url: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t('用户名 / 邮箱')}</span>
              <div className="secret-input">
                <input
                  value={draft.username || ''}
                  autoComplete="off"
                  onChange={(e) => change({ username: e.target.value })}
                />
                <button
                  className="icon-button"
                  aria-label={t('复制用户名')}
                  onClick={() => navigator.clipboard.writeText(draft.username || '').catch(onError)}
                >
                  <Copy size={17} />
                </button>
              </div>
            </label>
            <SecretField
              label={t('密码')}
              value={draft.password || ''}
              onChange={(password) => change({ password })}
            />
          </div>
        )}
        {draft.kind === 'license' && (
          <div className="credential-fields">
            <SecretField
              label={t('激活密钥')}
              value={draft.license || ''}
              onChange={(license) => change({ license })}
              large
            />
            <label className="field">
              <span>{t('产品网址')}</span>
              <input value={draft.url || ''} onChange={(e) => change({ url: e.target.value })} />
            </label>
          </div>
        )}
        {draft.kind !== 'note' && <div className="body-head">{t('备注')}</div>}
        <div className="editor-body" ref={bodyPanel}>
          {preview ? (
            <div
              className="markdown"
              dangerouslySetInnerHTML={{ __html: content || t('<p>还没有内容。</p>') }}
            />
          ) : (
            <textarea
              className={`body-input ${draft.kind === 'note' ? '' : 'boxed'}`}
              aria-label={t('正文')}
              placeholder={draft.kind === 'note' ? t('正文') : undefined}
              value={draft.body}
              onChange={(e) => change({ body: e.target.value })}
              onPaste={(e) => {
                const fs = Array.from(e.clipboardData.files);
                if (fs.length) {
                  e.preventDefault();
                  void upload(fs);
                }
              }}
            />
          )}
        </div>
        <label className="tags-field">
          <span>{t('标签')}</span>
          <input
            aria-label={t('标签')}
            value={tagsText}
            placeholder={t('用逗号分隔')}
            onChange={(e) => {
              setTagsText(e.target.value);
              change({
                tags: [
                  ...new Set(
                    e.target.value
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ),
                ],
              });
            }}
          />
        </label>
        <div className="attachments-head">
          <span>
            <Paperclip size={15} />
            {t('附件')}
            <small>{attachments.length}</small>
          </span>
          <label className={`text-button upload-button ${uploading ? 'disabled' : ''}`}>
            <Plus size={14} />
            {t('添加文件')}
            <input
              type="file"
              multiple
              disabled={!!uploading}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {uploading && (
          <div role="status" className="upload-progress">
            <Spinner />
            {t('正在上传：')}
            {uploading}
          </div>
        )}
        <div className="attachment-list">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              vaultKey={vaultKey}
              onError={onError}
              onRenamed={onFilesChanged}
              onDelete={async () => {
                await api(`/attachments/${a.id}`, { method: 'DELETE' });
                await onFilesChanged();
              }}
            />
          ))}
        </div>
        {state === '保存失败' && (
          <div className="error">
            <p>{t('保存失败，编辑内容仍在此页面，请勿关闭。')}</p>
            <button className="button secondary" onClick={() => flush().catch(onError)}>
              {t('重试保存')}
            </button>{' '}
            <button className="button secondary" onClick={() => onCopy(draftRef.current)}>
              {conflict ? t('另存为副本') : t('保存副本')}
            </button>
          </div>
        )}
      </div>
      <footer className="editor-footer">
        <div
          className={`save-status ${state === '保存失败' ? 'bad' : ''}`}
          role="status"
          aria-live="polite"
        >
          {state === '保存中' ? (
            <Spinner />
          ) : state === '保存失败' ? (
            <RotateCcw size={14} />
          ) : (
            <Save size={14} />
          )}
          <span>
            {state === '已保存' ? (
              <>
                {t('已保存')}{' '}
                <time dateTime={new Date(savedAt).toISOString()}>{clockTime(savedAt)}</time>
              </>
            ) : (
              t(state)
            )}
          </span>
        </div>
        <span>
          {t('创建于')} {date(note.created_at)}
        </span>
      </footer>
    </article>
  );
});
function AttachmentCard({
  attachment: a,
  vaultKey,
  onError,
  onDelete,
  onRenamed,
}: {
  attachment: Attachment;
  vaultKey: CryptoKey;
  onError: (e: unknown) => void;
  onDelete: () => Promise<void>;
  onRenamed: () => Promise<void>;
}) {
  const [meta, setMeta] = useState<AttachmentMeta | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    crypt
      .open<AttachmentMeta>(vaultKey, a.metadata, `attachment:${a.id}`)
      .then((m) => {
        if (active) setMeta(m);
      })
      .catch(onError);
    return () => {
      active = false;
    };
  }, [a, vaultKey, onError]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <div className={`attachment-card ${url ? 'with-preview' : ''}`}>
      {url && <img src={url} alt={meta?.name || t('图片预览')} />}
      <div className="attachment-info">
        <span className="file-symbol">
          <File size={19} />
        </span>
        <div>
          <strong>{meta?.name || t('正在解密文件名…')}</strong>
          <small>{meta ? bytes(meta.size) : '…'}</small>
        </div>
        <div className="file-actions">
          <button
            aria-label={t('重命名文件')}
            className="icon-button"
            disabled={busy || !meta}
            onClick={() => setRename(meta!.name)}
          >
            <Pencil size={15} />
          </button>
          {meta && /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(meta.type) && !url && (
            <button
              aria-label={t('预览图片')}
              className="icon-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const { blob } = await fileBlob(vaultKey, a);
                  setUrl(URL.createObjectURL(blob));
                } catch (e) {
                  onError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Eye size={16} />
            </button>
          )}
          <button
            aria-label={t('下载文件')}
            className="icon-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { blob, meta } = await fileBlob(vaultKey, a);
                saveBlob(blob, meta.name);
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : <Download size={16} />}
          </button>
          <button
            aria-label={t('删除附件')}
            className="icon-button danger"
            onClick={() => setConfirm(true)}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {rename !== null && (
        <form
          className="rename-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!meta || !rename.trim()) return;
            setBusy(true);
            try {
              const updated = { ...meta, name: rename.trim() };
              const metadata = await crypt.seal(vaultKey, updated, `attachment:${a.id}`);
              await api(`/attachments/${a.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ metadata, previous: a.metadata }),
              });
              setMeta(updated);
              setRename(null);
              await onRenamed();
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label={t('新文件名')}
            required
            value={rename}
            onChange={(e) => setRename(e.target.value)}
          />
          <button type="submit" className="text-button" disabled={busy}>
            {t('保存名称')}
          </button>
          <button type="button" className="text-button" onClick={() => setRename(null)}>
            {t('取消')}
          </button>
        </form>
      )}
      {confirm && (
        <div className="inline-confirm">
          {t('永久删除此附件？')}
          <button
            className="text-button danger"
            onClick={async () => {
              try {
                await onDelete();
              } catch (e) {
                onError(e);
              } finally {
                setConfirm(false);
              }
            }}
          >
            {t('删除')}
          </button>
          <button className="text-button" onClick={() => setConfirm(false)}>
            {t('取消')}
          </button>
        </div>
      )}
    </div>
  );
}

function LockTransition() {
  return (
    <div className="lock-transition" role="status" aria-label={t('空间已锁定。')}>
      <div className="lock-transition-mark">
        <LogoMark size={68} />
        <span>
          <Lock size={16} />
        </span>
      </div>
      <span>{t('空间已锁定。')}</span>
    </div>
  );
}

export default function App() {
  usePreferences();
  const [entering, setEntering] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [lockAnimating, setLockAnimating] = useState(false);
  const lockTask = useRef<Promise<void> | null>(null);
  const noteList = useRef<HTMLDivElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!lockAnimating) return;
    const timer = setTimeout(() => setLockAnimating(false), prefersReducedMotion() ? 0 : 650);
    return () => clearTimeout(timer);
  }, [lockAnimating]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => setEntering(false), 2000);
    return () => clearTimeout(timer);
  }, [entering]);
  const [status, setStatus] = useState<{ initialized: boolean; setupAvailable: boolean } | null>(
    null,
  );
  const [unlocked, setUnlocked] = useState<Unlocked | null>(null);
  const rawKey = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [notes, setNotes] = useState<OpenNote[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  useMotionSwitch(noteList, `${!!unlocked}:${filter}`, 'list');
  useMotionSwitch(detailPanel, `${!!unlocked}:${filter}:${selected ?? 'empty'}`);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'new' | 'settings' | 'usage' | 'trash' | 'profile' | null>(
    null,
  );
  const [profile, setProfile] = useState<{ record: ProfileRecord; content: ProfileContent }>(
    emptyProfile,
  );
  const [profileReady, setProfileReady] = useState(false);
  const [saveState, setSaveState] = useState('已保存');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const pendingDraft = useRef<PendingDraft | null>(null);
  const gate = useRef(0);
  const lastActivity = useRef(Date.now());
  const showError = useCallback((e: unknown) => setError(message(e)), []);
  const updateNote = useCallback((n: OpenNote) => {
    setNotes((old) => old.map((x) => (x.id === n.id ? n : x)));
    setSyncedAt(Date.now());
  }, []);
  const avatar = useAvatar(
    unlocked?.key ?? null,
    attachments.find((a) => a.id === profile.content.avatarId) ?? null,
    showError,
  );
  const load = useCallback(
    async (u: Unlocked) => {
      const run = ++gate.current;
      setBusy(true);
      try {
        const rows: NoteRecord[] = [];
        let before = '',
          cursorId = '';
        while (true) {
          const page = await api<NoteRecord[]>(
            `/notes${before ? `?before=${before}&cursorId=${cursorId}` : ''}`,
          );
          rows.push(...page);
          if (page.length < 100) break;
          const last = page[page.length - 1];
          before = String(last.updated_at);
          cursorId = last.id;
        }
        const opened: OpenNote[] = [];
        for (const n of rows)
          opened.push({
            ...n,
            content: await crypt.open<NoteContent>(u.key, n.payload, `note:${n.id}`),
          });
        const [files, space, profileRecord] = await Promise.all([
          api<Attachment[]>('/attachments'),
          api<Usage>('/usage'),
          api<ProfileRecord>('/profile'),
        ]);
        const profileContent = await openProfile(u.key, profileRecord);
        if (gate.current !== run) return;
        setProfile({ record: profileRecord, content: profileContent });
        setProfileReady(true);
        setNotes(opened);
        setAttachments(files);
        setUsage(space);
        setSyncedAt(Date.now());
        setSyncFailed(false);
      } catch (e) {
        if (gate.current === run) {
          setSyncFailed(true);
          showError(e);
        }
      } finally {
        if (gate.current === run) setBusy(false);
      }
    },
    [showError],
  );
  const refreshFiles = useCallback(async () => {
    const run = gate.current;
    const [files, space] = await Promise.all([
      api<Attachment[]>('/attachments'),
      api<Usage>('/usage'),
    ]);
    if (gate.current === run) {
      setAttachments(files);
      setUsage(space);
    }
  }, []);
  function clearMemory() {
    gate.current++;
    rawKey.current?.fill(0);
    rawKey.current = null;
    setUnlocked(null);
    setEntering(false);
    setSyncedAt(null);
    setSyncFailed(false);
    setNotes([]);
    setProfile(emptyProfile());
    setProfileReady(false);
    setAttachments([]);
    setUsage(null);
    setSelected(null);
    setModal(null);
    setError('');
    setBusy(false);
  }
  const lock = useCallback((reason = '空间已锁定。') => {
    if (lockTask.current) return lockTask.current;
    setSigningOut(true);
    const work = async () => {
      try {
        const draft = await editor.current?.capture();
        if (draft) {
          pendingDraft.current = draft;
          reason += ' 未保存的编辑已在当前页面内加密暂存，重新登录后将恢复为副本；请勿关闭页面。';
        }
      } catch {
        reason += ' 未保存的编辑未能恢复。';
      }
      clearMemory();
      setLockAnimating(true);
      setNotice(reason);
      setStatus({ initialized: true, setupAvailable: false });
      // Revoke the old session immediately; never delay it for the animation.
      await Promise.allSettled([forgetDevice(), post('/auth/logout', {})]);
    };
    lockTask.current = work().finally(() => {
      lockTask.current = null;
      setSigningOut(false);
    });
    return lockTask.current;
  }, []);
  const unlock = useCallback(
    (u: Unlocked, raw: Uint8Array<ArrayBuffer>) => {
      rawKey.current = raw;
      setUnlocked(u);
      setEntering(true);
      setLockAnimating(false);
      setStatus({ initialized: true, setupAvailable: false });
      setNotice('');
      setError('');
      lastActivity.current = Date.now();
      void (async () => {
        const pending = pendingDraft.current;
        if (pending) {
          try {
            const content = await crypt.open<NoteContent>(
              u.key,
              pending.payload,
              `note:${pending.id}`,
            );
            content.title = `${content.title || '未命名'}（恢复的编辑）`;
            const id = crypto.randomUUID();
            const payload = await crypt.seal(u.key, content, `note:${id}`);
            await api(`/notes/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ payload, revision: 0 }),
            });
            pendingDraft.current = null;
          } catch (e) {
            showError(new Error('未保存的编辑恢复失败，请保持页面打开并重新登录：' + message(e)));
          }
        }
        await load(u);
      })();
    },
    [load, showError],
  );
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await api<{ initialized: boolean; setupAvailable: boolean }>('/status');
        if (!active) return;
        setStatus(s);
        if (s.initialized) {
          try {
            const info = await api<SessionInfo>('/session');
            const raw = await rememberedDevice(info);
            if (raw && active) {
              unlock({ key: await crypt.importKey(raw), info }, raw);
            }
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) await forgetDevice().catch(() => {});
          }
        }
      } catch (e) {
        if (active) showError(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [unlock, showError]);
  useEffect(() => {
    if (!unlocked) return;
    const activity = () => {
      lastActivity.current = Date.now();
    };
    const recheck = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const check = async () => {
      if (
        Date.now() >= unlocked.info.device.expires_at ||
        (!unlocked.info.device.trusted && Date.now() - lastActivity.current >= 5 * 60000)
      ) {
        await lock('登录已锁定，请重新输入密码。');
        return;
      }
      try {
        await api('/session');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await lock('该设备已退出或登录已过期。');
      }
    };
    for (const event of ['pointerdown', 'keydown', 'touchstart'])
      window.addEventListener(event, activity, { passive: true });
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('pageshow', recheck);
    const timer = setInterval(() => void check(), 30000);
    return () => {
      clearInterval(timer);
      for (const event of ['pointerdown', 'keydown', 'touchstart'])
        window.removeEventListener(event, activity);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('pageshow', recheck);
    };
  }, [unlocked, lock]);
  async function navigate(action: () => void) {
    try {
      await editor.current?.flush();
      action();
    } catch (e) {
      showError(e);
    }
  }
  async function create(kind: NoteKind, copy?: NoteContent) {
    if (!unlocked) return;
    const generation = gate.current;
    setBusy(true);
    try {
      await editor.current?.flush();
      const content = copy
        ? { ...copy, title: `${copy.title || '未命名'}（副本）` }
        : newContent(kind);
      const id = crypto.randomUUID();
      const payload = await crypt.seal(unlocked.key, content, `note:${id}`);
      const n = await api<NoteRecord>(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ payload, revision: 0, pinned: 0 }),
      });
      if (gate.current !== generation) return;
      setNotes((old) => [{ ...n, content }, ...old]);
      setSelected(id);
      setFilter('all');
      setSearch('');
      setModal(null);
      setMobileSidebar(false);
      setUsage(await api<Usage>('/usage'));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!status)
    return (
      <div className="loading-page">
        <Brand />
        <Spinner />
        <p>{error || t('正在连接你的空间…')}</p>
        {error && (
          <button className="button secondary" onClick={() => location.reload()}>
            {t('重新连接')}
          </button>
        )}
      </div>
    );
  if (!unlocked)
    return (
      <div className={`auth-shell ${lockAnimating ? 'is-lock-return' : ''}`}>
        {lockAnimating && <LockTransition />}
        <Auth
          signingOut={signingOut}
          key={status.initialized ? 'login' : 'setup'}
          initialized={status.initialized}
          setupAvailable={status.setupAvailable}
          onUnlock={unlock}
          notice={t(notice)}
        />
        {error && (
          <div className="toast" role="alert">
            {t(error)}
            <button aria-label={t('关闭通知')} onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    );
  const active = notes.find((n) => n.id === selected);
  const isFirstContent = !busy && notes.length === 0;
  const count = (f: Filter) =>
    notes.filter((n) =>
      f === 'trash'
        ? n.deleted_at
        : !n.deleted_at && (f === 'all' || (f === 'pinned' ? n.pinned : n.content.kind === f)),
    ).length;
  const filtered = notes
    .filter((n) =>
      filter === 'trash'
        ? !!n.deleted_at
        : !n.deleted_at &&
          (filter === 'all' || (filter === 'pinned' ? !!n.pinned : n.content.kind === filter)),
    )
    .filter(
      (n) =>
        !search ||
        [n.content.title, n.content.body, n.content.username, n.content.url, ...n.content.tags]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated_at - a.updated_at);
  const filterName =
    filter === 'all'
      ? '所有内容'
      : filter === 'pinned'
        ? '已置顶'
        : filter === 'trash'
          ? '回收站'
          : kinds[filter].name;
  return (
    <div
      className={`workspace ${entering ? 'is-entering' : ''} ${signingOut ? 'is-securing' : ''}`}
      inert={signingOut}
    >
      {entering && (
        <div className="unlock-transition" role="status" aria-label={t('欢迎回来')}>
          <div className="unlock-logo">
            <LogoMark size={90} />
          </div>
          <span>CipherMemo</span>
        </div>
      )}
      <aside className={`sidebar ${mobileSidebar ? 'mobile-open' : ''}`}>
        <Brand />
        <button
          className="space-label"
          type="button"
          aria-label={t('编辑个人信息')}
          disabled={!profileReady}
          onClick={() => void navigate(() => setModal('profile'))}
        >
          <span className="avatar" aria-hidden="true">
            {avatar ? (
              <img src={avatar} alt="" />
            ) : (
              (profile.content.nickname || unlocked.info.vault.username).charAt(0).toUpperCase()
            )}
          </span>
          <div className="space-identity">
            <strong title={profile.content.nickname || t('我的私人空间')}>
              {profile.content.nickname || t('我的私人空间')}
            </strong>
            <span title={unlocked.info.vault.username}>{unlocked.info.vault.username}</span>
          </div>
        </button>
        <button
          className="button primary new-button"
          onClick={() => void navigate(() => setModal('new'))}
        >
          <Plus size={17} />
          {t('新建')}
        </button>
        <nav>
          {(
            [
              ['all', t('所有内容'), FolderOpen],
              ['pinned', t('已置顶'), Pin],
            ] as const
          ).map(([f, label, Icon]) => (
            <button
              key={f}
              className={`nav-item ${filter === f ? 'active' : ''}`}
              onClick={() =>
                void navigate(() => {
                  setFilter(f);
                  setSelected(null);
                  setMobileSidebar(false);
                })
              }
            >
              <Icon size={17} />
              {t(String(label))}
              <span>{count(f)}</span>
            </button>
          ))}
          <span className="nav-section" />
          {(Object.entries(kinds) as [NoteKind, typeof kinds.note][]).map(
            ([f, { name, icon: Icon }]) => (
              <button
                key={f}
                className={`nav-item ${filter === f ? 'active' : ''}`}
                onClick={() =>
                  void navigate(() => {
                    setFilter(f);
                    setSelected(null);
                    setMobileSidebar(false);
                  })
                }
              >
                <Icon size={17} />
                {t(name)}
                <span>{count(f)}</span>
              </button>
            ),
          )}
          <span className="nav-section" />
          <button
            className={`nav-item ${filter === 'trash' ? 'active' : ''}`}
            onClick={() =>
              void navigate(() => {
                setFilter('trash');
                setSelected(null);
                setMobileSidebar(false);
              })
            }
          >
            <Trash2 size={17} />
            {t('回收站')}
            <span>{count('trash')}</span>
          </button>
          <button className="nav-item" onClick={() => void navigate(() => setModal('settings'))}>
            <Settings size={17} />
            {t('设置')}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <Preferences />
          <button
            className="storage-button"
            onClick={() => {
              void refreshFiles()
                .then(() => setModal('usage'))
                .catch(showError);
            }}
          >
            <span className="storage-amount">
              <span>{t('已用')}</span>
              <strong>{usage ? bytes(usage.total) : '…'}</strong>
            </span>
            <progress
              className={`storage-progress ${usage && usage.total >= STORAGE_REFERENCE ? 'at-reference' : ''}`}
              aria-label={t('空间已使用')}
              aria-valuetext={usage ? `${bytes(usage.total)} / 5 GB` : t('正在读取用量…')}
              max={STORAGE_REFERENCE}
              value={usage ? Math.min(usage.total, STORAGE_REFERENCE) : undefined}
            />
          </button>
          <button className="nav-item" onClick={() => void lock()}>
            <Lock size={17} />
            {t('锁定')}
          </button>
        </div>
      </aside>
      <main className={`workspace-main ${active ? 'has-selection' : ''}`}>
        <div className="content-layout">
          <section className="note-panel">
            <div className="list-heading">
              <div>
                <button
                  className="icon-button mobile-menu"
                  aria-label={t('打开导航')}
                  onClick={() => setMobileSidebar(!mobileSidebar)}
                >
                  <Menu size={19} />
                </button>
                <h1>{t(filterName)}</h1>
                <span>{filtered.length}</span>
              </div>
              <button
                className="icon-button"
                aria-label={t('新建内容')}
                onClick={() => void navigate(() => setModal('new'))}
              >
                <Plus size={21} />
              </button>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label={t('搜索内容')}
                placeholder={t('搜索')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {filter === 'trash' && (
              <div className="trash-hint">{t('删除后保留 30 天，可随时恢复。')}</div>
            )}
            <div className="note-list" ref={noteList}>
              {busy && !notes.length ? (
                <div className="list-empty">
                  <Spinner />
                  {t('正在加载…')}
                </div>
              ) : (
                filtered.map((n) => {
                  const { icon: Icon, color, name } = kinds[n.content.kind];
                  const attachmentCount = attachments.filter((a) => a.note_id === n.id).length;
                  const preview = (
                    n.content.kind === 'credential' ? n.content.username || '' : n.content.body
                  )
                    .trim()
                    .replace(/\n\s*\n+/g, '\n')
                    .slice(0, 100);
                  return (
                    <button
                      className={`note-card ${n.id === selected ? 'selected' : ''}`}
                      key={n.id}
                      onClick={() => void navigate(() => setSelected(n.id))}
                    >
                      <h3>{n.content.title || t('未命名')}</h3>
                      {preview && <p>{preview}</p>}
                      <div className="note-card-meta">
                        <span className={`note-type ${color}`} title={t(name)}>
                          <Icon size={13} aria-label={t(name)} />
                        </span>
                        <time>{shortDate(n.updated_at)}</time>
                        {!!n.pinned && <Pin size={12} aria-label={t('已置顶')} />}
                        {n.content.tags.slice(0, 2).map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                        {attachmentCount > 0 && (
                          <span className="note-card-files">
                            <Paperclip size={11} />
                            {attachmentCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
              {!busy && !filtered.length && (
                <div className="list-empty">
                  {search
                    ? t('没有匹配的内容')
                    : filter === 'trash'
                      ? t('回收站是空的')
                      : t('还没有内容')}
                </div>
              )}
            </div>
            <div className="list-footer">
              {busy ? (
                <Spinner />
              ) : syncFailed ? (
                <Cloud size={13} />
              ) : syncedAt ? (
                <CheckCheck size={13} />
              ) : (
                <Cloud size={13} />
              )}
              <span role="status">
                {busy ? (
                  t('同步中…')
                ) : syncFailed ? (
                  t('同步失败，请重试')
                ) : syncedAt ? (
                  <>
                    {t('已同步')}{' '}
                    <time dateTime={new Date(syncedAt).toISOString()}>{clockTime(syncedAt)}</time>
                  </>
                ) : (
                  t('等待同步')
                )}
              </span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void navigate(() => void load(unlocked))}
              >
                {t('刷新')}
              </button>
            </div>
          </section>
          <section className="detail-panel" ref={detailPanel}>
            {active ? (
              <>
                <button
                  className="mobile-back text-button"
                  onClick={() => void navigate(() => setSelected(null))}
                >
                  <ArrowLeft size={16} />
                  {t('返回列表')}
                </button>
                {active.deleted_at ? (
                  <div className="trash-detail">
                    <h2>{active.content.title || t('未命名')}</h2>
                    <p>{t('这条内容在回收站中，恢复后可继续编辑。')}</p>
                    <button
                      className="button primary"
                      onClick={async () => {
                        try {
                          await post(`/notes/${active.id}/restore`);
                          await load(unlocked);
                        } catch (e) {
                          showError(e);
                        }
                      }}
                    >
                      <RotateCcw size={16} />
                      {t('恢复')}
                    </button>
                    <button className="text-button danger" onClick={() => setModal('trash')}>
                      {t('永久删除')}
                    </button>
                  </div>
                ) : (
                  <Editor
                    key={active.id}
                    ref={editor}
                    note={active}
                    vaultKey={unlocked.key}
                    attachments={attachments.filter((a) => a.note_id === active.id)}
                    onSaved={(n) => {
                      updateNote(n);
                      void api<Usage>('/usage').then(setUsage).catch(showError);
                    }}
                    onFilesChanged={refreshFiles}
                    onError={showError}
                    onState={setSaveState}
                    onTrash={async () => {
                      try {
                        await post(`/notes/${active.id}/trash`);
                        setSelected(null);
                        await load(unlocked);
                      } catch (e) {
                        showError(e);
                      }
                    }}
                    onCopy={async (content) => {
                      try {
                        const id = crypto.randomUUID();
                        const copy = { ...content, title: `${content.title || '未命名'}（副本）` };
                        const payload = await crypt.seal(unlocked.key, copy, `note:${id}`);
                        const n = await api<NoteRecord>(`/notes/${id}`, {
                          method: 'PUT',
                          body: JSON.stringify({ payload, revision: 0 }),
                        });
                        setNotes((old) => [{ ...n, content: copy }, ...old]);
                        setSelected(id);
                        setError('副本已保存；附件仍属于原条目。');
                      } catch (e) {
                        showError(e);
                      }
                    }}
                  />
                )}
              </>
            ) : (
              <div className="welcome-empty">
                <p>{t(isFirstContent ? '还没有内容' : '未选择内容')}</p>
                <button className="button secondary" onClick={() => setModal('new')}>
                  <Plus size={16} />
                  {t('新建')}
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
      {error && (
        <div className="toast" role="alert">
          {t(error)}
          <button aria-label={t('关闭通知')} onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <MotionPresence>
        {modal === 'new' && (
          <Modal title={t('新建')} onClose={() => setModal(null)}>
            <div className="new-grid">
              {(Object.entries(kinds) as [NoteKind, typeof kinds.note][]).map(
                ([kind, { name, icon: Icon, color }]) => (
                  <button key={kind} disabled={busy} onClick={() => void create(kind)}>
                    <span className={`type-icon ${color}`}>
                      <Icon size={18} />
                    </span>
                    <strong>{t(name)}</strong>
                  </button>
                ),
              )}
            </div>
          </Modal>
        )}
      </MotionPresence>
      <MotionPresence>
        {modal === 'usage' && usage && (
          <Modal title={t('空间用量')} onClose={() => setModal(null)}>
            <div className="usage-total">{bytes(usage.total)}</div>
            <div className="usage-rows">
              {[
                [t('文本与条目'), usage.text],
                [t('图片与文件'), usage.files],
                [t('回收站'), usage.trash],
                [t('上传与待清理'), usage.pending],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span>{t(String(label))}</span>
                  <strong>{bytes(Number(value))}</strong>
                </div>
              ))}
            </div>
            <p className="muted small">
              {t('{notes} 条内容，{files} 个附件', {
                notes: usage.notes,
                files: usage.attachments,
              })}
            </p>
          </Modal>
        )}
      </MotionPresence>
      <MotionPresence>
        {modal === 'trash' && active && (
          <Modal title={t('永久删除这条内容？')} onClose={() => setModal(null)}>
            <p className="muted">
              {t('“{title}”及其附件将被永久删除。', {
                title: active.content.title || t('未命名'),
              })}
            </p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setModal(null)}>
                {t('取消')}
              </button>
              <button
                className="button danger-fill"
                onClick={async () => {
                  try {
                    await api(`/notes/${active.id}`, { method: 'DELETE' });
                    setSelected(null);
                    setModal(null);
                    await load(unlocked);
                  } catch (e) {
                    showError(e);
                  }
                }}
              >
                {t('永久删除')}
              </button>
            </div>
          </Modal>
        )}
      </MotionPresence>
      <MotionPresence>
        {modal === 'profile' && (
          <ProfileEditor
            vaultKey={unlocked.key}
            email={unlocked.info.vault.username}
            profile={profile}
            avatar={avatar}
            onClose={() => setModal(null)}
            onSaved={(record, content) => {
              setProfile({ record, content });
              setSyncedAt(Date.now());
              setModal(null);
              void refreshFiles().catch(showError);
            }}
          />
        )}
      </MotionPresence>
      <MotionPresence>
        {modal === 'settings' && (
          <SettingsModal
            unlocked={unlocked}
            raw={rawKey.current!}
            notes={notes}
            onClose={() => setModal(null)}
            onError={showError}
            onLogout={() => void lock('账号设置已更新，请重新登录。')}
            onImported={() => load(unlocked)}
          />
        )}
      </MotionPresence>
      <span className="sr-only" aria-live="polite">
        {t(saveState)}
      </span>
    </div>
  );
}

type Backup = {
  format: 'ciphermemo-backup';
  version: 1;
  exportedAt: string;
  vault: VaultHeader;
  notes: NoteRecord[];
  attachments: (Attachment & { parts: string[] })[];
  profile?: ProfileRecord;
};
function SettingsModal({
  unlocked,
  raw,
  notes,
  onClose,
  onError,
  onLogout,
  onImported,
}: {
  unlocked: Unlocked;
  raw: Uint8Array<ArrayBuffer>;
  notes: OpenNote[];
  onClose: () => void;
  onError: (e: unknown) => void;
  onLogout: () => void;
  onImported: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'devices' | 'security' | 'backup'>('devices');
  const tabPanel = useRef<HTMLDivElement>(null);
  useMotionSwitch(tabPanel, tab);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [info, setInfo] = useState('');
  const [revoke, setRevoke] = useState<Device | 'all' | null>(null);
  const reload = useCallback(() => api<Device[]>('/devices').then(setDevices), []);
  useEffect(() => {
    reload().catch(onError);
  }, [reload, onError]);
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy('正在更新密码…');
    try {
      crypt.validatePassword(newPassword);
      if (newPassword !== confirm) throw new Error('两次新密码不一致');
      const old = await crypt.derive(oldPassword, unlocked.info.vault.kdf);
      const kdf = crypt.newKdf();
      const next = await crypt.derive(newPassword, kdf);
      const wrappedKey = await crypt.sealBytes(next.wrapping, raw, 'vault-key');
      await post('/auth/password', { oldAuth: old.auth, auth: next.auth, kdf, wrappedKey });
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
      onLogout();
    } catch (e) {
      onError(e);
    } finally {
      setBusy('');
    }
  }
  async function exportBackup() {
    setBusy('正在整理备份…');
    try {
      const [profile, attachments] = await Promise.all([
        api<ProfileRecord>('/profile'),
        api<Attachment[]>('/attachments'),
      ]);
      if (
        profile.avatarId &&
        !attachments.some((a) => a.id === profile.avatarId && a.note_id === PROFILE_OWNER_ID)
      )
        throw new Error('个人信息已变化，请关闭弹窗并刷新后重试');
      const files: Backup['attachments'] = [];
      for (const a of attachments) {
        setBusy(
          t('正在备份附件 {current}/{total}…', {
            current: files.length + 1,
            total: attachments.length,
          }),
        );
        const parts: string[] = [];
        for (let p = 0; p < a.chunks; p++)
          parts.push(crypt.base64(await fileBackup.encryptedChunk(a.id, p)));
        files.push({ ...a, parts });
      }
      const backup: Backup = {
        format: 'ciphermemo-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        vault: unlocked.info.vault,
        profile,
        notes: notes.map(({ content: _, ...n }) => n),
        attachments: files,
      };
      saveBlob(
        new Blob([JSON.stringify(backup)], { type: 'application/json' }),
        `ciphermemo-${new Date().toISOString().slice(0, 10)}.cmbackup`,
      );
      setInfo('备份已导出，包含回收站和附件。恢复时需要导出当时的密码。');
    } catch (e) {
      onError(e);
    } finally {
      setBusy('');
    }
  }
  async function importBackup(e: FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setBusy('正在验证备份…');
    let imported = 0;
    try {
      const backup = JSON.parse(await importFile.text()) as Backup;
      if (
        backup.format !== 'ciphermemo-backup' ||
        backup.version !== 1 ||
        !Array.isArray(backup.notes) ||
        !Array.isArray(backup.attachments)
      )
        throw new Error('不支持的备份格式');
      const material = await crypt.derive(backupPassword, backup.vault.kdf);
      const oldRaw = await crypt.openBytes(material.wrapping, backup.vault.wrappedKey, 'vault-key');
      const oldKey = await crypt.importKey(oldRaw);
      oldRaw.fill(0);
      // Authenticate the full backup before writing any records. File bytes are also checked per chunk.
      const restoredProfile = backup.profile ? await openProfile(oldKey, backup.profile) : null;
      if (
        restoredProfile?.avatarId &&
        !backup.attachments.some(
          (a) => a.id === restoredProfile.avatarId && a.note_id === PROFILE_OWNER_ID,
        )
      )
        throw new Error('备份附件索引不完整');
      const contents = new Map<string, NoteContent>();
      for (const n of backup.notes) {
        const content = await crypt.open<NoteContent>(oldKey, n.payload, `note:${n.id}`);
        if (
          !kinds[content.kind] ||
          typeof content.title !== 'string' ||
          typeof content.body !== 'string' ||
          !Array.isArray(content.tags)
        )
          throw new Error('备份条目格式不正确');
        contents.set(n.id, content);
      }
      for (const a of backup.attachments) {
        if (
          (!contents.has(a.note_id) &&
            !(a.note_id === PROFILE_OWNER_ID && a.id === restoredProfile?.avatarId)) ||
          a.parts.length !== a.chunks
        )
          throw new Error('备份附件索引不完整');
        const meta = await crypt.open<AttachmentMeta>(oldKey, a.metadata, `attachment:${a.id}`);
        let size = 0;
        for (let p = 0; p < a.parts.length; p++) {
          const part = await crypt.openChunk(oldKey, crypt.unbase64(a.parts[p]), a.id, p);
          size += part.length;
        }
        if (size !== meta.size || Math.max(1, Math.ceil(meta.size / crypt.CHUNK_SIZE)) !== a.chunks)
          throw new Error('备份文件校验失败');
      }
      for (const n of backup.notes) {
        setBusy(
          t('正在导入 {current}/{total}…', { current: imported + 1, total: backup.notes.length }),
        );
        const id = crypto.randomUUID();
        const content = contents.get(n.id)!;
        const payload = await crypt.seal(unlocked.key, content, `note:${id}`);
        await api(`/notes/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ payload, revision: 0, pinned: n.pinned }),
        });
        imported++;
        for (const a of backup.attachments.filter((a) => a.note_id === n.id)) {
          const meta = await crypt.open<AttachmentMeta>(oldKey, a.metadata, `attachment:${a.id}`);
          const parts: Uint8Array<ArrayBuffer>[] = [];
          for (let p = 0; p < a.parts.length; p++)
            parts.push(await crypt.openChunk(oldKey, crypt.unbase64(a.parts[p]), a.id, p));
          await uploadFile(
            unlocked.key,
            id,
            new window.File(parts, meta.name, { type: meta.type }),
            () => {},
          );
        }
        if (n.deleted_at) await post(`/notes/${id}/trash`);
      }
      if (restoredProfile) {
        const current = await api<ProfileRecord>('/profile');
        if (!current.payload) {
          let avatarId: string | null = null;
          const image = backup.attachments.find(
            (a) => a.id === restoredProfile.avatarId && a.note_id === PROFILE_OWNER_ID,
          );
          if (restoredProfile.avatarId && !image) throw new Error('备份附件索引不完整');
          if (image) {
            const meta = await crypt.open<AttachmentMeta>(
              oldKey,
              image.metadata,
              `attachment:${image.id}`,
            );
            const parts: Uint8Array<ArrayBuffer>[] = [];
            for (let part = 0; part < image.parts.length; part++)
              parts.push(
                await crypt.openChunk(oldKey, crypt.unbase64(image.parts[part]), image.id, part),
              );
            avatarId = await uploadFile(
              unlocked.key,
              PROFILE_OWNER_ID,
              new window.File(parts, meta.name, { type: meta.type }),
              () => {},
            );
          }
          const content = { nickname: restoredProfile.nickname, avatarId };
          await api('/profile', {
            method: 'PUT',
            body: JSON.stringify({
              payload: await crypt.seal(unlocked.key, content, 'profile'),
              avatarId,
              revision: current.revision,
            }),
          });
        }
      }
      setBackupPassword('');
      setImportFile(null);
      await onImported();
      setInfo(t('已导入 {count} 条内容，原有内容保持保留。', { count: imported }));
    } catch (e) {
      if (imported) await onImported().catch(() => {});
      onError(
        new Error(
          imported
            ? t('已导入 {count} 条，后续导入中断：{error}。重复导入会创建副本。', {
                count: imported,
                error: t(message(e)),
              })
            : message(e),
        ),
      );
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title={t('设置')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="settings-tabs">
        {(
          [
            ['devices', t('设备')],
            ['security', t('密码')],
            ['backup', t('备份与恢复')],
          ] as const
        ).map(([tabId, label]) => (
          <button
            disabled={!!busy}
            key={tabId}
            className={tab === tabId ? 'active' : ''}
            onClick={() => {
              setTab(tabId);
              setInfo('');
            }}
          >
            {t(String(label))}
          </button>
        ))}
      </div>
      <div className="settings-tab-panel" ref={tabPanel}>
        {tab === 'devices' && (
          <>
            <p className="muted small">{t('可信设备 14 天内免输密码。')}</p>
            <div className="device-list">
              {devices.map((d) => (
                <div key={d.id} className="device-row">
                  <span className="device-icon">
                    <Monitor size={22} />
                  </span>
                  <div>
                    <strong>
                      {d.label}
                      {d.current && <span className="tag">{t('当前设备')}</span>}
                    </strong>
                    <small>
                      {d.trusted ? t('可信设备') : t('临时会话')} {t('· 最近访问')}
                      {date(d.last_seen)}
                    </small>
                    <small>
                      {t('到期')}
                      {date(d.expires_at)}
                    </small>
                  </div>
                  <button
                    className="text-button danger"
                    onClick={() => setRevoke(d)}
                    disabled={!!busy}
                  >
                    {t('退出')}
                  </button>
                </div>
              ))}
            </div>
            <button
              className="button secondary full"
              disabled={!!busy}
              onClick={() => setRevoke('all')}
            >
              <LogOut size={16} />
              {t('退出所有设备')}
            </button>
            {revoke && (
              <div className="inline-confirm">
                {revoke === 'all'
                  ? t('包括当前设备，全部退出？')
                  : t('撤销 {device} 的访问？', { device: revoke.label })}
                <button
                  className="text-button danger"
                  onClick={async () => {
                    setBusy('正在撤销…');
                    try {
                      if (revoke === 'all') {
                        await post('/devices/revoke-all');
                        onLogout();
                      } else {
                        await api(`/devices/${revoke.id}`, { method: 'DELETE' });
                        if (revoke.current) onLogout();
                        else await reload();
                      }
                      setRevoke(null);
                    } catch (e) {
                      onError(e);
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  {t('确认退出')}
                </button>
                <button className="text-button" onClick={() => setRevoke(null)}>
                  {t('取消')}
                </button>
              </div>
            )}
          </>
        )}
        {tab === 'security' && (
          <>
            <form onSubmit={changePassword}>
              <label className="field">
                <span>{t('当前密码')}</span>
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t('新密码')}</span>
                <input
                  required
                  minLength={14}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t('确认新密码')}</span>
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <p className="muted small">
                {t(
                  '至少 14 个字符。修改后所有设备需重新登录；恢复密钥不变，旧备份仍用导出时的密码。',
                )}
              </p>
              <button className="button primary" disabled={!!busy}>
                {t('更新密码并退出')}
              </button>
            </form>
          </>
        )}
        {tab === 'backup' && (
          <>
            <div className="backup-section">
              <h3>
                <Download size={18} />
                {t('导出备份')}
              </h3>
              <p className="muted small">
                {t('包含全部条目、附件和回收站。导入时需要导出时的密码。')}
              </p>
              <button
                className="button secondary full"
                disabled={!!busy}
                onClick={() => void exportBackup()}
              >
                {t('下载空间备份')}
              </button>
            </div>
            <div className="backup-section">
              <h3>
                <Upload size={18} />
                {t('从备份导入')}
              </h3>
              <p className="muted small">{t('导入为副本，不覆盖现有内容。')}</p>
              <form onSubmit={importBackup}>
                <label className="field">
                  <span>{t('备份文件')}</span>
                  <input
                    type="file"
                    accept=".cmbackup,.json"
                    required
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  />
                </label>
                <label className="field">
                  <span>{t('备份导出时的密码')}</span>
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={backupPassword}
                    onChange={(e) => setBackupPassword(e.target.value)}
                  />
                </label>
                <button className="button primary full" disabled={!!busy || !importFile}>
                  {t('验证并导入备份')}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
      {busy && (
        <div className="notice">
          <Spinner />
          {t(busy)}
        </div>
      )}
      {info && <div className="notice">{t(info)}</div>}
      <div className="settings-footer">CipherMemo 0.1 · Powered by GPT-6.1 Sol</div>
    </Modal>
  );
}
