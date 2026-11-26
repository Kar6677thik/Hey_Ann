// Screen-time wallet: shapes (mirroring src/core/wallet.ts, which the web build can't import), calls and hooks.
// See docs/REWARDS.md and docs/API.md ("Screen-time wallet").
import { useMutation, useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Card } from '../../../src/core/types.ts';
import { ApiError, apiRequest } from './api.ts';
import { errorMessage } from './mutations.ts';
import { queryClient } from './queries.ts';

export type Phase = 'off' | 'baseline' | 'active';
export type LedgerSource = 'system' | 'web' | 'ann' | 'phone' | 'socrates';

export interface Rules {
  version: number;
  rate: number;
  priority_mult: [number, number, number, number];
  on_time_mult: number;
  on_time_notice_h: number;
  bonus: number;
  bonus_min_focus: number;
  bonus_per_day: number;
  session_cap_min: number;
  daily_earn_cap: number;
  allowance: number;
  plan_deadline: string;
  missed_plan_penalty: number;
  missed_plan_focus_min: number;
  overdue_per_day: number;
  overdue_card_cap: number;
  snooze_penalty: number;
  emergency_cost: number;
  emergency_minutes: number;
  emergency_per_week: number;
  tamper_penalty: number;
  tamper_gap_min: number;
  penalty_day_cap: number;
  penalty_week_cap: number;
  balance_cap: number;
  expiry_days: number;
  debt_floor: number;
  repay_mult: number;
  debt_pause_days: number;
  back_reward: number;
  back_per_day: number;
  unlock_max: number;
  pause_allowance: number;
  pause_per_month: number;
  ann_grant_day: number;
  ann_fine_day: number;
  veto_threshold: number;
  veto_hours: number;
  baseline_days: number;
  walled_apps: string[];
}

export interface LedgerRow {
  id: number;
  at: number;
  amount: number;
  kind: string;
  reason: string;
  card_id: number | null;
  source: LedgerSource;
  rule_version: number;
}

export interface WalletSummary {
  phase: Phase;
  started: string | null;
  baseline_until: string | null;
  balance: number;
  today: { day: string; earned: number; allowance: number; penalties: number; spent: number; refunded: number; ann: number; earn_cap: number; paused: boolean };
  debt: number;
  debt_floor: number;
  balance_cap: number;
  pending_credit: { card: Card; expected: { base: number; bonus: number; focus: number } }[];
  vetoable: LedgerRow[];
  phone: {
    phase: Phase;
    enforce: boolean;
    balance: number;
    walled_apps: string[];
    session: { id: number; app: string; kind: string; ends_at: number } | null;
    emergency: { cost: number; minutes: number; left: number };
  };
  rules: Rules;
  pending_rules: { rules: Rules; effective: string } | null;
  pause_days: { day: string; reason: string; source: LedgerSource }[];
}

export interface Device {
  id: number;
  name: string;
  created_at: number;
  last_seen: number | null;
  revoked_at: number | null;
}

export const walletApi = {
  summary: () => apiRequest<WalletSummary>('GET', '/wallet'),
  ledger: (before?: number, limit = 40) => apiRequest<{ items: LedgerRow[] }>('GET', `/wallet/ledger?limit=${limit}${before ? `&before=${before}` : ''}`),
  start: (baseline: boolean) => apiRequest<WalletSummary>('POST', '/wallet/start', { baseline }),
  /** Bring the end of the baseline week forward: the wall goes up at the start of `day` (default tomorrow). */
  endBaseline: (day?: string) => apiRequest<WalletSummary>('POST', '/wallet/end-baseline', { day }),
  setRules: (patch: Partial<Rules>) => apiRequest<{ effective: string; rules: Rules }>('PATCH', '/wallet/rules', patch),
  confirm: (cardId: number, accept: boolean) => apiRequest<{ balance: number }>('POST', `/wallet/confirm/${cardId}`, { accept }),
  veto: (id: number) => apiRequest<{ entry: LedgerRow; balance: number }>('POST', `/wallet/veto/${id}`),
  pause: (reason: string, day?: string) => apiRequest<unknown>('POST', '/wallet/pause', { reason, day }),
  fine: (minutes: number, reason: string) => apiRequest<{ entry: LedgerRow | null; balance: number }>('POST', '/wallet/fine', { minutes, reason }),
  usage: (days = 14) => apiRequest<{ items: { day: string; app: string; minutes: number }[] }>('GET', `/wallet/usage?days=${days}`),
  devices: () => apiRequest<{ items: Device[] }>('GET', '/devices'),
  pairDevice: (name: string) => apiRequest<{ id: number; name: string; token: string }>('POST', '/devices', { name }),
  revokeDevice: (id: number) => apiRequest<{ ok: boolean }>('DELETE', `/devices/${id}`),
};

