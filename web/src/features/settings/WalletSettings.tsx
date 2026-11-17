// Settings → Wallet: the rules (delayed when loosening), the walled apps, and the paired phones.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Smartphone, X } from 'lucide-react';
import { renderSVG } from 'uqr';
import { fmtAgo, fmtDay, fmtDateTime } from '../../lib/time.ts';
import { APP_LABEL, appLabel, useDevices, useWallet, useWalletWrite, walletApi, wk, type Device, type Rules, type WalletSummary } from '../../lib/wallet.ts';
import { queryClient } from '../../lib/queries.ts';
import { Button } from '../../components/ui/Button.tsx';
import { ErrorNote, Pill, Skeleton } from '../../components/ui/bits.tsx';
import { Input } from '../../components/ui/form.tsx';
import { Modal } from '../../components/ui/overlay.tsx';
import { cn } from '../../components/ui/cn.ts';
import { CopyField, Section } from './shared.tsx';

export function WalletSettings() {
  const q = useWallet();
  if (q.isPending) return <Skeleton className="mt-6 h-96 w-full rounded-lg" />;
  if (q.isError) return <ErrorNote className="mt-6" message="Couldn’t load the wallet." onRetry={() => void q.refetch()} />;
  return (
    <>
      <RulesSection w={q.data} />
      <WalledApps w={q.data} />
      <Phones />
    </>
  );
}

// ---------------------------------------------------------------- rules

type NumKey = Exclude<{ [K in keyof Rules]: Rules[K] extends number ? K : never }[keyof Rules], 'version'>;
const FIELDS: { key: NumKey; label: string; hint: (v: number) => string; step?: number }[] = [
  { key: 'rate', label: 'Earn rate', hint: (v) => `${Math.round(v * 60)} min per focused hour`, step: 0.05 },
  { key: 'daily_earn_cap', label: 'Daily earn cap', hint: () => 'minutes a day, at most' },
  { key: 'allowance', label: 'Morning allowance', hint: () => 'yours to lose if you miss your plan' },
  { key: 'missed_plan_penalty', label: 'Missed-plan penalty', hint: () => 'on top of losing the allowance' },
  { key: 'overdue_per_day', label: 'Overdue P0/P1, per day', hint: () => 'per card, per day' },
  { key: 'penalty_day_cap', label: 'Penalty cap, per day', hint: () => 'lapses never cost more than this' },
  { key: 'penalty_week_cap', label: 'Penalty cap, per week', hint: () => 'across all lapses' },
  { key: 'debt_floor', label: 'Debt floor', hint: () => 'the lowest the balance can go' },
  { key: 'emergency_cost', label: 'Emergency unlock cost', hint: () => 'minutes; can go into debt' },
  { key: 'emergency_per_week', label: 'Emergency unlocks a week', hint: () => 'at most' },
  { key: 'balance_cap', label: 'Balance cap', hint: () => 'no hoarding past this' },
  { key: 'expiry_days', label: 'Earned minutes expire after', hint: () => 'days' },
];

