import clsx from 'clsx';
import { Gamepad2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GameSummary } from '@gameserver/shared';
import { api } from '../lib/api';
import { PlatformIcons } from './PlatformIcons';

export function GameCover({ game, className, landscape }: { game: Pick<GameSummary, 'title' | 'coverUrl' | 'headerUrl'>; className?: string; landscape?: boolean }) {
  const src = landscape ? (game.headerUrl ?? game.coverUrl) : (game.coverUrl ?? game.headerUrl);
  return (
    <div className={clsx('relative overflow-hidden bg-surface-2', landscape ? 'aspect-[46/21]' : 'aspect-[2/3]', className)}>
      {src ? (
        <img src={api.url(src)} alt={game.title} loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-2 to-border p-3 text-center">
          <Gamepad2 className="size-8 text-muted" />
          <span className="line-clamp-3 text-sm font-semibold">{game.title}</span>
        </div>
      )}
    </div>
  );
}

export function GameCard({ game, landscape, footer }: { game: GameSummary; landscape?: boolean; footer?: React.ReactNode }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg">
      <Link to={`/game/${game.slug}`} className="block">
        <GameCover game={game} landscape={landscape} className="transition group-hover:brightness-110" />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link to={`/game/${game.slug}`} className="line-clamp-1 font-semibold hover:text-accent">
          {game.title}
        </Link>
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="line-clamp-1">{game.genres.map((g) => g.name).join(', ') || game.developer || ' '}</span>
          <PlatformIcons platforms={game.platforms} />
        </div>
        {footer}
      </div>
    </div>
  );
}

export function GameGrid({ games, landscape }: { games: GameSummary[]; landscape?: boolean }) {
  return (
    <div
      className={clsx(
        'grid gap-4',
        landscape ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
      )}
    >
      {games.map((g) => (
        <GameCard key={g.id} game={g} landscape={landscape} />
      ))}
    </div>
  );
}

/** Horizontale, scrollbare Reihe von Spielen. */
export function GameRow({ title, hint, games, action }: { title: string; hint?: string; games: GameSummary[]; action?: React.ReactNode }) {
  if (games.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold uppercase tracking-wide">{title}</h2>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="scrollbar-thin -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
        {games.map((g) => (
          <div key={g.id} className="w-40 shrink-0 snap-start sm:w-48">
            <GameCard game={g} />
          </div>
        ))}
      </div>
    </section>
  );
}
