import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  autoOpen,
  closePanel,
  DEFAULT_COCKPIT,
  togglePanel,
  toggleZen,
} from '../app/src/cockpit-state.js';

describe('cockpit state', () => {
  it('opens with nothing on screen', () => {
    expect(DEFAULT_COCKPIT).toEqual({ panel: null, zen: false });
  });

  it('opens a panel on click and closes it on the second click', () => {
    const opened = togglePanel(DEFAULT_COCKPIT, 'memory');
    expect(opened.panel).toBe('memory');
    expect(togglePanel(opened, 'memory').panel).toBeNull();
  });

  it('switches straight from one panel to another', () => {
    expect(togglePanel(togglePanel(DEFAULT_COCKPIT, 'system'), 'memory').panel).toBe('memory');
  });

  it('closes without touching zen', () => {
    expect(closePanel(togglePanel(DEFAULT_COCKPIT, 'inbox'))).toEqual(DEFAULT_COCKPIT);
    expect(closePanel(DEFAULT_COCKPIT)).toBe(DEFAULT_COCKPIT);
  });

  it('zen clears the panel, and leaving zen does not reopen it', () => {
    const zen = toggleZen(togglePanel(DEFAULT_COCKPIT, 'system'));
    expect(zen).toEqual({ zen: true, panel: null });
    expect(toggleZen(zen)).toEqual({ zen: false, panel: null });
  });

  it('surfaces the conversation when a reply or an approval arrives', () => {
    expect(autoOpen(DEFAULT_COCKPIT, 'streaming').panel).toBe('conversation');
    expect(autoOpen(DEFAULT_COCKPIT, 'approval').panel).toBe('conversation');
  });

  it('never steals an open panel or an empty screen', () => {
    const memory = togglePanel(DEFAULT_COCKPIT, 'memory');
    expect(autoOpen(memory, 'streaming')).toBe(memory);
    const zen = toggleZen(DEFAULT_COCKPIT);
    expect(autoOpen(zen, 'approval')).toBe(zen);
  });
});

describe('cockpit markup', () => {
  const src = readFileSync('app/src/components/Cockpit.tsx', 'utf8');
  const css = readFileSync('app/src/cockpit.css', 'utf8');
  const app = readFileSync('app/src/App.tsx', 'utf8');

  it('is a bare stage: one core, one dock, no permanent cards', () => {
    expect((src.match(/<main className="cockpit-center"/g) ?? []).length).toBe(1);
    expect((src.match(/cockpit-dock/g) ?? []).length).toBeGreaterThan(0);
    // The old always-on cards are gone.
    expect(src).not.toContain('cockpit-card');
    expect(css).not.toContain('.cockpit-card');
  });

  it('puts only small icons in the dock, and they grow on hover', () => {
    expect(css).toMatch(/\.dock-item\s*\{[^}]*width:\s*44px/);
    expect(css).toMatch(/\.dock-item:hover \.dock-icon[^{]*\{[^}]*scale\(1\.35\)/);
    expect(css).toMatch(/\.dock-label\s*\{[^}]*position:\s*absolute/);
  });

  it('opens a panel rather than laying every panel out at once', () => {
    expect(src).toContain('panel !== null &&');
    expect(css).toMatch(/\.cockpit-panel\s*\{[^}]*position:\s*absolute/);
  });

  it('is reachable from the app and replaces the old dashboard', () => {
    expect(app).toContain('<Cockpit');
    expect(app).not.toContain('<CommandCenter');
  });
});
