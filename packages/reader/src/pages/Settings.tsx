import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft } from '../components/icons';
import { Spinner } from '../components/Spinner';
import { useSettings } from '../hooks/useSettings';
import { MIN_REFRESH_MINUTES } from '@perch/core/types';
import { useBackend } from '../backend';
import { Row, Section, Segmented } from './settings-ui';
import { AppearanceSection } from './Appearance';

export function Settings({ extra }: { extra?: ReactNode }) {
  const backend = useBackend();
  const { settings, loaded, update } = useSettings();

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-6 py-8">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <IconArrowLeft size={14} /> Back to reader
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-[var(--text-faint)]">{backend.copy.settingsIntro}</p>

        <Section title="Reading">
          {backend.features.openMode && (
            <Row label="Open the reader as" hint="Where “Open RSS Reader” takes you.">
              <Segmented
                value={settings.openMode}
                onChange={(v) => update({ openMode: v as 'tab' | 'window' })}
                options={[
                  { value: 'tab', label: 'Browser tab' },
                  { value: 'window', label: 'App window' },
                ]}
              />
            </Row>
          )}
          <Row label="Reading font">
            <Segmented
              value={settings.readingFont}
              onChange={(v) => update({ readingFont: v as 'sans' | 'serif' })}
              options={[
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
              ]}
            />
          </Row>
        </Section>

        <AppearanceSection settings={settings} update={update} />

        {backend.features.refreshInterval && (
          <Section title="Refreshing">
            <Row
              label="Background refresh interval"
              hint={`How often Perch checks your feeds in the background. Minimum ${MIN_REFRESH_MINUTES} minutes.`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_REFRESH_MINUTES}
                  value={settings.refreshIntervalMinutes}
                  onChange={(e) =>
                    update({
                      refreshIntervalMinutes: Number(e.target.value) || MIN_REFRESH_MINUTES,
                    })
                  }
                  className="w-20 rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px]"
                />
                <span className="text-[12px] text-[var(--text-faint)]">minutes</span>
              </div>
            </Row>
          </Section>
        )}

        {extra}

        <p className="mt-10 text-[11.5px] text-[var(--text-faint)]">
          Perch is open source and MIT licensed.
        </p>
      </div>
    </div>
  );
}
