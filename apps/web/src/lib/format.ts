import { formatBytes as fb, formatPlaytime as fp } from '@gameserver/shared';
import i18n from '../i18n';

export const formatBytes = (b: number) => fb(b, i18n.language);
export const formatPlaytime = (s: number) => fp(s, i18n.language);
export const formatDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
  iso ? new Date(iso).toLocaleDateString(i18n.language, opts) : '–';
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : '–';
