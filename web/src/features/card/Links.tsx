import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { Card } from '../../../../src/core/types.ts';
import { useCardSave } from './useCardSave.ts';

const safe = (url: string) => /^https?:\/\//i.test(url);
const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function Links({ card }: { card: Card }) {
  const { save } = useCardSave(card.id);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    let u = url.trim();
    if (!u) return;
    if (!/^[a-z]+:\/\//i.test(u)) u = `https://${u}`;
    if (!safe(u)) return setError('Links must start with http:// or https://');
    const links = [...card.links, { url: u }];
    save({ links }, { optimistic: (c) => ({ ...c, links }) });
    setUrl('');
    setError(null);
  };
  return (
    <section aria-labelledby="links-h">
      <h3 id="links-h" className="text-xs font-medium text-faint">
        Links
      </h3>
      {card.links.length ? (
        <ul className="mt-1.5">
          {card.links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="group flex h-8 items-center gap-2 rounded-md px-1 hover:bg-raised">
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden className="flex-none text-faint" />
              {safe(l.url) ? (
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm text-accent-ink hover:underline">
                  {l.title || host(l.url)}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{l.url}</span>
              )}
              <span className="hidden max-w-40 truncate text-xs text-faint sm:inline">{l.title ? host(l.url) : null}</span>
              <button
                type="button"
                aria-label={`Remove link ${l.title || l.url}`}
                onClick={() => {
                  const links = card.links.filter((_, j) => j !== i);
                  save({ links }, { optimistic: (c) => ({ ...c, links }) });
                }}
                className="rounded p-1 text-faint opacity-0 hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X size={12} strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        value={url}
        onChange={(e) => (setUrl(e.target.value), setError(null))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        type="url"
        inputMode="url"
        aria-label="Add a link"
        aria-invalid={!!error}
        aria-describedby={error ? 'link-err' : undefined}
        placeholder="Paste a link, then Enter…"
        className="mt-1.5 h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-sm text-text placeholder:text-faint hover:border-border focus:border-accent focus:bg-surface focus:px-2 focus:outline-none"
      />
      {error ? (
        <p id="link-err" className="mt-1 text-xs text-[var(--pill-negative-ink)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
