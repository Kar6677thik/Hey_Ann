// In the card drawer: what this card earned, or that its credit waits for your confirmation.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { Card } from '../../../../src/core/types.ts';
import { useWallet, useWalletWrite, walletApi, wk } from '../../lib/wallet.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Minutes, WalletGlyph } from './parts.tsx';

// There is no per-card credit endpoint, so this scans the newest ledger rows (enough for recent cards).
const useCardLedger = (cardId: number, enabled: boolean) =>
  useQuery({
    queryKey: [...wk.ledger, 'card', cardId],
    queryFn: async () => (await walletApi.ledger(undefined, 500)).items.filter((r) => r.card_id === cardId),
    enabled,
  });

export function CardCredit({ card, done }: { card: Card; done: boolean }) {
  const w = useWallet();
  const running = !!w.data && w.data.phase !== 'off';
  const rows = useCardLedger(card.id, running && (done || card.credit_pending));
  const confirm = useWalletWrite((accept: boolean) => walletApi.confirm(card.id, accept), (_r, accept) => (accept ? 'Confirmed. Credit is in.' : 'Declined. No credit for this one.'));
  if (!running || (!done && !card.credit_pending)) return null;

  const pending = w.data!.pending_credit.find((p) => p.card.id === card.id);
  const net = (rows.data ?? []).reduce((n, r) => n + r.amount, 0);
  const bonus = (rows.data ?? []).filter((r) => r.kind === 'bonus').reduce((n, r) => n + r.amount, 0);

  return (
    <section aria-labelledby="credit-h" className="mt-4 rounded-md border border-border bg-surface px-3 py-2.5">
      <h3 id="credit-h" className="flex items-center gap-1.5 text-[11px] text-faint">
        <WalletGlyph size={12} /> Screen minutes
      </h3>
      {card.credit_pending ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[13px] text-text">
            Pending your confirmation
            {pending ? (
              <>
                : worth <Minutes value={pending.expected.base + pending.expected.bonus} />{' '}
                <span className="text-faint">for {pending.expected.focus} focus min</span>
              </>
            ) : null}
          </p>
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => confirm.mutate(false)} disabled={confirm.isPending}>
              Decline
            </Button>
            <Button size="sm" variant="primary" onClick={() => confirm.mutate(true)} disabled={confirm.isPending}>
              Confirm
            </Button>
          </span>
        </div>
      ) : rows.isPending ? (
        <p className="mt-1 text-[13px] text-faint">Checking the ledger…</p>
      ) : (
        <p className="mt-1 text-[13px] text-text">
          {net !== 0 ? (
            <>
              Earned <Minutes value={net} />
              {bonus ? <span className="text-faint"> (incl. <span className="num">+{bonus}</span> finishing bonus)</span> : null}
            </>
          ) : (
            <span className="text-muted">Earned nothing: no focus time was logged on it.</span>
          )}{' '}
          <Link href="/wallet" className="text-xs text-faint underline-offset-2 hover:text-text hover:underline">
            Ledger
          </Link>
        </p>
      )}
    </section>
  );
}
