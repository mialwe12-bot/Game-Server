import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, KeyRound, PackageOpen, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { GiftDto } from '@gameserver/shared';
import { UserLink } from '../../components/Social';
import { Badge, Button, Card, EmptyState, Input, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

/** Geschenke annehmen/ansehen und Aktivierungscodes einlösen */
export default function GiftsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const gifts = useQuery({ queryKey: ['gifts'], queryFn: () => api.gifts.list() });
  const [code, setCode] = useState('');
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      if (msg) toast.success(msg);
      void qc.invalidateQueries({ queryKey: ['gifts'] });
      void qc.invalidateQueries({ queryKey: ['library'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const row = (g: GiftDto, received: boolean) => (
    <li key={g.id} className="flex flex-wrap items-center gap-3 py-3">
      <Gift className="size-6 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          <Link to={`/game/${g.game.slug}`} className="font-semibold hover:text-accent">
            {g.game.title}
          </Link>{' '}
          {received ? (
            <>
              {t('gifts.from')} {g.from ? <UserLink user={g.from} /> : '—'}
            </>
          ) : (
            <>
              {t('gifts.to')} <UserLink user={g.to} />
            </>
          )}
        </p>
        {g.message && <p className="text-muted italic">„{g.message}“</p>}
        <p className="text-xs text-muted">{formatDateTime(g.createdAt)}</p>
      </div>
      {g.opened ? (
        <Badge tone="success">{t('gifts.opened')}</Badge>
      ) : received ? (
        <>
          <Button size="sm" variant="primary" icon={<PackageOpen className="size-4" />} onClick={() => void run(() => api.gifts.accept(g.id), t('gifts.accepted'))}>
            {t('gifts.accept')}
          </Button>
          <Button size="sm" icon={<X className="size-4" />} onClick={() => void run(() => api.gifts.remove(g.id))}>
            {t('social.friends.decline')}
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => void run(() => api.gifts.remove(g.id))}>
          {t('social.friends.withdraw')}
        </Button>
      )}
    </li>
  );
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('gifts.title')}</h1>
      <Card title={t('gifts.redeem')}>
        <p className="mb-3 text-sm text-muted">{t('gifts.redeemHint')}</p>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.gifts.redeem(code);
              toast.success(t('gifts.redeemed', { title: r.game.title }));
              setCode('');
              navigate(`/game/${r.game.slug}`);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX-XXXXX" className="font-mono" required minLength={5} />
          <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />}>
            {t('gifts.redeemButton')}
          </Button>
        </form>
      </Card>
      {gifts.isLoading ? (
        <PageLoader />
      ) : (
        <>
          <Card title={t('gifts.received')}>
            {gifts.data?.received.length ? <ul className="divide-y divide-border">{gifts.data.received.map((g) => row(g, true))}</ul> : <EmptyState title={t('gifts.none')} />}
          </Card>
          <Card title={t('gifts.sent')}>
            {gifts.data?.sent.length ? <ul className="divide-y divide-border">{gifts.data.sent.map((g) => row(g, false))}</ul> : <EmptyState title={t('gifts.noneSent')} />}
          </Card>
        </>
      )}
    </div>
  );
}
