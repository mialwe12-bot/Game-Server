import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const ThemeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void; dark: boolean }>({
  mode: 'system',
  setMode: () => undefined,
  dark: true,
});

function read(): ThemeMode {
  try {
    const v = localStorage.getItem('gs-theme');
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignorieren
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(read);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem('gs-theme', m);
    } catch {
      // ignorieren
    }
  }, []);

  return <ThemeContext.Provider value={{ mode, setMode, dark }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
