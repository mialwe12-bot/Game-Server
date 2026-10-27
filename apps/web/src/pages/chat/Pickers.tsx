import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GifResult } from '@gameserver/shared';
import { Input, Spinner } from '../../components/ui';
import { api } from '../../lib/api';

const EMOJI_GROUPS: { id: string; emojis: string }[] = [
  { id: 'smileys', emojis: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖' },
  { id: 'gestures', emojis: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 💪 👏 🙌 👐 🤲 ✍️ 💅 👀 🧠 🫶' },
  { id: 'hearts', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊' },
  { id: 'gaming', emojis: '🎮 🕹️ 👾 🎲 ♟️ 🎯 🏆 🥇 🥈 🥉 🏅 🎖️ ⚔️ 🗡️ 🛡️ 🏹 🔫 💣 🧨 🪄 🔮 🧩 🃏 🀄 🚀 🛸 🏎️ 🏁 🐉 🧙 🧝 🧟 🧛 🦄 🐺 🐱 🐶' },
  { id: 'objects', emojis: '☕ 🍕 🍔 🍟 🌭 🍿 🍩 🍪 🎂 🍺 🍻 🥤 💻 🖥️ ⌨️ 🖱️ 🎧 🎤 📷 📺 💡 🔧 🔨 ⚙️ 📦 📅 ⏰ 💰 🔑 🔒' },
];

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id);
  const ref = useOutside(onClose);
  const current = EMOJI_GROUPS.find((g) => g.id === group)!;
  return (
    <div ref={ref} className="absolute bottom-full left-0 z-30 mb-2 w-80 rounded-lg border border-border bg-surface p-2 shadow-xl">
      <div className="mb-2 flex gap-1 border-b border-border pb-2">
        {EMOJI_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            className={clsx('rounded px-2 py-1 text-lg', g.id === group ? 'bg-accent/15' : 'hover:bg-surface-2')}
            title={t(`social.chat.emoji.${g.id}`)}
          >
            {g.emojis.split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
        {current.emojis.split(' ').map((e) => (
          <button key={e} type="button" className="rounded p-1 text-xl hover:bg-surface-2" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GifPicker({ onPick, onClose }: { onPick: (g: GifResult) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const ref = useOutside(onClose);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(timer);
  }, [q]);
  const gifs = useQuery({ queryKey: ['gifs', query], queryFn: () => api.chat.gifs(query), staleTime: 5 * 60_000 });
  return (
    <div ref={ref} className="absolute bottom-full left-0 z-30 mb-2 w-96 max-w-[90vw] rounded-lg border border-border bg-surface p-2 shadow-xl">
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('social.chat.gifSearch')} />
      <div className="mt-2 grid max-h-72 grid-cols-3 gap-1 overflow-y-auto">
        {gifs.isLoading && <Spinner />}
        {gifs.data?.map((g) => (
          <button key={g.id} type="button" onClick={() => onPick(g)} className="overflow-hidden rounded hover:ring-2 hover:ring-accent">
            <img src={g.previewUrl} alt="" className="h-24 w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      <p className="mt-1 text-right text-[10px] text-muted">Powered by Tenor</p>
    </div>
  );
}

function useOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    const timer = setTimeout(() => document.addEventListener('mousedown', handler));
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onOutside]);
  return ref;
}
