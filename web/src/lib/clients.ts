import type { Actor } from '../../../src/core/types.ts';

/** "claude-ai" -> "Claude", "openai-mcp" -> "ChatGPT"; unknown names pass through tidied. */
export function clientLabel(client: string | null | undefined): string {
  if (!client) return 'an AI client';
  const c = client.toLowerCase();
  if (c.includes('claude-code') || c === 'claude code') return 'Claude Code';
  if (c.includes('claude') || c.includes('anthropic')) return 'Claude';
  if (c.includes('openai') || c.includes('chatgpt') || c.includes('gpt')) return 'ChatGPT';
  if (c.includes('cursor')) return 'Cursor';
  if (c.includes('orbit-hub') || c === 'orbit hub') return 'Orbit Hub';
  return client.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export function actorLabel(actor: Actor, client: string | null): string {
  if (actor === 'ann') return `Ann via ${clientLabel(client)}`;
  if (actor === 'system') return 'System';
  return 'You';
}
