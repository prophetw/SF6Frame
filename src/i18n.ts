import { ref } from 'vue';

export type Locale = 'zh-CN' | 'en';

const STORAGE_KEY = 'sf6frame:locale';

function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}

function loadInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // ignore
  }
  return 'zh-CN';
}

export const locale = ref<Locale>(loadInitialLocale());

export function setLocale(next: Locale) {
  locale.value = next;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
}

export function useLocale() {
  return { locale, setLocale };
}

export function getMoveDisplayName(move: { name: string; nameZh?: string }): string {
  return locale.value === 'zh-CN' ? move.nameZh ?? move.name : move.name;
}

