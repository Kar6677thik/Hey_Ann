// A one-line card row for lists outside the board (Today, triage, summaries).
import type { ReactNode } from 'react';
import type { Card } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { useBoardIndex } from '../../lib/queries.ts';
import { ProjectDot } from '../../components/ui/bits.tsx';
import { cn } from '../../components/ui/cn.ts';
import { DueChip, PriorityGlyph } from '../board/CardTile.tsx';

export function CardRow({ card, lead, meta, actions, sub, showDue = true, className }: { card: Card; lead?: ReactNode; meta?: ReactNode; actions?: ReactNode; sub?: ReactNode; showDue?: boolean; className?: string }) {
  const openCard = useOpenCard();
  const { index } = useBoardIndex();
  const project = card.project_id !== null ? index?.projectById.get(card.project_id) : undefined;
  return (
    <li className={cn('group flex min-h-11 items-center gap-3 border-b border-rule py-1.5 last:border-0', className)}>
      {lead}
      <button type="button" onClick={() => openCard(card.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="num w-8 flex-none text-[11px] text-faint">#{card.id}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm text-text group-hover:underline group-hover:decoration-faint group-hover:underline-offset-2">{card.title}</span>
            {card.priority <= 1 ? <PriorityGlyph priority={card.priority} /> : null}
          </span>
          {sub || project ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-faint">
              {project ? (
                <span className="flex flex-none items-center gap-1.5 whitespace-nowrap">
                  <ProjectDot color={project.color} className="size-1.5" />
                  {project.name}
                </span>
              ) : null}
              {sub}
            </span>
          ) : null}
        </span>
      </button>
      {meta}
      {showDue && index ? <DueChip card={card} today={index.board.today} className="flex-none" /> : null}
      {actions}
    </li>
  );
}
