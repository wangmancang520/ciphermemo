import { Languages, Sun, Moon, Monitor } from 'lucide-react';
import {
  t,
  setPreferences,
  usePreferences,
  type LanguageMode,
  type ThemeMode,
} from './preferences';

export default function Preferences() {
  const { language, theme } = usePreferences();
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  return (
    <div className="preferences" aria-label={t('界面偏好')}>
      <label className="preference-control" title={t('语言')}>
        <Languages size={16} aria-hidden="true" />
        <select
          aria-label={t('语言')}
          value={language}
          onChange={(e) => setPreferences({ language: e.target.value as LanguageMode })}
        >
          <option value="system">{t('跟随系统')}</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="preference-control" title={t('外观')}>
        <ThemeIcon size={16} aria-hidden="true" />
        <select
          aria-label={t('外观')}
          value={theme}
          onChange={(e) => setPreferences({ theme: e.target.value as ThemeMode })}
        >
          <option value="system">{t('跟随系统')}</option>
          <option value="light">{t('浅色模式')}</option>
          <option value="dark">{t('夜间模式')}</option>
        </select>
      </label>
    </div>
  );
}
