import { describe, it, expect } from 'vitest';
import { createLeaderElector } from '../src';

describe('createLeaderElector', () => {
  it('returns an object with expected API', () => {
    const elector = createLeaderElector();
    expect(typeof elector.start).toBe('function');
    expect(typeof elector.stop).toBe('function');
    expect(typeof elector.isLeader).toBe('function');
    expect(typeof elector.getState).toBe('function');
    expect(typeof elector.getTabId).toBe('function');
    expect(typeof elector.subscribe).toBe('function');
  });

  it('is safe to import server-side (no window)', () => {
    // This test is informational; in Node/jsdom it depends on env.
    const hasWindow = typeof window !== 'undefined';
    const elector = createLeaderElector();
    if (!hasWindow) {
      expect(elector.isLeader()).toBe(false);
      expect(elector.getState().tabId).toBe('');
    } else {
      expect(elector.getTabId()).not.toBe('');
    }
  });
});


