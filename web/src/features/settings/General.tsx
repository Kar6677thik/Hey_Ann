import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Settings } from '../../../../src/core/types.ts';
import { api } from '../../lib/api.ts';
import { useWrite } from '../../lib/mutations.ts';
import { useSettings } from '../../lib/queries.ts';
import { useStore } from '../../lib/store.ts';
import { prefsStore } from '../../lib/ui-state.ts';
import { fmtMinutes } from '../../lib/time.ts';
import { Button } from '../../components/ui/Button.tsx';
import { ErrorNote, Skeleton } from '../../components/ui/bits.tsx';
import { Field, Input, Select, Segmented } from '../../components/ui/form.tsx';
import { Section } from './shared.tsx';

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return [browserTz];
  }
})();

export function General() {
  const q = useSettings();
  const theme = useStore(prefsStore, (p) => p.theme);
  return (
    <>
      {q.isPending ? (
        <Skeleton className="mt-6 h-80 w-full rounded-lg" />
      ) : q.isError ? (
        <ErrorNote className="mt-6" message="Couldn’t load settings." onRetry={() => void q.refetch()} />
      ) : (
        <SettingsForm initial={q.data} />
      )}
      <Section id="s-theme" title="Appearance" description="Stored on this device only.">
        <Segmented
          label="Theme"
          value={theme}
          onChange={(t) => prefsStore.set((p) => ({ ...p, theme: t }))}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
      </Section>
    </>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const save = useWrite((patch: Partial<Settings>) => api.patchSettings(patch));
  const dirtyKeys = useMemo(() => (Object.keys(s) as (keyof Settings)[]).filter((k) => s[k] !== initial[k]), [s, initial]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirtyKeys.length) return;
    save.mutate(Object.fromEntries(dirtyKeys.map((k) => [k, s[k]])) as Partial<Settings>);
  };
  const zoneList = zones.includes(s.timezone) ? zones : [s.timezone, ...zones];
  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirtyKeys.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyKeys.length]);

  return (
    <form onSubmit={submit}>
      <Section id="s-profile" title="You" description="Ann uses your name in summaries (“Standup, Tue 17 Nov, Karthik”).">
        <Field label="Display name">{({ id }) => <Input id={id} value={s.display_name} onChange={(e) => set('display_name', e.target.value)} autoComplete="nickname" className="max-w-sm" />}</Field>
      </Section>
      <Section
        id="s-time"
        title="Time"
        description="Dates you say to Ann (“next fri 5pm”) resolve in this timezone, and “today” follows it."
        aside={
          s.timezone !== browserTz ? (
            <button type="button" onClick={() => set('timezone', browserTz)} className="text-xs text-accent-ink hover:underline">
              Use this browser’s timezone ({browserTz})
            </button>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Timezone">
            {({ id }) => (
              <Select id={id} value={s.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {zoneList.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Week starts on">
            {({ id }) => (
              <Select id={id} value={s.week_starts_on} onChange={(e) => set('week_starts_on', Number(e.target.value) === 0 ? 0 : 1)}>
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </Select>
            )}
          </Field>
          <Field label="Work starts">{({ id }) => <Input id={id} type="time" value={s.work_start} onChange={(e) => set('work_start', e.target.value)} className="num" />}</Field>
          <Field label="Work ends">{({ id }) => <Input id={id} type="time" value={s.work_end} onChange={(e) => set('work_end', e.target.value)} className="num" />}</Field>
        </div>
      </Section>
      <Section id="s-plan" title="Planning" description="How much fits in a day, how long a focus session runs, and when a card counts as stale.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Day capacity (minutes)" hint={fmtMinutes(s.day_capacity_min) + ' of focused work'}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={30} max={960} step={15} value={s.day_capacity_min} onChange={(e) => set('day_capacity_min', Number(e.target.value))} className="num" />}
          </Field>
          <Field label="Focus session (minutes)">
            {({ id }) => <Input id={id} type="number" min={5} max={180} value={s.focus_min} onChange={(e) => set('focus_min', Number(e.target.value))} className="num" />}
          </Field>
          <Field label="Stale after (days)" hint="In progress or review, untouched">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={60} value={s.stale_after_days} onChange={(e) => set('stale_after_days', Number(e.target.value))} className="num" />}
          </Field>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          {dirtyKeys.length ? (
            <span className="text-xs text-faint">
              <span className="num">{dirtyKeys.length}</span> unsaved change{dirtyKeys.length === 1 ? '' : 's'}
            </span>
          ) : null}
          {dirtyKeys.length ? (
            <Button variant="ghost" onClick={() => setS(initial)}>
              Discard
            </Button>
          ) : null}
          <Button variant="primary" type="submit" disabled={!dirtyKeys.length || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </Section>
    </form>
  );
}
