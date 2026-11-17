import type { ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useBoard, useProjects } from '../lib/queries.ts';
import { useStore } from '../lib/store.ts';
import { filtersStore, openPalette, prefsStore } from '../lib/ui-state.ts';
import { AnnMark, Kbd, LogoMark, ProjectDot, Skeleton } from '../components/ui/bits.tsx';
import { cn } from '../components/ui/cn.ts';
import { AnnStatus, LiveDot } from './AnnStatus.tsx';
import { NAV, SETTINGS_NAV, isActive, type NavItem } from './nav.ts';
import { useWallet } from '../lib/wallet.ts';
import { Minutes } from '../features/wallet/parts.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

function NavLink({ item, collapsed, count, chip }: { item: NavItem; collapsed: boolean; count?: number; chip?: ReactNode }) {
  const [location] = useLocation();
  const active = isActive(item.href, location);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? `${item.label} (${item.keys})` : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
        collapsed && 'justify-center px-0',
        active ? 'text-text' : 'text-muted hover:bg-raised hover:text-text',
      )}
    >
      {active ? <span aria-hidden className={cn('absolute top-1.5 bottom-1.5 w-px bg-accent', collapsed ? 'left-0' : '-left-3')} /> : null}
      <Icon size={16} strokeWidth={1.6} aria-hidden className={active ? 'text-text' : 'text-faint group-hover:text-muted'} />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && count ? <span className="num text-xs text-faint">{count}</span> : null}
      {!collapsed ? chip : null}
    </Link>
  );
}

export function Sidebar() {
  const collapsed = useStore(prefsStore, (p) => p.sidebarCollapsed);
  const toggle = () => prefsStore.set((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }));
  const planned = useBoard((b) => b.cards.filter((c) => c.planned_for === b.today && b.columns.find((col) => col.id === c.column_id)?.kind !== 'done').length);
  const displayName = useBoard((b) => b.settings.display_name);

  return (
    <aside
      aria-label="Main"
      className={cn('hidden h-full flex-none flex-col border-r border-border bg-ground transition-[width] duration-200 ease-out md:flex', collapsed ? 'w-[56px]' : 'w-[232px]')}
    >
      <div className={cn('flex h-14 flex-none items-center gap-2.5', collapsed ? 'justify-center' : 'px-4')}>
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-md" aria-label="Hey Ann, board">
          <LogoMark size={24} />
          {collapsed ? null : <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">Hey Ann</span>}
        </Link>
        {collapsed ? null : (
          <button type="button" onClick={toggle} aria-label="Collapse sidebar" title="Collapse sidebar ( [ )" className="ml-auto rounded-md p-1 text-faint hover:bg-raised hover:text-text">
            <PanelLeftClose size={16} strokeWidth={1.6} aria-hidden />
          </button>
        )}
      </div>

      <div className={cn('flex-none', collapsed ? 'px-2' : 'px-3')}>
        <button
          type="button"
          onClick={() => openPalette()}
          aria-label="Search or run a command"
          title={collapsed ? `Search (${MOD} K)` : undefined}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface text-sm text-faint transition-colors hover:border-border-strong hover:text-muted',
            collapsed ? 'justify-center' : 'px-2.5',
          )}
        >
          <Search size={14} strokeWidth={1.75} aria-hidden />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">Search or add…</span>
              <Kbd>{MOD} K</Kbd>
            </>
          )}
        </button>
      </div>

      <nav aria-label="Screens" className={cn('mt-4 flex flex-none flex-col gap-0.5', collapsed ? 'px-2' : 'px-3')}>
        {NAV.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} count={item.href === '/today' ? planned.data : undefined} chip={item.href === '/wallet' ? <BalanceChip /> : undefined} />
        ))}
      </nav>

      {collapsed ? <div className="flex-1" /> : <ProjectList />}

      <div className={cn('flex flex-none flex-col gap-2 pb-3', collapsed ? 'items-center px-2' : 'px-3')}>
        {collapsed ? (
          <Link href="/activity" aria-label="Ann activity" title="Ann activity" className="flex size-8 items-center justify-center rounded-md hover:bg-raised">
            <AnnMark size={16} />
          </Link>
        ) : (
          <AnnStatus />
        )}
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'gap-1')}>
          <div className={collapsed ? '' : 'min-w-0 flex-1'}>
            <NavLink item={SETTINGS_NAV} collapsed={collapsed} />
          </div>
          {collapsed ? (
            <>
              <LiveDot className="py-1" />
              <button type="button" onClick={toggle} aria-label="Expand sidebar" title="Expand sidebar ( [ )" className="rounded-md p-2 text-faint hover:bg-raised hover:text-text">
                <PanelLeftOpen size={16} strokeWidth={1.6} aria-hidden />
              </button>
            </>
          ) : (
            <span className="truncate pr-1 text-xs text-faint">{displayName.data}</span>
          )}
        </div>
      </div>
    </aside>
  );
}

function ProjectList() {
  const projects = useProjects();
  const active = useStore(filtersStore, (f) => f.project);
  const [location, navigate] = useLocation();
  const items = (projects.data?.items ?? []).filter((p) => !p.archived_at);

  const pick = (id: number) => {
    filtersStore.set((f) => ({ ...f, project: f.project === id ? null : id }));
    if (!(location === '/' || location.startsWith('/card/') || location === '/list')) navigate('/');
  };

  return (
    <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
      <div className="flex h-6 items-center justify-between px-2">
        <h2 className="text-xs font-medium text-faint">Projects</h2>
        {active !== null ? (
          <button type="button" className="text-xs text-faint hover:text-text" onClick={() => filtersStore.set((f) => ({ ...f, project: null }))}>
            Clear
          </button>
        ) : null}
      </div>
      <ul className="mt-1 min-h-0 flex-1 overflow-y-auto pb-2">
        {projects.isPending
          ? Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex h-8 items-center gap-2.5 px-2">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-3 w-24" />
              </li>
            ))
          : items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pick(p.id)}
                  aria-pressed={active === p.id}
                  className={cn(
                    'relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors',
                    active === p.id ? 'bg-active text-text' : 'text-muted hover:bg-raised hover:text-text',
                  )}
                >
                  <ProjectDot color={p.color} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="num text-xs text-faint" aria-label={`${p.open} open`}>
                    {p.open}
                  </span>
                </button>
              </li>
            ))}
        {projects.isSuccess && !items.length ? <li className="px-2 py-1 text-xs text-faint">Projects appear when a card has one. Try “@work” in quick add.</li> : null}
      </ul>
    </div>
  );
}

/** The wallet balance beside its nav item: mono minutes, red in debt, a dot when something waits on you. */
function BalanceChip() {
  const q = useWallet();
  if (!q.data || q.data.phase === 'off') return null;
  const waiting = q.data.pending_credit.length + q.data.vetoable.length;
  return (
    <span className="flex items-center gap-1.5" aria-label={`Balance ${q.data.balance} minutes${waiting ? `, ${waiting} waiting on you` : ''}`}>
      {waiting ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
      <span className="num text-xs">
        {q.data.balance < 0 ? <Minutes value={q.data.balance} suffix={false} /> : <span className="text-muted">{q.data.balance}</span>}
        <span className="text-faint">m</span>
      </span>
    </span>
  );
}
