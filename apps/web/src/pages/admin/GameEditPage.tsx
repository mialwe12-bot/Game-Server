import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ManagedGame } from '@gameserver/shared';
import { Badge, ErrorState, PageLoader, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { BuildsTab } from './game/BuildsTab';
import { DetailsTab } from './game/DetailsTab';
import { MediaTab } from './game/MediaTab';
import { MetadataTab } from './game/MetadataTab';
import { PermissionsTab } from './game/PermissionsTab';

type Tab = 'details' | 'media' | 'builds' | 'metadata' | 'permissions';

export default function GameEditPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState<Tab>((params.get('tab') as Tab) || 'details');
  const setTab = (v: Tab) => {
    setTabState(v);
    setParams({ tab: v }, { replace: true });
  };
  const game = useQuery({ queryKey: ['admin', 'game', id], queryFn: () => api.manage.game(id) });
  const update = (g: ManagedGame) => {
    qc.setQueryData(['admin', 'game', id], g);
    void qc.invalidateQueries({ queryKey: ['admin', 'games'] });
    void qc.invalidateQueries({ queryKey: ['game'] });
  };
  const reload = () => void qc.invalidateQueries({ queryKey: ['admin', 'game', id] });

  if (game.isLoading) return <PageLoader />;
  if (game.error) return <ErrorState error={game.error} onRetry={() => game.refetch()} />;
  const g = game.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/games" className="text-sm text-muted hover:text-fg">
          ← {t('admin.games')}
        </Link>
        <h1 className="text-2xl font-bold">{g.title}</h1>
        <Badge tone={g.visibility === 'PUBLIC' ? 'success' : 'warning'}>{t(`visibility.${g.visibility}`).split(' (')[0]}</Badge>
        <span className="text-xs text-muted">{t('admin.game.storage', { size: formatBytes(g.storageBytes) })}</span>
        <Link to={`/game/${g.slug}`} className="ml-auto inline-flex items-center gap-1 text-sm text-accent hover:underline">
          {t('admin.game.viewInStore')} <ExternalLink className="size-3" />
        </Link>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'details', label: t('admin.tabs.details') },
          { id: 'media', label: t('admin.tabs.media') },
          { id: 'builds', label: t('admin.tabs.builds') },
          { id: 'metadata', label: t('admin.tabs.metadata') },
          { id: 'permissions', label: t('admin.tabs.permissions') },
        ]}
      />
      {tab === 'details' && <DetailsTab game={g} onSaved={update} />}
      {tab === 'media' && <MediaTab game={g} onChange={reload} />}
      {tab === 'builds' && <BuildsTab game={g} onChange={reload} />}
      {tab === 'metadata' && <MetadataTab game={g} onSaved={update} />}
      {tab === 'permissions' && <PermissionsTab game={g} onSaved={update} />}
    </div>
  );
}
