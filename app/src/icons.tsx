import type { JSX } from 'react';
import { PATHS, type IconName } from './icon-paths.js';

export { PATHS, type IconName };

export function Icon(props: { name: IconName; size?: number; className?: string }): JSX.Element {
  const cls = props.className === undefined ? 'icon' : 'icon ' + props.className;
  return (
    <svg className={cls} width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[props.name]} />
    </svg>
  );
}
