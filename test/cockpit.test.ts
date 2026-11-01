import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PANELS,
  cardClass,
  cardEmphasis,
  cardForEvent,
  isVisible,
  parsePanels,
  stringifyPanels,
  togglePanel,
  toggleZen,
} from '../app/src/cockpit.js';

describe('panel state', () => {
  it('starts with both panels open', () => {
    expect(DEFAULT_PANELS).toEqual({ left: true, right: true, zen: false, restore: { left: true, right: true } });
    expect(isVisible(DEFAULT_PANELS, 'left')).toBe(true);
    expect(isVisible(DEFAULT_PANELS, 'right')).toBe(true);
  });

  it('collapses one side without touching the other', () => {
    const next = togglePanel(DEFAULT_PANELS, 'left');
    expect(next.left).toBe(false);
    expect(next.right).toBe(true);
    expect(isVisible(next, 'left')).toBe(false);
  });

  it('leaves zen when a panel is toggled', () => {
    const zen = toggleZen(DEFAULT_PANELS);
    expect(zen.zen).toBe(true);
    expect(isVisible(zen, 'left')).toBe(false);
    const opened = togglePanel(zen, 'left');
    expect(opened.zen).toBe(false);
    expect(opened.left).toBe(true);
  });

  it('zen hides everything and restores what was open', () => {
    const collapsed = togglePanel(DEFAULT_PANELS, 'right');
    const zen = toggleZen(collapsed);
    expect(isVisible(zen, 'left')).toBe(false);
    expect(isVisible(zen, 'right')).toBe(false);
    const back = toggleZen(zen);
    expect(back.left).toBe(true);
    expect(back.right).toBe(false);
  });

  it('remembers the layout and survives a corrupt value', () => {
    const state = togglePanel(DEFAULT_PANELS, 'right');
    expect(parsePanels(stringifyPanels(state))).toEqual(state);
    expect(parsePanels('not json')).toEqual(DEFAULT_PANELS);
    expect(parsePanels(null)).toEqual(DEFAULT_PANELS);
    expect(parsePanels('{"left":"yes"}')).toEqual({ ...DEFAULT_PANELS, left: true });
  });
});

describe('card focus', () => {
  it('maps an event to the card that explains it', () => {
    expect(cardForEvent('memory_note')).toBe('memory');
    expect(cardForEvent('state_signal')).toBe('core');
    expect(cardForEvent('tool_result')).toBe('system');
    expect(cardForEvent('whatever')).toBeNull();
  });

  it('grows the focused card and steps the others back', () => {
    expect(cardEmphasis('memory', 'memory')).toBe(1);
    expect(cardEmphasis('core', 'memory')).toBe(0.35);
    expect(cardEmphasis('core', null)).toBe(1);
  });

  it('builds the class list the CSS expects', () => {
    expect(cardClass('core', 'core', false)).toBe('cockpit-card card-core focused');
    expect(cardClass('memory', 'core', false)).toBe('cockpit-card card-memory dimmed');
    expect(cardClass('system', null, false)).toBe('cockpit-card card-system');
  });
});

describe('cockpit markup', () => {
  const src = readFileSync('app/src/components/Cockpit.tsx', 'utf8');
  const css = readFileSync('app/src/cockpit.css', 'utf8');
  const app = readFileSync('app/src/App.tsx', 'utf8');

  it('has three cards, one core and one conversation panel', () => {
    for (const card of ['card-core', 'card-memory', 'card-system']) {
      expect(src).toContain(`cardClass('${card.replace('card-', '')}'`);
    }
    expect((src.match(/<main className="cockpit-center"/g) ?? []).length).toBe(1);
    expect(src).toContain('cockpit-conversation');
  });

  it('is reachable from the app and replaces the old dashboard grid', () => {
    expect(app).toContain('<Cockpit');
    expect(app).not.toContain('<CommandCenter');
    expect(app).toContain("import './cockpit.css'");
  });

  it('collapses: a hidden class, a zen class and the narrow rule exist', () => {
    expect(css).toContain('.cockpit-left.hidden');
    expect(css).toContain('.cockpit.zen');
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain(':has(.cockpit-left.hidden)');
  });

  it('the focused card actually changes, so the page is not a still picture', () => {
    // The focused card takes the free space and the others fade back.
    expect(css).toMatch(/\.cockpit-card\.focused\s*\{[^}]*flex:\s*1 1 auto/);
    expect(css).toMatch(/\.cockpit-card\.dimmed\s*\{[^}]*opacity:\s*0\.45/);
  });

  it('a collapsed panel leaves a handle, so it can be reopened', () => {
    expect(src).toContain('panel-handle left');
    expect(src).toContain('panel-handle right');
    expect(css).toContain('.panel-handle.left');
    expect(css).toContain('.panel-handle.right');
  });
});
