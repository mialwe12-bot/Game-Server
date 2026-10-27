import { useQuery } from '@tanstack/react-query';
import { Ban, Download, KeyRound, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedGame } from '@gameserver/shared';
import { Badge, Button, Card, Field, Input, Select, Spinner } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { toast } from '../../../lib/toast';

/** Aktivierungscodes erzeugen (z. B. für Presse, Beta-Tester, Events) – fügen das Spiel der Bibliothek hinzu und geben ggf. Zugriff */
export function CodesTab({ game }: { game: ManagedGame }) {
  const { t } = useTranslation();
  const [batch, setBatch] = useState('');
  const [form, setForm] = useState({ count: 10, batch: '', note: '', maxUses: 1, expiresAt: '' });
  const codes = useQuery({ queryKey: ['admin', 'codes', game.id, batch], queryFn: () => api.gifts.codes(game.id, batch || undefined) });
  const batches = [...new Set((codes.data ?? []).map((c) => c.batch).filter(Boolean))];

  const create = async () => {
    try {
      await api.gifts.createCodes(game.id, { ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null });
      toast.success(t('admin.codes.created', { count: form.count }));
      void codes.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card title={t('admin.codes.generate')}>
        <p className="mb-3 text-sm text-muted">{t(game.visibility === 'RESTRICTED' ? 'admin.codes.hintRestricted' : 'admin.codes.hint')}</p>
        <form
          className="grid gap-3 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label={t('admin.codes.count')}>
            <Input type="number" min={1} max={1000} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
          </Field>
          <Field label={t('admin.codes.batch')}>
            <Input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} maxLength={60} />
          </Field>
          <Field label={t('admin.codes.maxUses')}>
            <Input type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })} />
          </Field>
          <Field label={t('admin.codes.expires')}>
            <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />}>
              {t('admin.codes.create')}
            </Button>
          </div>
          <Field label={t('admin.codes.note')} className="sm:col-span-5">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} />
          </Field>
        </form>
      </Card>

      <Card
        title={t('admin.codes.list', { count: codes.data?.length ?? 0 })}
        actions={
          <div className="flex gap-2">
            <Select className="w-auto" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {batches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
            <a href={api.gifts.exportUrl(game.id, batch || undefined)} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-3 text-sm hover:bg-border" download>
              <Download className="size-4" /> CSV
            </a>
          </div>
        }
      >
        {codes.isLoading ? (
          <Spinner />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted uppercase">
                <tr>
                  <th className="py-2">{t('admin.codes.code')}</th>
                  <th>{t('admin.codes.batch')}</th>
                  <th>{t('admin.codes.uses')}</th>
                  <th>{t('admin.codes.expires')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {codes.data?.map((c) => (
                  <tr key={c.id} className={c.revoked ? 'opacity-50' : ''}>
                    <td className="py-1.5 font-mono">{c.code}</td>
                    <td>{c.batch}</td>
                    <td>
                      {c.uses}/{c.maxUses}
                    </td>
                    <td>{c.expiresAt ? formatDate(c.expiresAt) : '—'}</td>
                    <td className="text-right">
                      {c.revoked && <Badge tone="danger">{t('admin.codes.revoked')}</Badge>}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={c.revoked ? <RotateCcw className="size-4" /> : <Ban className="size-4" />}
                        title={c.revoked ? t('admin.codes.restore') : t('admin.codes.revoke')}
                        onClick={async () => {
                          await api.gifts.revokeCode(game.id, c.id, !c.revoked);
                          void codes.refetch();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
