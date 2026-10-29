import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, MessageSquare, Network, Server } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { NetworkGameDto, RemoteBuildDto } from '@gameserver/shared';
import { PlatformIcon } from '../../components/PlatformIcons';
import { Badge, Button, Card, EmptyState, Input, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { toast } from '../../lib/toast';

/** Stufe 3: einen Nutzer auf einem verbundenen Server anschreiben (Netzwerk-DM). */
function NetworkDM() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const peers = useQuery({ queryKey: ['fed', 'peers'], queryFn: () => api.federation.peers() });
  const [serverId, setServerId] = useState('');
  const [username, setUsername] = useState('');
  const start = useMutation({
    mutationFn: async () => {
      const chosen = serverId || peers.data![0].id;
      const u = await api.network.lookupUser(chosen, username.trim());
      const conv = await api.chat.direct(u.userId);
      return conv.id;
    },
    onSuccess: (id) => navigate(`/chat/${id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!peers.data || peers.data.length === 0) return null;
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <MessageSquare className="size-4" /> {t('network.dmTitle')}
      </h2>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select value={serverId || peers.data[0].id} onChange={(e) => setServerId(e.target.value)} className="h-10 rounded-md border border-border bg-surface px-2 text-sm">
          {peers.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input placeholder={t('network.dmUser')} value={username} onChange={(e) => setUsername(e.target.value)} />
        <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending || !username.trim()}>
          {t('network.dmStart')}
        </Button>
      </div>
    </Card>
  );
}

function NetworkGameCard({ game }: { game: NetworkGameDto }) {
  const { t } = useTranslation();
  const download = useMutation({
    mutationFn: (build: RemoteBuildDto) => api.network.download(game.serverId, build.buildId),
    onSuccess: (res) => {
      if (res.files.length === 1) {
        // Einzeldatei-Build: direkt vom Herkunftsserver laden
        window.location.href = res.files[0].url;
      } else {
        // Ordner-Build: im Browser nicht praktikabel – Hinweis auf den Desktop-Client
        toast.info(t('network.folderHint'));
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="flex gap-4">
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2">
        {game.coverUrl ? <img src={game.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{game.title}</h3>
          <Badge tone="accent">
            <Server className="mr-1 inline size-3" />
            {game.serverName}
          </Badge>
        </div>
        {game.shortDescription && <p className="line-clamp-2 text-sm text-muted">{game.shortDescription}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {game.builds.map((b) => (
            <Button key={b.buildId} onClick={() => download.mutate(b)} disabled={download.isPending} title={formatBytes(b.sizeBytes)}>
              <PlatformIcon platform={b.platform} className="size-4" />
              <Download className="size-4" />
              <span className="text-xs">{formatBytes(b.sizeBytes)}</span>
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function NetworkPage() {
  const { t } = useTranslation();
  const games = useQuery({ queryKey: ['network', 'games'], queryFn: () => api.network.games() });

  if (games.isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Network className="size-6" /> {t('network.title')}
        </h1>
        <p className="text-sm text-muted">{t('network.intro')}</p>
      </div>
      <NetworkDM />
      {games.data && games.data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {games.data.map((g) => (
            <NetworkGameCard key={`${g.serverId}:${g.slug}`} game={g} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Network className="size-8" />} title={t('network.emptyTitle')}>
          {t('network.emptyDesc')}
        </EmptyState>
      )}
    </div>
  );
}
