import { useSyncExternalStore } from 'react';
import { english } from './translations';

export type LanguageMode = 'system' | 'zh' | 'en';
export type ThemeMode = 'system' | 'light' | 'dark';
const storageKey = 'ciphermemo-preferences';
const media = window.matchMedia('(prefers-color-scheme: dark)');
function read(): { language: LanguageMode; theme: ThemeMode } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      language: ['system', 'zh', 'en'].includes(saved.language) ? saved.language : 'system',
      theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'system',
    };
  } catch {
    return { language: 'system', theme: 'system' };
  }
}
let preferences = read();
const listeners = new Set<() => void>();
export const locale = () =>
  preferences.language === 'system'
    ? navigator.language.toLowerCase().startsWith('zh')
      ? 'zh-CN'
      : 'en-US'
    : preferences.language === 'zh'
      ? 'zh-CN'
      : 'en-US';
export function t(value: string, values?: Record<string, string | number>): string {
  const translated = locale() === 'zh-CN' ? value : (english[value] ?? value);
  return values
    ? translated.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match))
    : translated;
}
export const clockTime = (time: number) =>
  new Intl.DateTimeFormat(locale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(time);
function apply() {
  document.documentElement.dataset.theme =
    preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme;
  document.documentElement.lang = locale();
  document.title = locale() === 'zh-CN' ? 'CipherMemo · 私人空间' : 'CipherMemo · Personal space';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      document.documentElement.dataset.theme === 'dark' ? '#17262c' : '#f4f8f8',
    );
}
function notify() {
  apply();
  // A new snapshot also rerenders translated content on system preference changes.
  preferences = { ...preferences };
  listeners.forEach((listener) => listener());
}
export function setPreferences(next: Partial<typeof preferences>) {
  preferences = { ...preferences, ...next };
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    /* Session-only preferences remain available. */
  }
  notify();
}
media.addEventListener('change', notify);
window.addEventListener('languagechange', notify);
window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) {
    preferences = read();
    notify();
  }
});
apply();
export function usePreferences() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => preferences,
  );
}
