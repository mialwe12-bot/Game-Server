// Formatierungshilfen für Web und Desktop-Client.

export function formatBytes(bytes: number, locale = 'de'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toLocaleString(locale, { maximumFractionDigits: i === 0 ? 0 : value < 10 ? 2 : 1 })} ${units[i]}`;
}

export function formatPlaytime(seconds: number, locale = 'de'): string {
  if (seconds < 60) return locale.startsWith('de') ? 'unter 1 Min.' : 'under 1 min';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} ${locale.startsWith('de') ? 'Min.' : 'min'}`;
  return `${hours.toLocaleString(locale, { maximumFractionDigits: 1 })} ${locale.startsWith('de') ? 'Std.' : 'h'}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Wandelt YouTube-Links in datenschutzfreundliche Embed-URLs um. */
export function trailerEmbed(url: string): { type: 'youtube'; src: string } | { type: 'video'; src: string } | null {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname.endsWith('youtube.com')) id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null);
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    if (id && /^[\w-]{6,20}$/.test(id)) return { type: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` };
    if (/\.(mp4|webm)$/i.test(u.pathname) && (u.protocol === 'https:' || u.protocol === 'http:')) return { type: 'video', src: url };
    return null;
  } catch {
    return null;
  }
}
