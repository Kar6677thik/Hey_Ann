import { useRef, useState } from 'react';
import { Download, LogOut, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api.ts';
import { batchToast, errorMessage } from '../../lib/mutations.ts';
import { invalidateAll, qk, queryClient, useBackups, useSession } from '../../lib/queries.ts';
import { fmtAgo, fmtDateTime } from '../../lib/time.ts';
import { Button } from '../../components/ui/Button.tsx';
import { ErrorNote, Skeleton } from '../../components/ui/bits.tsx';
import { Modal } from '../../components/ui/overlay.tsx';
import { Section } from './shared.tsx';

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

export function DataSettings() {
  const backups = useBackups();
  const session = useSession();
  const file = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const loginRequired = session.data?.loginRequired ?? false;

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    setImporting(true);
    try {
      const data = JSON.parse(await f.text());
      const r = await api.importJson(data);
      batchToast(r.batch, { description: `${r.cards} cards added from ${f.name}` });
      void invalidateAll();
    } catch (err) {
      toast.error('Import failed', { description: err instanceof SyntaxError ? 'That file isn’t valid JSON.' : errorMessage(err) });
    } finally {
      setImporting(false);
      if (file.current) file.current.value = '';
    }
  };

  const signOut = async (everywhere: boolean) => {
    try {
      if (everywhere) await api.revokeAll();
      else await api.signOut();
      queryClient.setQueryData(qk.session, { signedIn: false, loginRequired: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <Section id="s-export" title="Export and import" description="A JSON export holds every card, column, project and tag. Importing adds cards; it never replaces what’s here.">
        <div className="flex flex-wrap gap-2">
          <Button icon={Download} onClick={() => (window.location.href = '/api/export/json')}>
            Export JSON
          </Button>
          <Button icon={Upload} onClick={() => file.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : 'Import JSON…'}
          </Button>
          <input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-label="Choose a Hey Ann JSON export" onChange={(e) => void onImport(e.target.files?.[0])} />
          <Button icon={Download} onClick={() => (window.location.href = '/api/export/db')}>
            Download database
          </Button>
        </div>
      </Section>

      <Section
        id="s-backups"
        title="Backups"
        description="The server snapshots the database every day. Take one now before something risky."
        aside={
          <Button
            size="sm"
            disabled={backingUp}
            onClick={async () => {
              setBackingUp(true);
              try {
                const r = await api.backupNow();
                toast('Backup saved', { description: r.file.split(/[\\/]/).pop() });
                void backups.refetch();
              } catch (err) {
                toast.error('Backup failed', { description: errorMessage(err) });
              } finally {
                setBackingUp(false);
              }
            }}
          >
            {backingUp ? 'Backing up…' : 'Back up now'}
          </Button>
        }
      >
        {backups.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : backups.isError ? (
          <ErrorNote message="Couldn’t list backups." onRetry={() => void backups.refetch()} />
        ) : backups.data.items.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="h-8 text-left text-xs text-faint">
                <th scope="col" className="font-normal">
                  File
                </th>
                <th scope="col" className="w-36 text-right font-normal">
                  Taken
                </th>
                <th scope="col" className="w-24 text-right font-normal">
                  Size
                </th>
              </tr>
            </thead>
            <tbody>
              {backups.data.items.slice(0, 10).map((b) => (
                <tr key={b.name} className="h-9 border-t border-rule">
                  <td className="num max-w-0 truncate text-xs text-text">{b.name}</td>
                  <td className="num text-right text-xs text-muted" title={fmtDateTime(b.at)}>
                    {fmtAgo(b.at)}
                  </td>
                  <td className="num text-right text-xs text-muted">{fmtBytes(b.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-faint">No backups yet.</p>
        )}
      </Section>

      <Section id="s-account" title="Sign-in" description={loginRequired ? 'Signing out everywhere ends every remembered device, including this one.' : 'Local mode has no sign-in, so there is nothing to sign out of.'}>
        <div className="flex flex-wrap gap-2">
          <Button icon={LogOut} disabled={!loginRequired} onClick={() => void signOut(false)}>
            Sign out
          </Button>
          <Button variant="danger" disabled={!loginRequired} onClick={() => setConfirmAll(true)}>
            Sign out everywhere…
          </Button>
        </div>
      </Section>
      <Modal open={confirmAll} onClose={() => setConfirmAll(false)} label="Sign out everywhere">
        <div className="p-5">
          <h2 className="text-[15px] font-semibold">Sign out of every device?</h2>
          <p className="mt-1.5 text-sm text-muted">All remembered sessions end, this one too. You’ll need the password on each device again. Claude and ChatGPT connections are not affected.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmAll(false)} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void signOut(true)}>
              Sign out everywhere
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
