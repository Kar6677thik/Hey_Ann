import { useMcpInfo } from '../../lib/queries.ts';
import { AnnMark, ErrorNote, Pill, Skeleton } from '../../components/ui/bits.tsx';
import { CopyField, Section } from './shared.tsx';

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-2 flex flex-col gap-2">
      {items.map((s, i) => (
        <li key={i} className="grid grid-cols-[20px_1fr] gap-2 text-[13px] leading-5 text-text">
          <span className="num pt-px text-xs text-faint">{i + 1}.</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

const K = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-text">{children}</span>;

export function ConnectAI() {
  const q = useMcpInfo();
  if (q.isPending) return <Skeleton className="mt-6 h-96 w-full rounded-lg" />;
  if (q.isError) return <ErrorNote className="mt-6" message="Couldn’t load the connection details." onRetry={() => void q.refetch()} />;
  const info = q.data;
  const remote = info.mode === 'oauth';
  return (
    <>
      <Section
        id="s-mcp"
        title="Your MCP server"
        description={
          remote
            ? 'Claude and ChatGPT connect to this URL from their clouds. They sign in through Orbit Identity (OAuth); no token to paste.'
            : info.mode === 'local'
              ? 'Local mode: the server runs on this machine. Desktop clients connect with the token below; cloud apps (Claude.ai, ChatGPT) need the deployed server.'
              : 'The MCP endpoint is turned off on this server. Claude Code can still use the local stdio command.'
        }
        aside={<Pill tone={remote ? 'positive' : 'neutral'}>{remote ? 'Remote · OAuth' : info.mode === 'local' ? 'Local · token' : 'Off'}</Pill>}
      >
        <div className="flex flex-col gap-4">
          {info.url ? <CopyField id="mcp-url" label="MCP URL" value={info.url} /> : null}
          {info.token ? <CopyField id="mcp-token" label="Bearer token" value={info.token} mask /> : null}
          {info.path_token_url ? <CopyField id="mcp-path" label="URL with the token in the path (for clients that can’t send headers)" value={info.path_token_url} mask /> : null}
          <CopyField id="mcp-cc" label="Claude Code" value={info.claude_code} />
        </div>
      </Section>

      <Section
        id="s-snippet"
        title="Teach them “Hey Ann”"
        description="Paste this into Claude (Settings › Profile, or a Project’s instructions) and ChatGPT (Settings › Personalization › Custom instructions), so a message starting “Hey Ann” goes to your board."
      >
        <CopyField id="snippet" label="Custom instructions" value={info.instructions_snippet} multiline />
      </Section>

      <Section id="s-claude" title="Claude.ai" description="Works on the free and paid plans with a custom connector.">
        <Steps
          items={[
            <>
              Open <K>Settings › Connectors</K> and choose <K>Add custom connector</K>.
            </>,
            <>
              Name it <K>Hey Ann</K> and paste the MCP URL{info.url ? '' : ' (from the deployed server)'}.
            </>,
            <>{remote ? 'Click Connect and sign in with Orbit Identity when asked.' : 'Cloud apps can’t reach a local server; deploy first, then come back.'}</>,
            <>
              In a chat, enable the connector from the <K>tools</K> menu, then say <K>“Hey Ann, what’s on my board?”</K>
            </>,
          ]}
        />
      </Section>

      <Section id="s-chatgpt" title="ChatGPT" description="Custom connectors live behind developer mode.">
        <Steps
          items={[
            <>
              Open <K>Settings › Apps & Connectors › Advanced</K> and turn on <K>Developer mode</K>.
            </>,
            <>
              Back in <K>Apps & Connectors</K>, choose <K>Create</K>. Name it <K>Hey Ann</K>, paste the MCP URL, and pick <K>OAuth</K> for authentication.
            </>,
            <>Sign in when asked, then tick “I trust this application”.</>,
            <>
              In a new chat, pick it from the <K>+</K> menu (Developer mode), then say <K>“Hey Ann, plan my day”</K>.
            </>,
          ]}
        />
        <p className="mt-4 flex items-center gap-2 text-xs text-faint">
          <AnnMark size={14} /> Everything Ann changes shows up live on the board, with Undo.
        </p>
      </Section>
    </>
  );
}
