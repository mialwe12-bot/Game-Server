import clsx from 'clsx';
import { Apple, Terminal } from 'lucide-react';
import type { Platform } from '@gameserver/shared';

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 5.5 10.5 4.5v7H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
    </svg>
  );
}

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  const cls = clsx('size-4', className);
  if (platform === 'WINDOWS') return <WindowsIcon className={cls} />;
  if (platform === 'MACOS') return <Apple className={cls} />;
  return <Terminal className={cls} />;
}

export function PlatformIcons({ platforms, className }: { platforms: Platform[]; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-muted', className)}>
      {platforms.map((p) => (
        <span key={p} title={p}>
          <PlatformIcon platform={p} />
        </span>
      ))}
    </span>
  );
}
