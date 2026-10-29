import { useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Bindet das vom Betreiber hinterlegte CSS als <style>-Tag ein (Web und Desktop-Client). */
export function CustomCssInjector() {
  const { settings } = useAuth();
  const css = settings?.customCss ?? '';
  useEffect(() => {
    const id = 'gs-custom-css';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!css) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [css]);
  return null;
}

/** Logo des Betreibers; fällt auf das Standard-Icon zurück. `client` nutzt zusätzlich das Client-Logo. */
export function BrandLogo({ className, client = false }: { className?: string; client?: boolean }) {
  const { settings } = useAuth();
  const raw = (client ? settings?.clientLogoUrl : '') || settings?.logoUrl || '';
  const src = raw ? api.url(raw) : '/favicon.svg';
  return <img src={src} alt={settings?.siteName ?? ''} className={className} />;
}
