import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api.ts';
import { qk, queryClient } from '../lib/queries.ts';
import { LogoMark } from '../components/ui/bits.tsx';
import { Checkbox } from '../components/ui/form.tsx';

export function SignIn() {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.signIn(password, remember);
      await queryClient.invalidateQueries();
      queryClient.setQueryData(qk.session, { signedIn: true, loginRequired: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t sign in.');
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-full place-items-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-[340px]" aria-describedby={error ? 'signin-error' : undefined}>
        <div className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Hey Ann</span>
        </div>
        <h1 className="mt-8 text-[22px] font-semibold leading-7 tracking-[-0.01em]">Sign in to your board</h1>
        <p className="mt-1 text-sm text-muted">Enter the owner password for this server.</p>

        <label htmlFor="pw" className="mt-6 block text-xs font-medium text-muted">
          Password
        </label>
        <input
          id="pw"
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
          className="mt-1.5 h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-[15px] text-text hover:border-control focus:border-accent focus:outline-none"
        />
        {error ? (
          <p id="signin-error" role="alert" className="mt-2 text-xs text-[var(--pill-negative-ink)]">
            {error}
          </p>
        ) : null}

        <label className="mt-4 flex w-fit cursor-pointer select-none items-center gap-2.5 py-1 text-sm text-muted">
          <Checkbox checked={remember} onChange={setRemember} label="Remember this device for 30 days" />
          Remember this device (30 days)
        </label>

        <button
          type="submit"
          disabled={!password || busy}
          className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
