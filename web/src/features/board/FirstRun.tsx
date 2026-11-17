import { Link } from 'wouter';
import { openPalette } from '../../lib/ui-state.ts';
import { AnnMark, Kbd } from '../../components/ui/bits.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { MOD } from '../../app/Sidebar.tsx';
import { QUICK_ADD_SYNTAX } from '../quickadd/parse.tsx';

const PHRASES = [
  'Hey Ann, brain dump: renew passport by the 29th, call the bank tomorrow, fix the flaky test !high',
  'Hey Ann, what should I work on for the next hour?',
  'Hey Ann, I finished the API contract. Start me on the migration.',
  'Hey Ann, plan my day',
  'Hey Ann, standup',
];

/** The empty board teaches the two ways in: talking to Ann, and quick add. */
export function FirstRun() {
  return (
    <section aria-labelledby="first-run" className="mx-4 mb-4 grid flex-none gap-6 rounded-xl border border-border bg-surface p-5 md:mx-6 md:grid-cols-[1.2fr_1fr] md:p-6">
      <div>
        <h2 id="first-run" className="flex items-center gap-2 text-[15px] font-semibold">
          <AnnMark size={18} />
          Your board is empty. Say “Hey Ann” to fill it.
        </h2>
        <p className="mt-1.5 max-w-[60ch] text-sm text-muted">
          In Claude or ChatGPT, start a message with “Hey Ann” and she updates this board. Changes appear here live, and every one can be undone.
        </p>
        <ul className="mt-4 flex flex-col gap-1.5">
          {PHRASES.map((p) => (
            <li key={p} className="rounded-md bg-raised px-3 py-2 text-[13px] leading-5 text-text">
              “{p}”
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">
          Not connected yet?{' '}
          <Link href="/settings/connect" className="text-accent-ink underline underline-offset-2">
            Connect Claude or ChatGPT
          </Link>
        </p>
      </div>
      <div>
        <h3 className="text-sm font-semibold">Or type it here</h3>
        <p className="mt-1.5 text-sm text-muted">
          Quick add reads the same shorthand. One line per card; <span className="num text-text">;</span> splits a line too.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4">
          {QUICK_ADD_SYNTAX.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="num flex h-8 items-center border-b border-rule text-xs text-text">{k}</dt>
              <dd className="flex h-8 items-center border-b border-rule text-xs text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => openPalette('add')}>
            Add your first card
          </Button>
          <span className="flex items-center gap-1 text-xs text-faint">
            or press <Kbd>C</Kbd> anywhere, <Kbd>{MOD}</Kbd>
            <Kbd>K</Kbd> for everything
          </span>
        </div>
      </div>
    </section>
  );
}
