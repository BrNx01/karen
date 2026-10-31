import { useEffect, useState } from 'react';
import { getJson } from '../api.js';
import { useI18n } from '../i18n.js';
import type { Key } from '../../../shared/i18n/index.js';

type Phase = 'gece' | 'sabah' | 'gunduz' | 'aksam';

type Payload = {
  state: { cortisol: number; dopamine: number; serotonin: number; fatigue: number; circadian: number; phase: Phase };
  temperature: number;
};

const BARS: { key: 'cortisol' | 'dopamine' | 'serotonin' | 'fatigue'; labelKey: Key; color: string }[] = [
  { key: 'cortisol', labelKey: 'state.cortisol', color: 'var(--danger)' },
  { key: 'dopamine', labelKey: 'state.dopamine', color: 'var(--accent)' },
  { key: 'serotonin', labelKey: 'state.serotonin', color: 'var(--ok)' },
  { key: 'fatigue', labelKey: 'state.fatigue', color: 'var(--muted)' },
];

export function StateStrip() {
  const { t } = useI18n();
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const next = await getJson<Payload>('/api/state');
        if (alive) setData(next);
      } catch {
        /* server down: the last good data stays on screen, the strip does not break */
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!data?.state) return null;

  const { state, temperature } = data;

  return (
    <div className="cc-state-strip">
      {BARS.map((bar) => (
        <div key={bar.key} className="cc-state-item">
          <span className="cc-state-label">{t(bar.labelKey)}</span>
          <div className="cc-state-bar">
            <span style={{ width: `${pct(state[bar.key])}%`, background: bar.color }} />
          </div>
        </div>
      ))}
      <div className="cc-state-meta">
        <span>{t(`state.phase.${state.phase}` as never)}</span>
        <b>{Number.isFinite(temperature) ? temperature.toFixed(2) : '—'}</b>
      </div>
    </div>
  );
}

/** A malformed payload must not overflow the bar: the 0..1 value is clamped to a percentage. */
function pct(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value * 100)) : 0;
}