export const wk = {
  summary: ['wallet', 'summary'] as const,
  ledger: ['wallet', 'ledger'] as const,
  usage: ['wallet', 'usage'] as const,
  devices: ['wallet', 'devices'] as const,
};

export const useWallet = () => useQuery({ queryKey: wk.summary, queryFn: walletApi.summary, staleTime: 15_000 });
export const useUsage = () => useQuery({ queryKey: wk.usage, queryFn: () => walletApi.usage(14) });
export const useDevices = () => useQuery({ queryKey: wk.devices, queryFn: walletApi.devices });
const LEDGER_PAGE = 40;
export const useLedger = () =>
  useInfiniteQuery({
    queryKey: wk.ledger,
    queryFn: ({ pageParam }) => walletApi.ledger(pageParam, LEDGER_PAGE),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.items.length < LEDGER_PAGE ? undefined : last.items[last.items.length - 1].id),
  });

export const refreshWallet = () => queryClient.invalidateQueries({ queryKey: ['wallet'] });

/** A wallet write: toast its message, refresh the wallet (and the board, for confirmations). */
export function useWalletWrite<V, R>(fn: (v: V) => Promise<R>, message: (r: R, v: V) => string) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      toast(message(r, v));
      void refreshWallet();
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? capitalise(err.message) : errorMessage(err)),
  });
}
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- words

/** Signed minutes: "+18", "−10", "0" (true minus sign). */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const KIND_LABEL: Record<string, string> = {
  earn: 'Earned',
  bonus: 'Bonus',
  clawback: 'Clawback',
  allowance: 'Allowance',
  forfeit: 'Allowance lost',
  penalty: 'Lapse',
  grant: 'Grant',
  fine: 'Fine',
  veto: 'Vetoed',
  spend: 'Spent',
  refund: 'Refund',
  emergency: 'Emergency',
  back: 'Went back',
  pause: 'Pause day',
  expire: 'Expired',
  wall: 'Walled apps',
  tab: 'Unpaid use',
  study: 'Study',
  mastery: 'Mastery',
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? capitalise(k.replace(/_/g, ' '));

export const SOURCE_LABEL: Record<LedgerSource, string> = { ann: 'Ann', web: 'You', phone: 'Phone', system: 'Rules', socrates: 'Socrates' };

/** Friendly names for common walled apps; anything else shows its package name. */
export const APP_LABEL: Record<string, string> = {
  'com.instagram.android': 'Instagram',
  'com.google.android.youtube': 'YouTube',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.ss.android.ugc.trill': 'TikTok',
  'com.twitter.android': 'X (Twitter)',
  'com.reddit.frontpage': 'Reddit',
  'com.snapchat.android': 'Snapchat',
  'com.facebook.katana': 'Facebook',
  'com.facebook.orca': 'Messenger',
  'com.netflix.mediaclient': 'Netflix',
  'com.amazon.avod.thirdpartyclient': 'Prime Video',
  'in.startv.hotstar': 'Hotstar',
  'com.linkedin.android': 'LinkedIn',
  'com.pinterest': 'Pinterest',
  'tv.twitch.android.app': 'Twitch',
  'com.discord': 'Discord',
  'com.whatsapp': 'WhatsApp',
  'com.android.chrome': 'Chrome',
  'com.google.android.gm': 'Gmail',
  'com.google.android.apps.maps': 'Maps',
  'com.spotify.music': 'Spotify',
};
export const appLabel = (pkg: string) => APP_LABEL[pkg] ?? pkg;
/** Ledger reasons name apps by package ("5 min on com.instagram.android"); show the friendly name. */
export const friendlyReason = (reason: string) => reason.replace(/\b[a-z]\w*(?:\.\w+)+\b/g, (m) => APP_LABEL[m] ?? m);
