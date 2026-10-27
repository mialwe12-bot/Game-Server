import { useQueryClient } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { desktop, desktopError } from './bridge';

export default function ServerSetupPage({ onConnected }: { onConnected?: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState(api.baseUrl || 'https://');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let normalized = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(normalized)) normalized = `https://${normalized}`;
    try {
      await desktop.testServer(normalized);
      // Neuer Server → alte Sitzung verwerfen
      await desktop.setSession(normalized, normalized === api.baseUrl ? api.token : null);
      if (normalized !== api.baseUrl) api.token = null;
      api.baseUrl = normalized;
      qc.clear();
      onConnected?.();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(desktopError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={connect} className="w-full max-w-md space-y-5 rounded-lg border border-border bg-surface p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <h1 className="text-xl font-bold">{t('desktop.setupTitle')}</h1>
        </div>
        <p className="text-sm text-muted">{t('desktop.setupText')}</p>
        {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Field label={t('desktop.serverUrl')}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus required placeholder="https://games.example.com" />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<Server className="size-4" />}>
          {busy ? t('desktop.connecting') : t('desktop.connect')}
        </Button>
      </form>
    </div>
  );
}
