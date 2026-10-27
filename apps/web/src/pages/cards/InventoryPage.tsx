import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, Hammer, Store, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CardItemDto, GameCardSet, MarketListingDto, TradeOfferDto } from '@gameserver/shared';
import { UserLink } from '../../components/Social';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageLoader, ProgressBar, Select, Tabs } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useWsEvent } from '../../lib/events';
import { formatDateTime, formatPlaytime } from '../../lib/format';
import { toast } from '../../lib/toast';
import { LevelBadge, TradingCardView } from './CardView';

type Tab = 'sets' | 'cards' | 'trades' | 'market';

export default function InventoryPage() {
  const { tab: tabParam } = useParams();
  const { t } = useTranslation();
  const { settings } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tab = (tabParam as Tab) || 'sets';
  const inv = useQuery({ queryKey: ['cards', 'inventory'], queryFn: () => api.cards.inventory() });
  useWsEvent((e) => {
    if (e.type === 'inventory.changed') void qc.invalidateQueries({ queryKey: ['cards'] });
  });

  if (inv.isLoading) return <PageLoader />;
  if (inv.error) return <ErrorState error={inv.error} />;
  const data = inv.data!;
  const lv = data.level;
  const market = settings?.features.market ?? false;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{t('cards.title')}</h1>
        <div className="ml-auto flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2">
          <LevelBadge level={lv.level} />
          <div className="w-48">
            <p className="text-xs text-muted">{t('cards.levelProgress', { xp: lv.xp - lv.levelXp, needed: lv.nextLevelXp - lv.levelXp })}</p>
            <ProgressBar value={(lv.xp - lv.levelXp) / (lv.nextLevelXp - lv.levelXp)} />
          </div>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => navigate(v === 'sets' ? '/inventory' : `/inventory/${v}`)}
        tabs={[
          { id: 'sets', label: t('cards.tabs.sets') },
          { id: 'cards', label: `${t('cards.tabs.cards')} (${data.items.length})` },
          ...(market
            ? [
                { id: 'trades' as const, label: t('cards.tabs.trades') },
                { id: 'market' as const, label: t('cards.tabs.market') },
              ]
            : []),
        ]}
      />
      {tab === 'sets' && <Sets sets={data.sets} />}
      {tab === 'cards' && <Cards items={data.items} market={market} />}
      {tab === 'trades' && market && <Trades />}
      {tab === 'market' && market && <Market sets={data.sets} />}
    </div>
  );
}

