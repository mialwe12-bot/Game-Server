import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BellOff,
  Bell,
  Hash,
  ImagePlus,
  LogOut,
  MessageSquarePlus,
  Mic,
  MicOff,
  Pencil,
  PhoneCall,
  PhoneOff,
  Send,
  Smile,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatConfig, ConversationDto, MessageDto } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Button, EmptyState, Input, Modal, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useWsEvent } from '../../lib/events';
import { formatDate } from '../../lib/format';
import { setActiveConversation } from '../../lib/social';
import { toast } from '../../lib/toast';
import { EmojiPicker, GifPicker } from './Pickers';
import { voice } from './voice';

type MessagePages = InfiniteData<MessageDto[], string | undefined>;

function useVoice() {
  return useSyncExternalStore(
    (l) => voice.subscribe(l),
    () => voice.state,
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Links im Fließtext klickbar machen (ohne HTML-Interpretation) */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline break-all">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** `basePath` erlaubt die Einbettung im Overlay-Fenster (eigene Routen) */
export default function ChatPage({ basePath = '/chat', compact = false }: { basePath?: string; compact?: boolean } = {}) {
  const { id } = useParams();
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const conversations = useQuery({ queryKey: ['chat', 'conversations'], queryFn: () => api.chat.conversations() });
  const config = useQuery({ queryKey: ['chat', 'config'], queryFn: () => api.chat.config(), staleTime: 10 * 60_000 });
  const v = useVoice();

  return (
    <div
      className={clsx(
        'grid overflow-hidden rounded-lg border border-border bg-surface',
        compact ? 'h-full md:grid-cols-[220px_1fr]' : '-my-2 h-[calc(100vh-10rem)] min-h-[480px] md:grid-cols-[300px_1fr]',
      )}
    >
      <aside className={clsx('flex min-h-0 flex-col border-r border-border', id && 'hidden md:flex')}>
        <div className="flex items-center justify-between border-b border-border p-3">
          <h1 className="font-semibold">{t('social.chat.title')}</h1>
          <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="size-4" />} onClick={() => setCreating(true)} title={t('social.chat.newGroup')} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.isLoading && <Spinner className="m-4" />}
          {conversations.data?.length === 0 && <p className="p-4 text-sm text-muted">{t('social.chat.noConversations')}</p>}
          {conversations.data?.map((c) => (
            <Link
              key={c.id}
              to={`${basePath}/${c.id}`}
              className={clsx('flex items-center gap-3 border-b border-border px-3 py-2.5 hover:bg-surface-2', c.id === id && 'bg-accent/10')}
            >
              {c.type === 'CHANNEL' ? (
                <span className="flex size-10 items-center justify-center rounded-md bg-surface-2">
                  <Hash className="size-5 text-muted" />
                </span>
              ) : c.type === 'GROUP' ? (
                <span className="flex size-10 items-center justify-center rounded-md bg-surface-2">
                  <Users className="size-5 text-muted" />
                </span>
              ) : (
                <Avatar user={{ username: c.title, avatarUrl: c.avatarUrl }} size={40} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className={clsx('truncate text-sm', c.unread > 0 && 'font-semibold')}>{c.title}</span>
                  {c.muted && <BellOff className="size-3 shrink-0 text-muted" />}
                  {(v.participants[c.id]?.length ?? 0) > 0 && <PhoneCall className="size-3 shrink-0 text-success" />}
                </div>
                <p className="truncate text-xs text-muted">
                  {c.lastMessage ? (c.lastMessage.deleted ? t('social.chat.deleted') : c.lastMessage.body || (c.lastMessage.gifUrl ? 'GIF' : t('social.chat.image'))) : ''}
                </p>
              </div>
              {c.unread > 0 && <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">{c.unread}</span>}
            </Link>
          ))}
        </div>
      </aside>
      <section className={clsx('min-h-0 flex-col', id ? 'flex' : 'hidden md:flex')}>
        {id && config.data ? (
          <ConversationView key={id} id={id} config={config.data} basePath={basePath} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState title={t('social.chat.pick')}>
              <Link to="/friends" className="text-sm text-accent hover:underline">
                {t('nav.friends')}
              </Link>
            </EmptyState>
          </div>
        )}
      </section>
      {creating && <NewGroupChatModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function ConversationView({ id, config, basePath }: { id: string; config: ChatConfig; basePath: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const v = useVoice();
  const conv = useQuery({ queryKey: ['chat', 'conversation', id], queryFn: () => api.chat.conversation(id) });
  const messages = useInfiniteQuery({
    queryKey: ['chat', 'messages', id],
    queryFn: ({ pageParam }) => api.chat.messages(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length >= 50 ? last[last.length - 1].createdAt : undefined),
  });
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [manage, setManage] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void api.chat.read(id).then(() => {
          void qc.invalidateQueries({ queryKey: ['chat', 'unread'] });
          void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        });
      }, 400);
    };
  }, [id, qc]);

  useEffect(() => {
    setActiveConversation(id);
    markRead();
    return () => setActiveConversation(null);
  }, [id, markRead]);

  useWsEvent((e) => {
    if ((e.type === 'chat.message' || e.type === 'chat.message.updated') && e.data.conversationId === id) {
      qc.setQueryData<MessagePages>(['chat', 'messages', id], (old) => {
        if (!old) return old;
        const exists = old.pages.some((p) => p.some((m) => m.id === e.data.id));
        if (exists) return { ...old, pages: old.pages.map((p) => p.map((m) => (m.id === e.data.id ? e.data : m))) };
        if (e.type === 'chat.message.updated') return old;
        return { ...old, pages: [[e.data, ...old.pages[0]], ...old.pages.slice(1)] };
      });
      if (e.type === 'chat.message' && e.data.author) {
        setTyping((tp) => {
          const next = { ...tp };
          delete next[e.data.author!.id];
          return next;
        });
      }
      if (!document.hidden) markRead();
    } else if (e.type === 'chat.typing' && e.data.conversationId === id) {
      setTyping((tp) => ({ ...tp, [e.data.userId]: { name: e.data.username, until: Date.now() + 4000 } }));
    } else if (e.type === 'chat.conversation' && e.data.conversationId === id) {
      void conv.refetch();
    }
  });

  useEffect(() => {
    const timer = setInterval(() => setTyping((tp) => Object.fromEntries(Object.entries(tp).filter(([, v2]) => v2.until > Date.now()))), 1000);
    return () => clearInterval(timer);
  }, []);

  const list = useMemo(() => (messages.data?.pages.flat() ?? []).slice().reverse(), [messages.data]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [list.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && messages.hasNextPage && !messages.isFetchingNextPage) {
      const before = el.scrollHeight;
      void messages.fetchNextPage().then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - before)));
    }
  };

  if (conv.isLoading) return <Spinner className="m-6" />;
  if (conv.error || !conv.data) {
    return (
      <div className="p-6 text-sm text-muted">
        {errorMessage(conv.error)} · <Link to={basePath}>{t('common.back')}</Link>
      </div>
    );
  }
  const c = conv.data;
  const participants = v.participants[id] ?? [];
  const inThisCall = v.joined && v.conversationId === id;
  const memberName = (uid: string) => {
    const m = c.members.find((x) => x.id === uid);
    return m ? m.displayName || m.username : '…';
  };
  const typingNames = Object.entries(typing)
    .filter(([uid]) => uid !== user?.id)
    .map(([, v2]) => v2.name);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link to={basePath} className="text-sm text-accent md:hidden">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            {c.type === 'DIRECT' && c.members.find((m) => m.id !== user?.id) ? (
              <Link to={`/u/${c.members.find((m) => m.id !== user?.id)!.username}`} className="hover:text-accent">
                {c.title}
              </Link>
            ) : c.group ? (
              <Link to={`/groups/${c.group.slug}`} className="hover:text-accent">
                {c.title}
              </Link>
            ) : (
              c.title
            )}
          </h2>
          {c.type !== 'DIRECT' && <p className="text-xs text-muted">{t('social.chat.members', { count: c.members.length })}</p>}
        </div>
        {config.voiceEnabled && (
          <div className="flex items-center gap-1">
            {participants.length > 0 && !inThisCall && <span className="text-xs text-success">{t('social.voice.inCall', { count: participants.length })}</span>}
            {inThisCall ? (
              <>
                <Button size="sm" variant="ghost" icon={v.muted ? <MicOff className="size-4 text-danger" /> : <Mic className="size-4" />} onClick={() => voice.toggleMute()} title={t('social.voice.mute')} />
                <Button size="sm" variant="danger" icon={<PhoneOff className="size-4" />} onClick={() => void voice.leave()}>
                  {t('social.voice.leave')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={<PhoneCall className="size-4" />}
                title={t('social.voice.join')}
                onClick={() => void voice.join(id, user!.id, config.iceServers).catch((e) => toast.error(t('social.voice.micError', { error: errorMessage(e) })))}
              />
            )}
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={c.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          title={c.muted ? t('social.chat.unmute') : t('social.chat.mute')}
          onClick={async () => {
            await api.chat.update(id, { muted: !c.muted });
            void conv.refetch();
            void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
          }}
        />
        {c.type === 'GROUP' && <Button size="sm" variant="ghost" icon={<Users className="size-4" />} onClick={() => setManage(true)} title={t('social.chat.manage')} />}
      </header>
      {inThisCall && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-success/10 px-4 py-2 text-xs">
          <PhoneCall className="size-4 text-success" />
          {participants.map((uid) => (
            <span key={uid} className="rounded-full bg-surface px-2 py-0.5">
              {memberName(uid)}
              {uid !== user?.id && v.peers[uid] && v.peers[uid] !== 'connected' && <span className="ml-1 text-muted">({v.peers[uid]})</span>}
            </span>
          ))}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {messages.isFetchingNextPage && <Spinner className="mx-auto" />}
        {list.map((m, i) => {
          const prev = list[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = !newDay && prev?.author?.id === m.author?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="py-2 text-center text-xs text-muted">{formatDate(m.createdAt)}</div>}
              <MessageRow m={m} grouped={grouped} own={m.author?.id === user?.id} canModerate={c.canManage} />
            </Fragment>
          );
        })}
        {list.length === 0 && !messages.isLoading && <p className="py-10 text-center text-sm text-muted">{t('social.chat.empty')}</p>}
      </div>
      <div className="h-5 px-4 text-xs text-muted">{typingNames.length > 0 && t('social.chat.typing', { names: typingNames.join(', ') })}</div>
      <Composer id={id} config={config} onSent={() => (stickToBottom.current = true)} />
      {manage && c.type === 'GROUP' && <ManageGroupChatModal conv={c} onClose={() => setManage(false)} onLeft={() => navigate(basePath)} />}
    </>
  );
}

function MessageRow({ m, grouped, own, canModerate }: { m: MessageDto; grouped: boolean; own: boolean; canModerate: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [zoom, setZoom] = useState(false);
  const save = async () => {
    try {
      await api.chat.edit(m.id, draft.trim());
      setEditing(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className={clsx('group flex gap-3 rounded px-1 hover:bg-surface-2/60', grouped ? 'py-0.5' : 'mt-2 py-1')}>
      <div className="w-9 shrink-0">{!grouped && m.author && <Avatar user={m.author} size={36} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="text-sm">
            {m.author ? (
              <Link to={`/u/${m.author.username}`} className="font-semibold hover:underline">
                {m.author.displayName || m.author.username}
              </Link>
            ) : (
              <span className="text-muted">{t('social.chat.deletedUser')}</span>
            )}{' '}
            <span className="text-xs text-muted">{time(m.createdAt)}</span>
          </p>
        )}
        {m.deleted ? (
          <p className="text-sm text-muted italic">{t('social.chat.deleted')}</p>
        ) : editing ? (
          <div className="flex gap-2">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} autoFocus />
            <Button size="sm" variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <>
            {m.body && (
              <p className="text-sm break-words whitespace-pre-wrap">
                <Linkified text={m.body} />
                {m.editedAt && <span className="ml-1 text-xs text-muted">({t('social.chat.edited')})</span>}
              </p>
            )}
            {m.attachmentUrl && (
              <button type="button" onClick={() => setZoom(true)} className="mt-1 block">
                <img src={api.url(m.attachmentUrl)} alt="" className="max-h-72 max-w-full rounded-md border border-border" loading="lazy" />
              </button>
            )}
            {m.gifUrl && <img src={m.gifUrl} alt="GIF" className="mt-1 max-h-60 rounded-md" loading="lazy" referrerPolicy="no-referrer" />}
          </>
        )}
      </div>
      {!m.deleted && !editing && (own || canModerate) && (
        <div className="invisible flex shrink-0 items-start gap-1 group-hover:visible">
          {own && m.body && (
            <button type="button" className="rounded p-1 text-muted hover:text-fg" onClick={() => setEditing(true)} aria-label={t('common.edit')}>
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            className="rounded p-1 text-muted hover:text-danger"
            onClick={() => window.confirm(t('social.chat.confirmDelete')) && void api.chat.remove(m.id).catch((e) => toast.error(errorMessage(e)))}
            aria-label={t('common.delete')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
      {zoom && m.attachmentUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(false)}>
          <img src={api.url(m.attachmentUrl)} alt="" className="max-h-full max-w-full rounded" />
        </div>
      )}
    </div>
  );
}

function Composer({ id, config, onSent }: { id: string; config: ChatConfig; onSent: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<'emoji' | 'gif' | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const closePicker = useCallback(() => setPicker(null), []);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api.chat.send(id, body);
      setText('');
      onSent();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const sendImage = async (file: File) => {
    if (file.size > config.maxImageBytes) {
      toast.error(t('social.chat.imageTooLarge'));
      return;
    }
    setBusy(true);
    try {
      await api.chat.sendImage(id, file, text.trim() || undefined);
      setText('');
      onSent();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void sendImage(file);
    }
  };

  return (
    <div className="relative flex items-end gap-2 border-t border-border p-3">
      {picker === 'emoji' && (
        <EmojiPicker
          onClose={closePicker}
          onPick={(emoji) => {
            setText((s) => s + emoji);
            inputRef.current?.focus();
          }}
        />
      )}
      {picker === 'gif' && (
        <GifPicker
          onClose={closePicker}
          onPick={async (g) => {
            setPicker(null);
            try {
              await api.chat.send(id, '', g.url);
              onSent();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />
      )}
      <Button size="sm" variant="ghost" icon={<Smile className="size-5" />} onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')} aria-label={t('social.chat.emojiButton')} />
      {config.gifsEnabled && (
        <Button size="sm" variant="ghost" onClick={() => setPicker(picker === 'gif' ? null : 'gif')} className="font-bold" aria-label="GIF">
          GIF
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={<ImagePlus className="size-5" />} onClick={() => fileRef.current?.click()} aria-label={t('social.chat.sendImage')} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void sendImage(f);
        }}
      />
      <textarea
        ref={inputRef}
        value={text}
        rows={1}
        maxLength={4000}
        onChange={(e) => {
          setText(e.target.value);
          if (Date.now() - lastTyping.current > 2000) {
            lastTyping.current = Date.now();
            api.wsSend({ type: 'chat.typing', data: { conversationId: id } });
          }
        }}
        onKeyDown={onKey}
        onPaste={onPaste}
        placeholder={t('social.chat.placeholder')}
        className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
      <Button variant="primary" icon={<Send className="size-4" />} loading={busy} disabled={!text.trim()} onClick={() => void send()} aria-label={t('social.chat.send')} />
    </div>
  );
}

function FriendPicker({ exclude, selected, onToggle }: { exclude: string[]; selected: string[]; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.friends.overview() });
  const list = friends.data?.friends.filter((f) => !exclude.includes(f.user.id)) ?? [];
  if (friends.isLoading) return <Spinner />;
  if (!list.length) return <p className="text-sm text-muted">{t('social.chat.noFriendsToAdd')}</p>;
  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto">
      {list.map((f) => (
        <li key={f.user.id}>
          <label className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-surface-2">
            <input type="checkbox" checked={selected.includes(f.user.id)} onChange={() => onToggle(f.user.id)} />
            <Avatar user={f.user} size={28} />
            {f.user.displayName || f.user.username}
          </label>
        </li>
      ))}
    </ul>
  );
}

function NewGroupChatModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => (selected.length === 1 && !title ? api.chat.direct(selected[0]) : api.chat.createGroup(selected, title || undefined)),
    onSuccess: (c: ConversationDto) => {
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      onClose();
      navigate(`/chat/${c.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={t('social.chat.newGroup')}>
      <div className="space-y-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('social.chat.groupTitle')} maxLength={80} />
        <FriendPicker exclude={[]} selected={selected} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!selected.length} loading={create.isPending} onClick={() => create.mutate()}>
            {t('common.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ManageGroupChatModal({ conv, onClose, onLeft }: { conv: ConversationDto; onClose: () => void; onLeft: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState(conv.title);
  const [adding, setAdding] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['chat'] });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal open onClose={onClose} title={t('social.chat.manage')}>
      <div className="space-y-4">
        {conv.canManage && (
          <div className="flex gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            <Button onClick={() => void run(() => api.chat.update(conv.id, { title }))}>{t('common.save')}</Button>
          </div>
        )}
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('social.chat.members', { count: conv.members.length })}</h3>
          <ul className="space-y-1">
            {conv.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <Avatar user={m} size={28} />
                <span className="flex-1">{m.displayName || m.username}</span>
                {conv.canManage && m.id !== user?.id && (
                  <Button size="sm" variant="ghost" onClick={() => void run(() => api.chat.removeMember(conv.id, m.id))}>
                    {t('common.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">
            <UserPlus className="size-4" />
            {t('social.chat.addMembers')}
          </h3>
          <FriendPicker exclude={conv.members.map((m) => m.id)} selected={adding} onToggle={(id) => setAdding((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
          {adding.length > 0 && (
            <Button className="mt-2" variant="primary" onClick={() => void run(() => api.chat.addMembers(conv.id, adding)).then(() => setAdding([]))}>
              {t('common.add')}
            </Button>
          )}
        </div>
        <div className="flex justify-end border-t border-border pt-3">
          <Button
            variant="danger"
            icon={<LogOut className="size-4" />}
            onClick={() =>
              void run(() => api.chat.removeMember(conv.id, user!.id)).then(() => {
                onClose();
                onLeft();
              })
            }
          >
            {t('social.chat.leave')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
