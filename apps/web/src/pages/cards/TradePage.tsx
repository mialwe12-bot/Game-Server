import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { CardItemDto } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Button, Card, ErrorState, Input, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { toast } from '../../lib/toast';
import { TradingCardView } from './CardView';

/** Tauschangebot an einen Nutzer zusammenstellen */
export default function TradePage() {
  const { username = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ['profile', username.toLowerCase()], queryFn: () => api.profiles.get(username) });
  const theirs = useQuery({ queryKey: ['cards', 'user', username], queryFn: () => api.cards.userItems(username) });
  const mine = useQuery({ queryKey: ['cards', 'inventory'], queryFn: () => api.cards.inventory() });
  const [give, setGive] = useState<string[]>([]);
  const [receive, setReceive] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: () => api.cards.offer(profile.data!.user.id, give, receive, message),
    onSuccess: () => {
      toast.success(t('cards.offerSent'));
      navigate('/inventory/trades');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (profile.isLoading || theirs.isLoading || mine.isLoading) return <PageLoader />;
  if (profile.error || theirs.error) return <ErrorState error={profile.error ?? theirs.error} />;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const grid = (items: CardItemDto[], selected: string[], set: (v: string[]) => void) =>
    items.length ? (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {items.map((i) => (
          <TradingCardView
            key={i.id}
            card={i.card}
            gameTitle={i.game.title}
            foil={i.foil}
            locked={i.locked}
            selected={selected.includes(i.id)}
            dimmed={i.locked}
            onClick={i.locked ? undefined : () => toggle(selected, set, i.id)}
          />
        ))}
      </div>
    ) : (
      <p className="text-sm text-muted">{t('cards.noCards')}</p>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="flex items-center gap-3 text-2xl font-bold">
        <ArrowLeftRight className="size-6" />
        {t('cards.tradeWith')}
        <Avatar user={profile.data!.user} size={32} />
        {profile.data!.user.displayName || profile.data!.user.username}
      </h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('cards.youGive') + ` (${give.length})`}>{grid(mine.data!.items, give, setGive)}</Card>
        <Card title={t('cards.youGet') + ` (${receive.length})`}>{grid(theirs.data!, receive, setReceive)}</Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-auto flex-1" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('cards.messagePlaceholder')} maxLength={500} />
        <Button variant="primary" icon={<Send className="size-4" />} disabled={!give.length && !receive.length} loading={send.isPending} onClick={() => send.mutate()}>
          {t('cards.sendOffer')}
        </Button>
      </div>
    </div>
  );
}
