import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AGE_RATINGS, type ManagedGame, type SavePathConfig } from '@gameserver/shared';
import { Button, Card, Field, Input, Select } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { toast } from '../../../lib/toast';

const PLACEHOLDERS = ['{install}', '%APPDATA%', '%LOCALAPPDATA%', '%USERPROFILE%', '%DOCUMENTS%', '%SAVEDGAMES%', '$HOME', '$XDG_DATA_HOME', '$XDG_CONFIG_HOME'];

/** Phase 4: Altersfreigabe, Cloud-Save-Pfade, Workshop-Ordner */
export function FeaturesTab({ game, onSaved }: { game: ManagedGame; onSaved: (g: ManagedGame) => void }) {
  const { t } = useTranslation();
  const [ageRating, setAgeRating] = useState(game.ageRating);
  const [paths, setPaths] = useState<SavePathConfig[]>(game.savePaths);
  const [workshopPath, setWorkshopPath] = useState(game.workshopPath ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.manage.updateGame(game.id, {
        ageRating,
        workshopPath: workshopPath.trim() || null,
        savePaths: paths
          .filter((p) => p.path.trim())
          .map((p) => ({
            ...p,
            include: p.include?.filter(Boolean).length ? p.include.filter(Boolean) : undefined,
            exclude: p.exclude?.filter(Boolean).length ? p.exclude.filter(Boolean) : undefined,
          })),
      }),
    onSuccess: (g) => {
      onSaved(g);
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setPath = (i: number, patch: Partial<SavePathConfig>) => setPaths(paths.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const list = (v: string) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card title={t('admin.features.age')}>
        <Field label={t('admin.features.ageRating')} hint={t('admin.features.ageHint')}>
          <Select className="w-auto" value={ageRating} onChange={(e) => setAgeRating(Number(e.target.value))}>
            {AGE_RATINGS.map((a) => (
              <option key={a} value={a}>
                {a === 0 ? t('admin.features.ageNone') : t('admin.features.ageFrom', { age: a })}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card title={t('admin.features.cloud')}>
        <p className="mb-3 text-sm text-muted">{t('admin.features.cloudHint')}</p>
        <p className="mb-3 flex flex-wrap gap-1 text-xs">
          {PLACEHOLDERS.map((p) => (
            <code key={p} className="rounded bg-surface-2 px-1.5 py-0.5">
              {p}
            </code>
          ))}
        </p>
        <ul className="space-y-3">
          {paths.map((p, i) => (
            <li key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap gap-2">
                <Select className="w-auto" value={p.platform} onChange={(e) => setPath(i, { platform: e.target.value as SavePathConfig['platform'] })}>
                  <option value="ANY">{t('admin.features.anyPlatform')}</option>
                  <option value="WINDOWS">{t('platforms.WINDOWS')}</option>
                  <option value="LINUX">{t('platforms.LINUX')}</option>
                </Select>
                <Input className="w-auto flex-1 font-mono text-xs" value={p.path} onChange={(e) => setPath(i, { path: e.target.value })} placeholder="%APPDATA%/MeinSpiel/Saves" />
                <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setPaths(paths.filter((_, j) => j !== i))} aria-label={t('common.remove')} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={(p.include ?? []).join(', ')} onChange={(e) => setPath(i, { include: list(e.target.value) })} placeholder={t('admin.features.include')} className="text-xs" />
                <Input value={(p.exclude ?? []).join(', ')} onChange={(e) => setPath(i, { exclude: list(e.target.value) })} placeholder={t('admin.features.exclude')} className="text-xs" />
              </div>
            </li>
          ))}
        </ul>
        <Button className="mt-3" size="sm" icon={<Plus className="size-4" />} onClick={() => setPaths([...paths, { platform: 'ANY', path: '' }])}>
          {t('admin.features.addPath')}
        </Button>
      </Card>

      <Card title={t('admin.features.workshop')}>
        <Field label={t('admin.features.workshopPath')} hint={t('admin.features.workshopHint')}>
          <Input className="font-mono text-xs" value={workshopPath} onChange={(e) => setWorkshopPath(e.target.value)} placeholder="mods" maxLength={200} />
        </Field>
      </Card>

      <Button type="submit" variant="primary" loading={save.isPending}>
        {t('common.save')}
      </Button>
    </form>
  );
}
