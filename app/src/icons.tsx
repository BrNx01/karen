import type { JSX } from 'react';

/**
 * Hand-drawn glyphs, one geometry table, no icon package. 20×20 viewBox, 1.5 stroke,
 * round caps: at 16 px they stay legible, at 20 px they read as a set.
 */
export type IconName =
  | 'nav.overview'
  | 'nav.chat'
  | 'nav.inbox'
  | 'nav.memory'
  | 'nav.map'
  | 'nav.skills'
  | 'nav.growth'
  | 'nav.repos'
  | 'nav.settings'
  | 'action.send'
  | 'action.mic'
  | 'action.stop'
  | 'action.attach'
  | 'action.copy'
  | 'action.refresh'
  | 'action.approve'
  | 'action.reject'
  | 'status.online'
  | 'status.offline'
  | 'status.thinking'
  | 'status.done'
  | 'status.warning'
  | 'status.error'
  | 'misc.settings'
  | 'misc.palette'
  | 'misc.chevron';

/** Path data only; the wrapper below supplies stroke, size and colour. */
export const PATHS: Record<IconName, string> = {
  'nav.overview': 'M3 3h6v6H3zM11 3h6v4h-6zM3 11h6v6H3zM11 9h6v8h-6z',
  'nav.chat': 'M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v6A2.5 2.5 0 0 1 14.5 14H9l-4 3v-3H5.5A2.5 2.5 0 0 1 3 11.5z',
  'nav.inbox': 'M3 6.5 5 3h10l2 3.5V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 11h4l1 2h4l1-2h4',
  'nav.memory': 'M8 3 4 5.5v9L8 17l4-2.5v-9zM12 5.5 16 8v9l-4 2.5M8 17v-9',
  'nav.map': 'M3 6l5-2 4 2 5-2v10l-5 2-4-2-5 2zM8 4v10M12 6v10',
  'nav.skills': 'M10 2.5 12 7l4.8.5-3.6 3.3 1 4.7L10 13.2 5.8 15.5l1-4.7L3.2 7.5 8 7z',
  'nav.growth': 'M3 16.5 8 10l3.5 3L17 5M13 5h4v4',
  'nav.repos': 'M4 4.5A1.5 1.5 0 0 1 5.5 3H16v13H5.5A1.5 1.5 0 0 0 4 17.5zM4 17.5A1.5 1.5 0 0 1 5.5 16H16',
  'nav.settings': 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4',
  'action.send': 'M3 10 17 3.5 13 10l4 6.5zM13 10H3',
  'action.mic': 'M10 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 10 3zM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v3M7.5 17h5',
  'action.stop': 'M6 6h8v8H6z',
  'action.attach': 'M12.5 6.5 7 12a2.1 2.1 0 0 0 3 3l6-6a3.5 3.5 0 0 0-5-5L5 10a5 5 0 0 0 7 7l4-4',
  'action.copy': 'M7 7h8v10H7zM5 13H3V3h10v2',
  'action.refresh': 'M16 10a6 6 0 1 1-2-4.5M16 3.5V7h-3.5',
  'action.approve': 'M3.5 10.5 8 15 16.5 5',
  'action.reject': 'M5 5l10 10M15 5 5 15',
  'status.online': 'M10 10h.01M4 10a6 6 0 0 1 12 0M6.5 10a3.5 3.5 0 0 1 7 0',
  'status.offline': 'M4 4l12 12M10 10h.01M6.5 10a3.5 3.5 0 0 1 5.5-3',
  'status.thinking': 'M10 3.5a6.5 6.5 0 1 1-6.5 6.5M10 3.5V7',
  'status.done': 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM7 10.2l2 2 4-4.2',
  'status.warning': 'M10 3.5 17.5 16.5h-15zM10 8v3.5M10 14h.01',
  'status.error': 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 7v4M10 13.5h.01',
  'misc.settings': 'M4 6h12M4 10h12M4 14h12M7 4v4M13 8v4M9 12v4',
  'misc.palette': 'M10 17a7 7 0 1 1 0-14c4 0 7 2.6 7 5.5 0 2-1.6 3.5-3.5 3.5H12l-1 2a2 2 0 0 1-1 1zM7.5 8h.01M10 6.5h.01M12.5 8h.01',
  'misc.chevron': 'M7.5 4.5 13 10l-5.5 5.5',
};

export function Icon(props: { name: IconName; size?: number; className?: string }): JSX.Element {
  const size = props.size ?? 20;
  return (
    <svg
      className={props.className ? `icon ${props.className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}
