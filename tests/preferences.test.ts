import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let systemDark: boolean;
let systemLanguage: string;
let saved: string | null;
let events: Record<string, (event?: any) => void>;
let mediaChanged: () => void;
let root: { dataset: Record<string, string>; lang: string };
let meta: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  systemDark = false;
  systemLanguage = 'zh-CN';
  saved = null;
  events = {};
  root = { dataset: {}, lang: '' };
  meta = vi.fn();
  vi.stubGlobal('navigator', {
    get language() {
      return systemLanguage;
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_event: string, listener: () => void) => {
        mediaChanged = listener;
      },
    }),
    addEventListener: (event: string, listener: () => void) => {
      events[event] = listener;
    },
  });
  vi.stubGlobal('document', {
    documentElement: root,
    title: '',
    querySelector: () => ({ setAttribute: meta }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('界面偏好', () => {
  it('默认跟随系统语言和主题，并实时响应系统变化', async () => {
    const { t, locale } = await import('../src/client/preferences');
    expect(root.dataset.theme).toBe('light');
    expect(locale()).toBe('zh-CN');
    systemDark = true;
    mediaChanged();
    expect(root.dataset.theme).toBe('dark');
    systemLanguage = 'en-GB';
    events.languagechange();
    expect(root.lang).toBe('en-US');
    expect(t('已保存')).toBe('Saved');
  });

  it('显式选择会持久保存，并优先于系统设置；仍可恢复跟随系统', async () => {
    const { setPreferences, locale, t } = await import('../src/client/preferences');
    setPreferences({ language: 'en', theme: 'dark' });
    expect(JSON.parse(saved!)).toEqual({ language: 'en', theme: 'dark' });
    expect(root.dataset.theme).toBe('dark');
    systemLanguage = 'zh-CN';
    events.languagechange();
    mediaChanged();
    expect(locale()).toBe('en-US');
    expect(root.dataset.theme).toBe('dark');
    expect(t('自定义备忘录内容')).toBe('自定义备忘录内容');
    setPreferences({ language: 'system', theme: 'system' });
    expect(locale()).toBe('zh-CN');
    expect(root.dataset.theme).toBe('light');
  });

  it('损坏或不可用的本地存储不影响主题与语言切换', async () => {
    saved = '{broken';
    const { setPreferences, locale } = await import('../src/client/preferences');
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('Storage blocked');
      },
    });
    expect(() => setPreferences({ language: 'en', theme: 'dark' })).not.toThrow();
    expect(locale()).toBe('en-US');
    expect(root.dataset.theme).toBe('dark');
  });

  it('恢复已保存的设置并响应其他标签页的偏好变化', async () => {
    saved = JSON.stringify({ language: 'en', theme: 'dark' });
    const { locale } = await import('../src/client/preferences');
    expect(locale()).toBe('en-US');
    expect(root.dataset.theme).toBe('dark');
    saved = JSON.stringify({ language: 'zh', theme: 'light' });
    events.storage({ key: 'ciphermemo-preferences' });
    expect(locale()).toBe('zh-CN');
    expect(root.dataset.theme).toBe('light');
  });
});
