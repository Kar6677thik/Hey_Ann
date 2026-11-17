import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { renderMarkdown } from '../../lib/markdown.ts';
import { useSummary } from '../../lib/queries.ts';
import { ErrorNote, Skeleton } from '../../components/ui/bits.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Tabs } from '../../components/ui/form.tsx';

type Kind = 'standup' | 'daily' | 'weekly';

/** The server's summary marks states with symbols; on screen they read better as words (Copy keeps the original). */
const wordsForSymbols = (t: string) =>
  t.replace(/⛔\s*/g, 'blocked: ').replace(/★\s*today/g, 'planned today').replace(/★\s*/g, '').replace(/☑\s*/g, 'checklist ').replace(/⏱\s*/g, '').replace(/✅\s*/g, '');

export function SummaryPanel() {
  const [kind, setKind] = useState<Kind>('standup');
  const q = useSummary(kind);
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => (q.data ? renderMarkdown(wordsForSymbols(q.data.text)) : ''), [q.data]);
  const copy = async () => {
    if (!q.data) return;
    await navigator.clipboard?.writeText(q.data.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <section aria-labelledby="sum-h" className="rounded-lg border border-border bg-surface">
      <header className="flex items-end justify-between gap-3 px-5 pt-3">
        <div className="min-w-0">
          <h2 id="sum-h" className="text-sm font-semibold">
            Summary
          </h2>
          <Tabs label="Summary kind" value={kind} onChange={setKind} className="mt-1 border-0" options={[{ value: 'standup', label: 'Standup' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} />
        </div>
        <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copy()} disabled={!q.data} aria-live="polite">
          {copied ? 'Copied' : 'Copy Markdown'}
        </Button>
      </header>
      <div className="border-t border-rule px-5 py-4">
        {q.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-4/6" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ) : q.isError ? (
          <ErrorNote message="Couldn’t build the summary." onRetry={() => void q.refetch()} />
        ) : (
          <div className="prose-ann max-h-[420px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </section>
  );
}
