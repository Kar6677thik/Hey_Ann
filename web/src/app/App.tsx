import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { onSigninRequired } from '../lib/api.ts';
import { qk, queryClient, useSession } from '../lib/queries.ts';
import { useLiveEvents } from '../lib/events.ts';
import { useStore } from '../lib/store.ts';
import { applyTheme, prefsStore } from '../lib/ui-state.ts';
import { Shell } from './Shell.tsx';
import { SignIn } from './SignIn.tsx';
import { Skeleton } from '../components/ui/bits.tsx';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Gate />
        <ThemedToaster />
      </MotionConfig>
    </QueryClientProvider>
  );
}

function ThemedToaster() {
  const theme = useStore(prefsStore, (p) => p.theme);
  useEffect(() => applyTheme(theme), [theme]);
  return <Toaster position="bottom-right" theme={theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark'} visibleToasts={4} gap={8} offset={16} mobileOffset={{ bottom: 76 }} />;
}

function Gate() {
  const session = useSession();
  useEffect(() => onSigninRequired(() => queryClient.setQueryData(qk.session, (s: { loginRequired: boolean } | undefined) => ({ signedIn: false, loginRequired: s?.loginRequired ?? true }))), []);
  const signedIn = session.data?.signedIn === true;
  useLiveEvents(signedIn);

  if (session.isPending) return <BootSkeleton />;
  if (session.isError) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-base font-semibold">Can’t reach Hey Ann</h1>
          <p className="mt-1 text-sm text-muted">The server didn’t answer. Is it running?</p>
          <button type="button" className="mt-4 text-sm font-medium text-text underline underline-offset-4" onClick={() => void session.refetch()}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!signedIn) return <SignIn />;
  return <Shell />;
}

function BootSkeleton() {
  return (
    <div className="flex h-full" aria-busy="true" aria-label="Loading Hey Ann">
      <div className="hidden w-[232px] flex-none flex-col gap-3 border-r border-border p-4 md:flex">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-4 h-4 w-40" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-7 w-32" />
      </div>
    </div>
  );
}