function Sets({ sets }: { sets: GameCardSet[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const craft = useMutation({
    mutationFn: (gameId: string) => api.cards.craft(gameId),
    onSuccess: (r) => {
      toast.success(t('cards.crafted', { level: r.level, profile: r.profile.level }));
      void qc.invalidateQueries({ queryKey: ['cards'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!sets.length) return <EmptyState title={t('cards.noSets')}>{t('cards.noSetsHint')}</EmptyState>;
  return (
    <div className="space-y-4">
      {sets.map((s) => (
        <Card
          key={s.game.id}
          title={
            <Link to={`/game/${s.game.slug}`} className="hover:text-accent">
              {s.game.title}
            </Link>
          }
          actions={
            <div className="flex items-center gap-2">
              {s.badgeLevel > 0 && <Badge tone="accent">{t('cards.badgeLevel', { level: s.badgeLevel })}</Badge>}
              <Button size="sm" variant="primary" icon={<Hammer className="size-4" />} disabled={!s.canCraft} loading={craft.isPending} onClick={() => craft.mutate(s.game.id)}>
                {t('cards.craft')}
              </Button>
            </div>
          }
        >
          <p className="mb-3 text-xs text-muted">
            {t('cards.drops', { received: s.drops.received, max: s.drops.max })}
            {s.drops.nextInSeconds !== null && ` · ${t('cards.nextDrop', { time: formatPlaytime(s.drops.nextInSeconds) })}`}
          </p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {s.cards.map((c) => (
              <TradingCardView key={c.id} card={c} count={c.owned} dimmed={c.owned === 0} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Cards({ items, market }: { items: CardItemDto[]; market: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [listing, setListing] = useState<CardItemDto | null>(null);
  const [want, setWant] = useState('');
  const sets = useQuery({ queryKey: ['cards', 'inventory'], queryFn: () => api.cards.inventory() });
  const allCards = sets.data?.sets.flatMap((s) => s.cards.map((c) => ({ ...c, game: s.game }))) ?? [];
  if (!items.length) return <EmptyState title={t('cards.noCards')}>{t('cards.noSetsHint')}</EmptyState>;
  return (
    <>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
        {items.map((i) => (
          <div key={i.id} className="space-y-1">
            <TradingCardView card={i.card} gameTitle={i.game.title} foil={i.foil} locked={i.locked} />
            {market && !i.locked && (
              <Button size="sm" className="w-full" icon={<Tag className="size-3.5" />} onClick={() => (setListing(i), setWant(''))}>
                {t('cards.offer')}
              </Button>
            )}
          </div>
        ))}
      </div>
      <Modal open={!!listing} onClose={() => setListing(null)} title={t('cards.offerTitle')}>
        {listing && (
          <div className="space-y-3">
            <div className="w-32">
              <TradingCardView card={listing.card} gameTitle={listing.game.title} foil={listing.foil} />
            </div>
            <p className="text-sm text-muted">{t('cards.offerHint')}</p>
            <Select value={want} onChange={(e) => setWant(e.target.value)}>
              <option value="">—</option>
              {allCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.game.title}: {c.name}
                </option>
              ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setListing(null)}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                disabled={!want}
                onClick={async () => {
                  try {
                    await api.cards.list(listing.id, want);
                    toast.success(t('cards.listed'));
                    setListing(null);
                    void qc.invalidateQueries({ queryKey: ['cards'] });
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                {t('cards.offer')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function OfferRow({ o }: { o: TradeOfferDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ['cards'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const other = o.direction === 'incoming' ? o.from : o.to;
  const side = (items: CardItemDto[], label: string) => (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="grid grid-cols-4 gap-2">
        {items.map((i) => (
          <TradingCardView key={i.id} card={i.card} gameTitle={i.game.title} foil={i.foil} />
        ))}
        {!items.length && <span className="text-xs text-muted">—</span>}
      </div>
    </div>
  );
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {o.direction === 'incoming' ? t('cards.tradeFrom') : t('cards.tradeTo')} <UserLink user={other} />
        </span>
      }
      actions={
        o.status === 'PENDING' ? (
          o.direction === 'incoming' ? (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => void run(() => api.cards.acceptTrade(o.id))}>
                {t('social.friends.accept')}
              </Button>
              <Button size="sm" icon={<X className="size-4" />} onClick={() => void run(() => api.cards.declineTrade(o.id))}>
                {t('social.friends.decline')}
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => void run(() => api.cards.cancelTrade(o.id))}>
              {t('social.friends.withdraw')}
            </Button>
          )
        ) : (
          <Badge tone={o.status === 'ACCEPTED' ? 'success' : 'default'}>{t(`cards.status.${o.status}`)}</Badge>
        )
      }
    >
      {o.message && <p className="mb-2 text-sm italic">„{o.message}“</p>}
      <div className="flex flex-col gap-4 sm:flex-row">
        {side(o.direction === 'incoming' ? o.give : o.receive, t('cards.youGet'))}
        <ArrowLeftRight className="hidden size-5 shrink-0 self-center text-muted sm:block" />
        {side(o.direction === 'incoming' ? o.receive : o.give, t('cards.youGive'))}
      </div>
      <p className="mt-2 text-xs text-muted">{formatDateTime(o.createdAt)}</p>
    </Card>
  );
}

function Trades() {
  const { t } = useTranslation();
  const trades = useQuery({ queryKey: ['cards', 'trades'], queryFn: () => api.cards.trades() });
  if (trades.isLoading) return <PageLoader />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('cards.tradeHint')}</p>
      {trades.data?.length ? trades.data.map((o) => <OfferRow key={o.id} o={o} />) : <EmptyState title={t('cards.noTrades')} />}
    </div>
  );
}

function Market({ sets }: { sets: GameCardSet[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [gameId, setGameId] = useState('');
  const [onlyFulfillable, setOnlyFulfillable] = useState(false);
  const listings = useQuery({
    queryKey: ['cards', 'market', gameId, onlyFulfillable],
    queryFn: () => api.cards.market({ gameId: gameId || undefined, fulfillable: onlyFulfillable || undefined }),
  });
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      if (msg) toast.success(msg);
      void qc.invalidateQueries({ queryKey: ['cards'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const row = (l: MarketListingDto) => (
    <li key={l.id} className="flex flex-wrap items-center gap-4 py-3">
      <div className="w-20">
        <TradingCardView card={l.item.card} gameTitle={l.item.game.title} foil={l.item.foil} />
      </div>
      <ArrowLeftRight className="size-5 text-muted" />
      <div className="w-20">
        <TradingCardView card={l.wantCard} gameTitle={l.wantCard.game.title} dimmed={!l.canFulfil && !l.mine} />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p>
          {t('cards.listingBy')} <UserLink user={l.seller} />
        </p>
        <p className="text-xs text-muted">
          {t('cards.listingWants', { card: l.wantCard.name, game: l.wantCard.game.title })} · {formatDateTime(l.createdAt)}
        </p>
      </div>
      {l.mine ? (
        <Button size="sm" onClick={() => void run(() => api.cards.unlist(l.id))}>
          {t('social.friends.withdraw')}
        </Button>
      ) : (
        <Button size="sm" variant="primary" disabled={!l.canFulfil} onClick={() => void run(() => api.cards.fulfil(l.id), t('cards.traded'))}>
          {t('cards.fulfil')}
        </Button>
      )}
    </li>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Store className="size-5 text-muted" />
        <Select className="w-auto" value={gameId} onChange={(e) => setGameId(e.target.value)}>
          <option value="">{t('common.all')}</option>
          {sets.map((s) => (
            <option key={s.game.id} value={s.game.id}>
              {s.game.title}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyFulfillable} onChange={(e) => setOnlyFulfillable(e.target.checked)} />
          {t('cards.onlyFulfillable')}
        </label>
      </div>
      <p className="text-sm text-muted">{t('cards.marketHint')}</p>
      {listings.data?.length ? <Card><ul className="divide-y divide-border">{listings.data.map(row)}</ul></Card> : <EmptyState title={t('cards.noListings')} />}
    </div>
  );
}
