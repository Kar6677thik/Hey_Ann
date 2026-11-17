import { useLocation, useParams } from 'wouter';
import { Tabs } from '../../components/ui/form.tsx';
import { ColumnsSettings, ProjectsSettings, TagsSettings } from './BoardSettings.tsx';
import { ConnectAI } from './ConnectAI.tsx';
import { DataSettings } from './DataSettings.tsx';
import { General } from './General.tsx';
import { WalletSettings } from './WalletSettings.tsx';

const SECTIONS = [
  { value: 'general', label: 'General' },
  { value: 'board', label: 'Board' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'connect', label: 'Connect AI' },
  { value: 'data', label: 'Data & sign-in' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['value'];

export default function SettingsView() {
  const params = useParams<{ section?: string }>();
  const [, navigate] = useLocation();
  const section: SectionKey = SECTIONS.some((s) => s.value === params.section) ? (params.section as SectionKey) : 'general';
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-12 md:px-6 md:pt-5">
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">{section === 'connect' ? 'Connect AI' : 'Settings'}</h1>
        <Tabs className="mt-4 overflow-x-auto" label="Settings sections" value={section} onChange={(v) => navigate(`/settings/${v}`)} options={SECTIONS.map((s) => ({ value: s.value, label: s.label }))} />
        <div className="mt-2">
          {section === 'general' ? <General /> : null}
          {section === 'board' ? (
            <>
              <ColumnsSettings />
              <ProjectsSettings />
              <TagsSettings />
            </>
          ) : null}
          {section === 'wallet' ? <WalletSettings /> : null}
          {section === 'connect' ? <ConnectAI /> : null}
          {section === 'data' ? <DataSettings /> : null}
        </div>
      </div>
    </div>
  );
}
