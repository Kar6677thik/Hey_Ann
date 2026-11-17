import { Menu, Plus, Search } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useStore } from '../lib/store.ts';
import { overlayStore, openPalette, filtersStore, prefsStore } from '../lib/ui-state.ts';
import { useProjects } from '../lib/queries.ts';
import { LogoMark, ProjectDot } from '../components/ui/bits.tsx';
import { Sheet } from '../components/ui/overlay.tsx';
import { cn } from '../components/ui/cn.ts';
import { AnnStatus, LiveDot } from './AnnStatus.tsx';
import { NAV, SETTINGS_NAV, isActive } from './nav.ts';

const BOTTOM = ['/', '/today', '/wallet', '/activity'].map((h) => NAV.find((n) => n.href === h)!);

/** Phone: compact top bar + bottom tab bar; everything else in the menu sheet. */
export function MobileTopBar() {
  const [location] = useLocation();
  const current = [...NAV, SETTINGS_NAV].find((n) => isActive(n.href, location));
  return (
    <header className="sticky top-0 z-30 flex h-12 flex-none items-center gap-2 border-b border-border bg-ground px-4 md:hidden">
      <Link href="/" aria-label="Hey Ann, board" className="flex items-center gap-2">
        <LogoMark size={22} />
      </Link>
      <span className="truncate text-sm font-semibold">Hey Ann</span>
      <span className="sr-only">{current?.label}</span>
      <LiveDot className="ml-1" />
      <div className="ml-auto flex items-center gap-1">
        <button type="button" aria-label="Search" onClick={() => openPalette()} className="flex size-10 items-center justify-center rounded-md text-muted active:bg-raised">
          <Search size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" aria-label="Add a card" onClick={() => openPalette('add')} className="flex size-10 items-center justify-center rounded-md text-text active:bg-raised">
          <Plus size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </header>
  );
}

export function MobileTabBar() {
  const [location] = useLocation();
  const menuOpen = useStore(overlayStore, (s) => s.mobileMenu);
  const setMenu = (v: boolean) => overlayStore.set((s) => ({ ...s, mobileMenu: v }));
  return (
    <>
      <nav aria-label="Screens" className="fixed inset-x-0 bottom-0 z-30 flex h-[60px] border-t border-border bg-ground pb-[env(safe-area-inset-bottom)] md:hidden">
        {BOTTOM.map((item) => {
          const active = isActive(item.href, location);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn('relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px]', active ? 'text-text' : 'text-faint')}
            >
              {active ? <span aria-hidden className="absolute top-0 h-px w-8 bg-accent" /> : null}
              <Icon size={19} strokeWidth={1.6} aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenu(true)} className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-faint" aria-label="More screens and projects">
          <Menu size={19} strokeWidth={1.6} aria-hidden />
          More
        </button>
      </nav>
      <Sheet open={menuOpen} onClose={() => setMenu(false)} label="Menu" width={420}>
        <MenuSheet onDone={() => setMenu(false)} />
      </Sheet>
    </>
  );
}

function MenuSheet({ onDone }: { onDone: () => void }) {
  const [location, navigate] = useLocation();
  const projects = useProjects();
  const go = (href: string) => {
    navigate(href);
    onDone();
  };
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Menu</h2>
        <button type="button" className="h-10 rounded-md px-3 text-sm text-muted" onClick={onDone}>
          Close
        </button>
      </div>
      <nav aria-label="All screens" className="mt-3 flex flex-col">
        {[...NAV, SETTINGS_NAV].map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href, location);
          return (
            <button key={item.href} type="button" onClick={() => go(item.href)} aria-current={active ? 'page' : undefined} className={cn('flex h-11 items-center gap-3 rounded-md px-2 text-[15px]', active ? 'text-text' : 'text-muted')}>
              <Icon size={18} strokeWidth={1.6} aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>
      <h3 className="mt-5 px-2 text-xs font-medium text-faint">Projects</h3>
      <ul className="mt-1">
        {(projects.data?.items ?? [])
          .filter((p) => !p.archived_at)
          .map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-[15px] text-muted"
                onClick={() => {
                  filtersStore.set((f) => ({ ...f, project: p.id }));
                  go('/');
                }}
              >
                <ProjectDot color={p.color} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="num text-xs text-faint">{p.open}</span>
              </button>
            </li>
          ))}
      </ul>
      <div className="mt-5">
        <AnnStatus />
      </div>
      <button type="button" className="mt-3 h-10 text-left text-sm text-faint" onClick={() => prefsStore.set((p) => ({ ...p, theme: p.theme === 'light' ? 'dark' : 'light' }))}>
        Switch theme
      </button>
    </div>
  );
}
