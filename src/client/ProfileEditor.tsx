import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, LoaderCircle, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import { api } from './api';
import { fileBlob, uploadFile } from './files';
import { open, seal } from './crypto';
import { t } from './preferences';
import {
  PROFILE_OWNER_ID,
  type Attachment,
  type ProfileContent,
  type ProfileRecord,
} from '../shared/types';

const imageType = /^image\/(png|jpeg|webp|avif)$/;
export const emptyProfile = () => ({
  record: { payload: null, avatarId: null, revision: 0 } as ProfileRecord,
  content: { nickname: '', avatarId: null } as ProfileContent,
});
export async function openProfile(key: CryptoKey, record: ProfileRecord): Promise<ProfileContent> {
  if (!record.payload) return emptyProfile().content;
  const content = await open<ProfileContent>(key, record.payload, 'profile');
  if (
    typeof content.nickname !== 'string' ||
    content.nickname.length > 60 ||
    content.avatarId !== record.avatarId
  )
    throw new Error('个人信息格式不正确');
  return content;
}
export function useAvatar(
  key: CryptoKey | null,
  attachment: Attachment | null,
  onError: (e: unknown) => void,
) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    if (key && attachment)
      void fileBlob(key, attachment)
        .then(({ blob }) => {
          if (!active) return;
          if (!imageType.test(blob.type) || blob.size > 5 * 1024 ** 2)
            throw new Error('请选择不超过 5MB 的 JPG、PNG、WebP 或 AVIF 图片');
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch((error) => {
          if (active) onError(error);
        });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, attachment, onError]);
  return url;
}

export default function ProfileEditor({
  vaultKey,
  email,
  profile,
  avatar,
  onClose,
  onSaved,
}: {
  vaultKey: CryptoKey;
  email: string;
  profile: { record: ProfileRecord; content: ProfileContent };
  avatar: string;
  onClose: () => void;
  onSaved: (record: ProfileRecord, content: ProfileContent) => void;
}) {
  const baseline = useRef(profile).current;
  const [nickname, setNickname] = useState(baseline.content.nickname);
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const active = useRef(true);
  const selection = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      selection.current++;
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function choose(candidate: File | undefined) {
    if (!candidate) return;
    const run = ++selection.current;
    setError('');
    setValidating(false);
    if (!imageType.test(candidate.type) || candidate.size > 5 * 1024 ** 2) {
      setError('请选择不超过 5MB 的 JPG、PNG、WebP 或 AVIF 图片');
      return;
    }
    setValidating(true);
    const url = URL.createObjectURL(candidate);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (active.current && selection.current === run) {
        setFile(candidate);
        setRemove(false);
      }
    } catch {
      if (active.current && selection.current === run) setError('无法读取这张图片，请选择其他图片');
    } finally {
      URL.revokeObjectURL(url);
      if (active.current && selection.current === run) setValidating(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || validating) return;
    setBusy(true);
    setError('');
    try {
      let avatarId = remove ? null : baseline.content.avatarId;
      if (file)
        avatarId = await uploadFile(vaultKey, PROFILE_OWNER_ID, file, (value) => {
          if (active.current) setProgress(value);
        });
      const content = { nickname: nickname.trim(), avatarId };
      const record = await api<ProfileRecord>('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          payload: await seal(vaultKey, content, 'profile'),
          avatarId,
          revision: baseline.record.revision,
        }),
      });
      const old = baseline.content.avatarId;
      if (old && old !== avatarId)
        void api(`/attachments/${old}`, { method: 'DELETE' }).catch(() => {});
      if (active.current) onSaved(record, content);
    } catch (error) {
      if (active.current) setError(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const photo = preview || (!remove ? avatar : '');
  return (
    <Modal
      title={t('编辑个人信息')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="profile-form" onSubmit={save}>
        <div className="profile-photo-row">
          <div className="profile-photo" aria-label={t('头像')}>
            {photo ? (
              <img src={photo} alt={t('头像预览')} />
            ) : (
              <span>{(nickname || email).charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="profile-photo-controls">
            <label className={`button secondary profile-upload ${busy ? 'disabled' : ''}`}>
              <Camera size={17} />
              {t('上传头像')}
              <input
                type="file"
                aria-label={t('上传头像')}
                accept="image/png,image/jpeg,image/webp,image/avif"
                disabled={busy}
                onChange={(e) => {
                  void choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="muted small">{t('JPG、PNG、WebP 或 AVIF，最大 5MB')}</p>
            {(file || baseline.content.avatarId) && !remove && (
              <button
                type="button"
                className="text-button danger"
                disabled={busy || validating}
                onClick={() => {
                  selection.current++;
                  setFile(null);
                  setRemove(true);
                }}
              >
                <Trash2 size={14} />
                {t('移除头像')}
              </button>
            )}
          </div>
        </div>
        <label className="field">
          <span>{t('昵称')}</span>
          <input
            autoComplete="nickname"
            maxLength={60}
            value={nickname}
            placeholder={t('我的私人空间')}
            disabled={busy}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('邮箱')}</span>
          <input type="text" readOnly value={email} />
        </label>
        {error && (
          <div className="error" role="alert">
            {t(error)}
          </div>
        )}
        {busy && (
          <p className="muted" role="status">
            {file ? t('正在保存头像与昵称…') + ` ${progress}%` : t('正在保存个人信息…')}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
            {t('取消')}
          </button>
          <button className="button primary" type="submit" disabled={busy || validating}>
            {busy || validating ? <LoaderCircle size={17} className="spin" /> : <Save size={17} />}
            {t('保存')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
