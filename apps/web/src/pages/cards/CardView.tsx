import clsx from 'clsx';
import { Lock, Sparkles } from 'lucide-react';
import type { TradingCardDto } from '@gameserver/shared';
import { api } from '../../lib/api';

/** Darstellung einer Sammelkarte (Bild oder Farbverlauf aus dem Namen) */
export function TradingCardView({
  card,
  gameTitle,
  foil = false,
  locked = false,
  count,
  selected = false,
  dimmed = false,
  onClick,
}: {
  card: Pick<TradingCardDto, 'name' | 'imageUrl'>;
  gameTitle?: string;
  foil?: boolean;
  locked?: boolean;
  count?: number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const hue = [...card.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'relative block aspect-[5/7] w-full overflow-hidden rounded-lg border-2 text-left shadow transition',
        selected ? 'border-accent ring-2 ring-accent' : foil ? 'border-warning' : 'border-border',
        dimmed && 'opacity-35 grayscale',
        onClick && 'hover:-translate-y-0.5 hover:shadow-lg',
      )}
    >
      {card.imageUrl ? (
        <img src={api.url(card.imageUrl)} alt={card.name} className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 40%), hsl(${(hue + 60) % 360} 55% 25%))` }} />
      )}
      {foil && <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/25 to-transparent mix-blend-overlay" />}
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1.5 text-white">
        <p className="truncate text-xs font-semibold">{card.name}</p>
        {gameTitle && <p className="truncate text-[10px] opacity-80">{gameTitle}</p>}
      </div>
      {foil && <Sparkles className="absolute top-1.5 right-1.5 size-4 text-warning drop-shadow" />}
      {locked && <Lock className="absolute top-1.5 left-1.5 size-4 text-white drop-shadow" />}
      {count !== undefined && count > 1 && (
        <span className="absolute top-1.5 right-1.5 rounded-full bg-black/70 px-1.5 text-xs font-bold text-white">×{count}</span>
      )}
    </Comp>
  );
}

/** Profil-Level-Plakette */
export function LevelBadge({ level, className }: { level: number; className?: string }) {
  const colors = ['#8a8a8a', '#c02942', '#d95b43', '#ecd078', '#53777a', '#542437', '#a38b6e', '#6a4a3c', '#3f7a5d', '#4d6aa8'];
  const color = colors[Math.floor(level / 10) % colors.length];
  return (
    <span
      className={clsx('inline-flex size-9 items-center justify-center rounded-full border-2 text-sm font-bold', className)}
      style={{ borderColor: color, color }}
      title={`Level ${level}`}
    >
      {level}
    </span>
  );
}
