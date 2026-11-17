import { lazy, Suspense, useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BoardView } from '../features/board/BoardView.tsx';
import { CardDrawerHost } from '../features/card/CardDrawer.tsx';
import { CommandPalette } from '../features/palette/CommandPalette.tsx';
import { overlayStore } from '../lib/ui-state.ts';
import { Skeleton } from '../components/ui/bits.tsx';
import { MobileTabBar, MobileTopBar } from './MobileNav.tsx';
import { Shortcuts } from './Shortcuts.tsx';
import { Sidebar } from './Sidebar.tsx';

// Screens other than the board load on demand.
const TodayView = lazy(() => import('../features/today/TodayView.tsx'));
const ListView = lazy(() => import('../features/list/ListView.tsx'));
const CalendarView = lazy(() => import('../features/calendar/CalendarView.tsx'));
const InsightsView = lazy(() => import('../features/insights/InsightsView.tsx'));
const ActivityView = lazy(() => import('../features/activity/ActivityView.tsx'));
const SettingsView = lazy(() => import('../features/settings/SettingsView.tsx'));

function ScreenFallback() {
  return (
    <div className="p-6" aria-busy="true">
      <Skeleton className="h-7 w-36" />
      <Skeleton className="mt-3 h-4 w-72" />
    </div>
  );
}

export function Shell() {
  const [location] = useLocation();
  useEffect(() => overlayStore.set((s) => (s.mobileMenu ? { ...s, mobileMenu: false } : s)), [location]);

  return (
    <div className="flex h-full overflow-hidden">
      <a href="#main" className="sr-only z-50 rounded bg-primary px-3 py-2 text-primary-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main id="main" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col pb-[60px] outline-none md:pb-0">
          <Suspense fallback={<ScreenFallback />}>
            <Switch>
              <Route path="/" component={BoardView} />
              <Route path="/card/:id" component={BoardView} />
              <Route path="/today" component={TodayView} />
              <Route path="/list" component={ListView} />
              <Route path="/calendar" component={CalendarView} />
              <Route path="/insights" component={InsightsView} />
              <Route path="/activity" component={ActivityView} />
              <Route path="/settings/:section?" component={SettingsView} />
              <Route>
                <div className="p-6">
                  <h1 className="text-lg font-semibold">Not found</h1>
                  <p className="mt-1 text-sm text-muted">There’s no screen at {location}.</p>
                </div>
              </Route>
            </Switch>
          </Suspense>
        </main>
        <MobileTabBar />
      </div>
      <CardDrawerHost />
      <CommandPalette />
      <Shortcuts />
    </div>
  );
}
