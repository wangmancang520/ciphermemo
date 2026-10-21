export type Envelope = { v: 1; iv: string; data: string };
export type Kdf = {
  name: 'argon2id';
  salt: string;
  memory: number;
  iterations: number;
  parallelism: number;
};
export type VaultHeader = {
  id: string;
  username: string;
  kdf: Kdf;
  wrappedKey: Envelope;
  recoveryWrappedKey: Envelope;
  revision: number;
};
export type NoteKind = 'note' | 'credential' | 'license' | 'file';
export type NoteContent = {
  title: string;
  body: string;
  tags: string[];
  kind: NoteKind;
  username?: string;
  password?: string;
  url?: string;
  license?: string;
};
export type NoteRecord = {
  id: string;
  payload: Envelope;
  pinned: number;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};
export type OpenNote = NoteRecord & { content: NoteContent };
export type AttachmentMeta = { name: string; type: string; size: number };
export type Attachment = {
  id: string;
  note_id: string;
  metadata: Envelope;
  bytes: number;
  chunks: number;
  status: string;
  created_at: number;
};
export type Device = {
  id: string;
  label: string;
  trusted: number;
  created_at: number;
  last_seen: number;
  expires_at: number;
  current: boolean;
};
export type Usage = {
  text: number;
  files: number;
  trash: number;
  total: number;
  notes: number;
  attachments: number;
  pending: number;
};
export type SessionInfo = { vault: VaultHeader; device: Device };

export const PROFILE_OWNER_ID = '00000000-0000-4000-8000-000000000001';
export type ProfileContent = { nickname: string; avatarId: string | null };
export type ProfileRecord = { payload: Envelope | null; avatarId: string | null; revision: number };
