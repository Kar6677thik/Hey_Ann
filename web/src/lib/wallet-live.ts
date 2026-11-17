// `event: wallet` from /api/events: refresh the wallet, and toast the entries worth knowing about.
import { createElement } from 'react';
import { toast } from 'sonner';
import { AnnMark } from '../components/ui/bits.tsx';
import { refreshWallet, signed, type LedgerRow } from './wallet.ts';

let refreshTimer: number | null = null;
// Earnings for one card arrive as two rows (earn + bonus); merge them into one toast.
const earned = new Map<number, { amount: number; title: string; timer: number }>();

const titleOf = (reason: string) => /"(.+)"/.exec(reason)?.[1] ?? null;
// wouter listens to history.pushState, so a plain push navigates.
const goWallet = { label: 'Wallet', onClick: () => window.history.pushState(null, '', '/wallet') };

export function onWalletEvent(data: string) {
  let ev: { entry: LedgerRow; balance: number };
  try {
    ev = JSON.parse(data);
  } catch {
    return;
  }
  if (refreshTimer === null) {
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refreshWallet();
    }, 150);
  }
  const e = ev.entry;
  if (!e || e.source === 'web') return; // your own actions already toasted

  if ((e.kind === 'earn' || e.kind === 'bonus') && e.card_id !== null) {
    const prev = earned.get(e.card_id);
    if (prev) clearTimeout(prev.timer);
    const next = { amount: (prev?.amount ?? 0) + e.amount, title: prev?.title ?? titleOf(e.reason) ?? `#${e.card_id}`, timer: 0 };
    next.timer = window.setTimeout(() => {
      earned.delete(e.card_id!);
      toast(`${signed(next.amount)} min · Finished “${next.title}”`, { description: `Balance ${ev.balance} min` });
    }, 400);
    earned.set(e.card_id, next);
    return;
  }
  if (e.source === 'ann' && (e.kind === 'grant' || e.kind === 'fine')) {
    toast(`Ann ${e.amount > 0 ? 'granted' : 'fined'} ${signed(e.amount)} min`, {
      description: `“${e.reason}”`,
      icon: createElement(AnnMark, { size: 16 }),
      duration: 9000,
      action: goWallet,
    });
    return;
  }
  if (e.kind === 'penalty' || e.kind === 'forfeit' || e.kind === 'clawback' || e.kind === 'emergency') {
    toast(`${signed(e.amount)} min · ${e.reason}`, {
      description: ev.balance < 0 ? `Balance ${signed(ev.balance)}. Focus repays debt faster; that’s the way back.` : `Balance ${ev.balance} min`,
      action: goWallet,
    });
  }
}
