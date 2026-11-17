// Markdown for notes and summaries. Card text can come from an AI client, so raw HTML is escaped and only
// http(s)/mailto links survive.
import { Marked, type Tokens } from 'marked';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeHref = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return esc(token.text);
    },
    link(this: { parser: { parseInline: (t: Tokens.Link['tokens']) => string } }, token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      if (!safeHref(token.href)) return text;
      const title = token.title ? ` title="${esc(token.title)}"` : '';
      return `<a href="${esc(token.href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image) {
      return safeHref(token.href) ? `<a href="${esc(token.href)}" target="_blank" rel="noopener noreferrer">${esc(token.text || token.href)}</a>` : esc(token.text);
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src ?? '') as string;
}
