import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedGame } from '@gameserver/shared';
import { Button, Card, ConfirmButton, EmptyState, Input, Spinner } from '../../../components/ui';
import { TradingCardView } from '../../cards/CardView';
import { api, errorMessage } from '../../../lib/api';
import { toast } from '../../../lib/toast';

/** Sammelkarten eines Spiels (max. 15). Drops erhalten Spieler nach Spielzeit, ein halbes Set pro Spiel. */
export function CardsTab({ game }: { game: ManagedGame }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['admin', 'cards', game.id];
  const cards = useQuery({ queryKey: key, queryFn: () => api.cards.manage(game.id) });
  const [name, setName] = useState('');
  const [imageFor, setImageFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      qc.setQueryData(key, await fn());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (cards.isLoading) return <Spinner />;
  const list = cards.data ?? [];
  return (
    <Card title={t('admin.cards.title', { count: list.length })}>
      <p className="mb-4 text-sm text-muted">{t('admin.cards.hint')}</p>
      {list.length === 0 && <EmptyState title={t('admin.cards.empty')} />}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((c) => (
          <div key={c.id} className="space-y-2">
            <TradingCardView card={c} gameTitle={game.title} />
            <Input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && void run(() => api.cards.renameCard(game.id, c.id, e.target.value))} className="text-xs" />
            <p className="text-xs text-muted">{t('admin.cards.circulation', { count: c.inCirculation })}</p>
            <div className="flex gap-1">
              <Button size="sm" icon={<ImagePlus className="size-4" />} onClick={() => (setImageFor(c.id), fileRef.current?.click())}>
                {t('admin.cards.image')}
              </Button>
              <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void run(() => api.cards.deleteCard(game.id, c.id))} />
            </div>
          </div>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && imageFor) void run(() => api.cards.uploadCardImage(game.id, imageFor, f));
        }}
      />
      {list.length < 15 && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.cards.createCard(game.id, name)).then(() => setName(''));
          }}
        >
          <Input className="w-auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.cards.name')} required maxLength={80} />
          <Button type="submit" icon={<Plus className="size-4" />}>
            {t('common.add')}
          </Button>
        </form>
      )}
    </Card>
  );
}
