import clsx from 'clsx';
import { api } from '../lib/api';

export function Avatar({ user, size = 32, className }: { user: { username: string; avatarUrl: string | null; displayName?: string | null }; size?: number; className?: string }) {
  const name = user.displayName || user.username;
  if (user.avatarUrl) {
    return (
      <img
        src={api.url(user.avatarUrl)}
        alt={name}
        width={size}
        height={size}
        className={clsx('shrink-0 rounded-md object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const hue = [...user.username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span
      aria-label={name}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white', className)}
      style={{ width: size, height: size, background: `hsl(${hue} 45% 40%)`, fontSize: size * 0.45 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
