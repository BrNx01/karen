import type { Key } from '../../shared/i18n/index.js';
import type { IconName } from './icons.js';
import type { StageScreen } from './components/CommandCenter.js';

export type RailItem = { id: StageScreen; labelKey: Key; icon: IconName };

/** The rail, in order. Settings is pinned to the bottom, so it stays last. */
export const RAIL: RailItem[] = [
  { id: 'overview', labelKey: 'nav.overview', icon: 'nav.overview' },
  { id: 'chat', labelKey: 'nav.chat', icon: 'nav.chat' },
  { id: 'inbox', labelKey: 'nav.inbox', icon: 'nav.inbox' },
  { id: 'memory', labelKey: 'nav.memory', icon: 'nav.memory' },
  { id: 'map', labelKey: 'nav.map', icon: 'nav.map' },
  { id: 'skills', labelKey: 'nav.skills', icon: 'nav.skills' },
  { id: 'growth', labelKey: 'nav.growth', icon: 'nav.growth' },
  { id: 'repos', labelKey: 'nav.repos', icon: 'nav.repos' },
  { id: 'settings', labelKey: 'nav.settings', icon: 'nav.settings' },
];

export function railOrder(screen: StageScreen): number {
  return RAIL.findIndex((item) => item.id === screen);
}

/** Below this width the rail becomes a bottom bar and the context panel a drawer. */
export function shouldCollapse(width: number): boolean {
  return width < 900;
}