function RulesSection({ w }: { w: WalletSummary }) {
  const active = w.phase === 'active';
  // Edits stack on top of any pending change (that's how the server merges them).
  const base = w.pending_rules?.rules ?? w.rules;
  const [draft, setDraft] = useState<Partial<Record<NumKey, string>>>({});
  const changed = FIELDS.filter((f) => draft[f.key] !== undefined && Number(draft[f.key]) !== base[f.key]);
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed.length]);
  const save = useWalletWrite(
    (patch: Partial<Rules>) => walletApi.setRules(patch),
    (r) => (active ? `Saved. The new rules start ${fmtDay(r.effective)}.` : 'Rules saved.'),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!changed.length) return;
    save.mutate(Object.fromEntries(changed.map((f) => [f.key, Number(draft[f.key])])) as Partial<Rules>, { onSuccess: () => setDraft({}) });
  };
  const pendingDiff = w.pending_rules ? FIELDS.filter((f) => w.pending_rules!.rules[f.key] !== w.rules[f.key]) : [];
  const unwalling = w.pending_rules ? w.rules.walled_apps.filter((p) => !w.pending_rules!.rules.walled_apps.includes(p)) : [];

  return (
    <Section
      id="s-wrules"
      title="Rules"
      description={
        active ? (
          <>
            The wallet is running, so rule changes start <strong className="font-medium text-text">next Monday</strong>. No loosening on impulse. Walling more apps is the exception: it applies right away.
          </>
        ) : (
          'The wallet isn’t enforcing yet, so changes apply right away. Once it’s active, they wait until the next Monday.'
        )
      }
      aside={
        w.pending_rules && (pendingDiff.length || unwalling.length) ? (
          <div className="rounded-md bg-[var(--pill-warning-bg)] px-3 py-2 text-xs text-[var(--pill-warning-ink)]">
            <p className="font-medium">Starts {fmtDay(w.pending_rules.effective)}</p>
            <ul className="mt-1">
              {pendingDiff.map((f) => (
                <li key={f.key} className="num">
                  {f.label}: {w.rules[f.key]} → {w.pending_rules!.rules[f.key]}
                </li>
              ))}
              {unwalling.map((p) => (
                <li key={p}>Unwall {appLabel(p)}</li>
              ))}
            </ul>
          </div>
        ) : null
      }
    >
      <form onSubmit={submit}>
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => {
            const v = draft[f.key] ?? String(base[f.key]);
            const id = `rule-${f.key}`;
            return (
              <div key={f.key}>
                <label htmlFor={id} className="text-xs font-medium text-muted">
                  {f.label}
                </label>
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  step={f.step ?? 1}
                  value={v}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  aria-describedby={`${id}-hint`}
                  className={cn('num mt-1.5', draft[f.key] !== undefined && Number(v) !== base[f.key] && 'border-accent')}
                />
                <p id={`${id}-hint`} className="mt-1 text-xs text-faint">
                  {f.hint(Number(v))}
                  {w.rules[f.key] !== base[f.key] ? <span className="num"> · now {w.rules[f.key]}</span> : null}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          {changed.length ? (
            <>
              <span className="text-xs text-faint">
                <span className="num">{changed.length}</span> change{changed.length === 1 ? '' : 's'}
                {active ? ', from next Monday' : ''}
              </span>
              <Button variant="ghost" onClick={() => setDraft({})}>
                Discard
              </Button>
            </>
          ) : null}
          <Button variant="primary" type="submit" disabled={!changed.length || save.isPending}>
            {save.isPending ? 'Saving…' : active ? 'Save for next Monday' : 'Save rules'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------- walled apps

const PKG = /^[a-zA-Z][\w]*(\.[\w]+)+$/;

function WalledApps({ w }: { w: WalletSummary }) {
  const active = w.phase === 'active';
  const now = w.rules.walled_apps;
  const next = w.pending_rules?.rules.walled_apps ?? now;
  const all = useMemo(() => [...new Set([...now, ...next])], [now, next]);
  const [pkg, setPkg] = useState('');
  const save = useWalletWrite(
    (v: { apps: string[]; added: boolean }) => walletApi.setRules({ walled_apps: v.apps }),
    (r, v) => (v.added ? 'Walled. It applies right away.' : active ? `It stays walled until ${fmtDay(r.effective)}.` : 'Removed from the wall.'),
  );
  const add = (p: string) => {
    const name = p.trim();
    if (!PKG.test(name) || next.includes(name)) return;
    save.mutate({ apps: [...next, name], added: true }, { onSuccess: () => setPkg('') });
  };
  const suggestions = Object.keys(APP_LABEL).filter((p) => !all.includes(p)).slice(0, 6);
  const valid = PKG.test(pkg.trim());

  return (
    <Section
      id="s-walled"
      title="Walled apps"
      description="Apps that cost screen minutes. Calls, messages, maps, banking, the camera and music are essentials: never walled, never counted."
    >
      <ul>
        {all.map((p) => {
          const leaving = active && now.includes(p) && !next.includes(p);
          return (
            <li key={p} className="flex min-h-12 items-center gap-3 border-b border-rule py-1.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{appLabel(p)}</span>
                {APP_LABEL[p] ? <span className="num block truncate text-[11px] text-faint">{p}</span> : null}
              </span>
              {leaving ? <Pill tone="warning">Unwalled from {fmtDay(w.pending_rules!.effective)}</Pill> : null}
              {!leaving ? (
                <button
                  type="button"
                  aria-label={`Unwall ${appLabel(p)}`}
                  title={active ? 'Unwall (from next Monday)' : 'Unwall'}
                  onClick={() => save.mutate({ apps: next.filter((x) => x !== p), added: false })}
                  className="rounded-md p-1.5 text-faint hover:bg-raised hover:text-text"
                >
                  <X size={14} strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form
        className="mt-3 flex items-start gap-2 border-t border-rule pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          add(pkg);
        }}
      >
        <div className="flex-1">
          <Input
            aria-label="Android package name"
            aria-describedby="pkg-hint"
            aria-invalid={pkg.trim() !== '' && !valid}
            placeholder="com.example.app…"
            spellCheck={false}
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
            className="num"
          />
          <p id="pkg-hint" className="mt-1 text-xs text-faint">
            The Android package name, e.g. com.discord. Find it in the app’s Play Store link.
          </p>
        </div>
        <Button type="submit" icon={Plus} disabled={!valid || save.isPending}>
          Wall it
        </Button>
      </form>
      {suggestions.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-faint">Quick add:</span>
          {suggestions.map((p) => (
            <button key={p} type="button" onClick={() => add(p)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:border-border-strong hover:text-text">
              <Plus size={11} strokeWidth={2} aria-hidden />
              {APP_LABEL[p]}
            </button>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- phones

function Phones() {
  const q = useDevices();
  const [name, setName] = useState('Pixel');
  const [paired, setPaired] = useState<{ name: string; token: string } | null>(null);
  const pair = useWalletWrite((n: string) => walletApi.pairDevice(n), (r) => `Paired “${r.name}”.`);
  const live = (q.data?.items ?? []).filter((d) => !d.revoked_at);
  const revoked = (q.data?.items ?? []).filter((d) => d.revoked_at);
  return (
    <Section id="s-phones" title="Phones" description="The Hey Ann phone app walls the apps above and reports daily use. Each phone gets its own token; revoke one and it stops at once.">
      {q.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : q.isError ? (
        <ErrorNote message="Couldn’t list phones." onRetry={() => void q.refetch()} />
      ) : live.length || revoked.length ? (
        <ul>
          {[...live, ...revoked].map((d) => (
            <DeviceRow key={d.id} d={d} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">No phone paired yet.</p>
      )}
      <form
        className="mt-3 flex items-center gap-2 border-t border-rule pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) pair.mutate(name.trim(), { onSuccess: (r) => setPaired({ name: r.name, token: r.token }) });
        }}
      >
        <Input aria-label="Phone name" placeholder="Phone name…" value={name} onChange={(e) => setName(e.target.value)} className="max-w-60" />
        <Button type="submit" icon={Smartphone} disabled={!name.trim() || pair.isPending}>
          {pair.isPending ? 'Pairing…' : 'Pair a phone'}
        </Button>
      </form>
      <PairedDialog paired={paired} onClose={() => setPaired(null)} />
    </Section>
  );
}

function DeviceRow({ d }: { d: Device }) {
  const [sure, setSure] = useState(false);
  const revoke = useWalletWrite((id: number) => walletApi.revokeDevice(id), () => `Revoked “${d.name}”. It can’t reach the wallet any more.`);
  const seen = d.last_seen ? Date.now() - d.last_seen : null;
  return (
    <li className={cn('flex min-h-12 items-center gap-3 border-b border-rule py-2 last:border-0', d.revoked_at && 'opacity-60')}>
      <Smartphone size={16} strokeWidth={1.6} aria-hidden className="flex-none text-faint" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text">{d.name}</span>
        <span className="block text-[11px] text-faint">
          Paired {fmtDateTime(d.created_at, false)} ·{' '}
          {d.revoked_at ? `revoked ${fmtAgo(d.revoked_at)}` : d.last_seen ? <>last seen <span className="num">{fmtAgo(d.last_seen)}</span></> : 'never checked in'}
        </span>
      </span>
      {!d.revoked_at && seen !== null && seen < 5 * 60_000 ? <Pill tone="positive">Online</Pill> : null}
      {d.revoked_at ? (
        <Pill>Revoked</Pill>
      ) : sure ? (
        <span className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
            Keep
          </Button>
          <Button size="sm" variant="danger" onClick={() => revoke.mutate(d.id)} disabled={revoke.isPending}>
            Revoke “{d.name}”
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
          Revoke…
        </Button>
      )}
    </li>
  );
}

/** The token is shown once: copy it, or scan the QR from the phone app. */
function PairedDialog({ paired, onClose }: { paired: { name: string; token: string } | null; onClose: () => void }) {
  const server = window.location.origin;
  const link = paired ? `heyann://pair?server=${encodeURIComponent(server)}&token=${encodeURIComponent(paired.token)}` : '';
  const svg = useMemo(() => (link ? renderSVG(link, { border: 2, whiteColor: '#ffffff', blackColor: '#111114' }) : ''), [link]);
  return (
    <Modal
      open={!!paired}
      onClose={() => {
        onClose();
        void queryClient.invalidateQueries({ queryKey: wk.devices });
      }}
      label="Phone paired"
      className="max-w-xl"
    >
      {paired ? (
        <div className="p-5">
          <h2 className="text-[15px] font-semibold">“{paired.name}” is paired</h2>
          <p className="mt-1 text-sm text-muted">
            Scan this from the Hey Ann phone app, or copy the two values into it. <strong className="font-medium text-text">The token is shown only now</strong>; if you lose it, revoke the phone and pair again.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-[176px_1fr]">
            <div className="size-44 overflow-hidden rounded-lg bg-white p-1 [&>svg]:size-full" role="img" aria-label="QR code with the server address and token" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="flex min-w-0 flex-col gap-3">
              <CopyField id="pair-server" label="Server URL" value={server} />
              <CopyField id="pair-token" label="Device token" value={paired.token} />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={onClose} data-autofocus>
              I’ve saved it
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
