// Server state: query keys and read hooks.
import { QueryClient, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, api, type CardQuery } from './api.ts';
import { syncClock } from './time.ts';
import type { BoardSnapshot, Card, Column } from '../../../src/core/types.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (n, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && n < 2,
    },
  },
});

export const qk = {
  session: ['session'] as const,
  board: ['board'] as const,
  card: (id: number) => ['card', id] as const,
  cards: (q: CardQuery) => ['cards', q] as const,
  projects: ['projects'] as const,
  activity: (actor: string) => ['activity', actor] as const,
  insights: (days: number) => ['insights', days] as const,
  plan: ['plan'] as const,
  next: ['next'] as const,
  triage: ['triage'] as const,
  summary: (kind: string) => ['summary', kind] as const,
  settings: ['settings'] as const,
  mcpInfo: ['mcp-info'] as const,
  backups: ['backups'] as const,
};

export const useSession = () => useQuery({ queryKey: qk.session, queryFn: api.session, staleTime: 60_000, retry: 1 });

async function fetchBoard(): Promise<BoardSnapshot> {
  const b = await api.board();
  syncClock(b.now, b.settings.timezone);
  return b;
}
export const useBoard = <T = BoardSnapshot>(select?: (b: BoardSnapshot) => T) =>
  useQuery({ queryKey: qk.board, queryFn: fetchBoard, select });

/** Lookup maps derived from the board, memoised per snapshot. */
export interface BoardIndex {
  board: BoardSnapshot;
  columns: Column[];
  colById: Map<number, Column>;
  cardsByColumn: Map<number, Card[]>;
  projectById: Map<number, BoardSnapshot['projects'][number]>;
  cardById: Map<number, Card>;
  doneIds: Set<number>;
}
export function indexBoard(board: BoardSnapshot): BoardIndex {
  const columns = board.columns.toSorted((a, b) => a.position - b.position);
  const colById = new Map(columns.map((c) => [c.id, c]));
  const cardsByColumn = new Map<number, Card[]>(columns.map((c) => [c.id, []]));
  for (const card of board.cards) cardsByColumn.get(card.column_id)?.push(card);
  for (const list of cardsByColumn.values()) list.sort((a, b) => a.position - b.position);
  const doneIds = new Set(columns.filter((c) => c.kind === 'done').map((c) => c.id));
  return {
    board,
    columns,
    colById,
    cardsByColumn,
    projectById: new Map(board.projects.map((p) => [p.id, p])),
    cardById: new Map(board.cards.map((c) => [c.id, c])),
    doneIds,
  };
}
export function useBoardIndex() {
  const q = useBoard();
  const index = useMemo(() => (q.data ? indexBoard(q.data) : null), [q.data]);
  return { ...q, index };
}

export const useCard = (id: number | null) =>
  useQuery({ queryKey: qk.card(id ?? 0), queryFn: () => api.card(id!), enabled: id !== null && id > 0 });
export const useCards = (q: CardQuery, enabled = true) =>
  useQuery({ queryKey: qk.cards(q), queryFn: () => api.cards(q), enabled, placeholderData: keepPreviousData });
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: api.projects });
export const useInsights = (days: number) =>
  useQuery({ queryKey: qk.insights(days), queryFn: () => api.insights(days), placeholderData: keepPreviousData });
export const usePlan = () => useQuery({ queryKey: qk.plan, queryFn: () => api.plan() });
export const useNext = () => useQuery({ queryKey: qk.next, queryFn: () => api.next() });
export const useTriage = () => useQuery({ queryKey: qk.triage, queryFn: api.triage });
export const useSummary = (kind: 'standup' | 'daily' | 'weekly') => useQuery({ queryKey: qk.summary(kind), queryFn: () => api.summary(kind) });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.settings });
export const useMcpInfo = () => useQuery({ queryKey: qk.mcpInfo, queryFn: api.mcpInfo, staleTime: 5 * 60_000 });
export const useBackups = () => useQuery({ queryKey: qk.backups, queryFn: api.backups });

export const ACTIVITY_PAGE = 30;
export const useActivity = (actor: 'all' | 'web' | 'ann' | 'system') =>
  useInfiniteQuery({
    queryKey: qk.activity(actor),
    queryFn: ({ pageParam }) => api.activity({ limit: ACTIVITY_PAGE, before: pageParam, actor: actor === 'all' ? undefined : actor }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.items.length < ACTIVITY_PAGE ? undefined : last.items[last.items.length - 1].at),
  });

/** Everything that reads board state goes stale after any write. */
export function invalidateAll() {
  return queryClient.invalidateQueries({ predicate: (q) => !['session', 'mcp-info'].includes(String(q.queryKey[0])) });
}
