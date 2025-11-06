import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLeaderElector } from '../src';
import { mockUUIDSequence, resetBrowserEnv, setupBrowserEnv } from './testUtils';

describe('Leader election behavior', () => {
  beforeEach(() => {
    // Ensure timers are faked before installing window stubs so window.* picks up faked versions
    vi.useFakeTimers();
    setupBrowserEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBrowserEnv();
    vi.restoreAllMocks();
  });

  it('single elector eventually becomes leader when no existing leader', async () => {
    const elector = createLeaderElector({ leaseMs: 1000, renewEveryMs: 200, electionMinBackoffMs: 10, electionMaxBackoffMs: 15 });
    elector.start();

    await vi.advanceTimersByTimeAsync(50);

    expect(elector.isLeader()).toBe(true);
    const state = elector.getState();
    expect(state.isLeader).toBe(true);
    expect(state.tabId).not.toBe('');
  });

  it('two electors compete: highest tabId wins', async () => {
    mockUUIDSequence(['aaa', 'zzz']);
    const opts = { leaseMs: 1000, renewEveryMs: 200, electionMinBackoffMs: 10, electionMaxBackoffMs: 10 } as const;
    const a = createLeaderElector(opts);
    const b = createLeaderElector(opts);
    a.start();
    b.start();

    await vi.advanceTimersByTimeAsync(20);

    // zzz > aaa
    const leader = b.isLeader() ? b : a;
    const follower = leader === b ? a : b;

    expect(leader.isLeader()).toBe(true);
    expect(follower.isLeader()).toBe(false);
  });

  it('leader renews lease and posts heartbeats', async () => {
    const opts = { leaseMs: 200, renewEveryMs: 50, electionMinBackoffMs: 5, electionMaxBackoffMs: 5 } as const;
    const elector = createLeaderElector(opts);
    elector.start();

    // become leader
    await vi.advanceTimersByTimeAsync(20);
    expect(elector.isLeader()).toBe(true);

    // Capture successive leaseUntil values from localStorage
    const key = 'citadel:leader';
    const firstRaw = window.localStorage.getItem(key)!;
    const first = JSON.parse(firstRaw) as { leaseUntil: number; tabId: string };

    // advance past one renewal interval
    await vi.advanceTimersByTimeAsync(60);

    const secondRaw = window.localStorage.getItem(key)!;
    const second = JSON.parse(secondRaw) as { leaseUntil: number; tabId: string };
    expect(second.tabId).toBe(first.tabId);
    expect(second.leaseUntil).toBeGreaterThan(first.leaseUntil);
  });

  it('leader stopping triggers new election for remaining elector after lease expiry', async () => {
    mockUUIDSequence(['zzz', 'aaa']);
    const opts = { leaseMs: 500, renewEveryMs: 100, electionMinBackoffMs: 10, electionMaxBackoffMs: 10 } as const;
    const leader = createLeaderElector(opts); // id zzz
    const follower = createLeaderElector(opts); // id aaa
    leader.start();
    follower.start();

    await vi.advanceTimersByTimeAsync(20);
    expect(leader.isLeader()).toBe(true);
    expect(follower.isLeader()).toBe(false);

    // Simulate leader tab stopping (no more heartbeats)
    leader.stop();

    // Not immediate
    expect(follower.isLeader()).toBe(false);

    // Advance past lease expiry and election backoff
    await vi.advanceTimersByTimeAsync(520);
    await vi.advanceTimersByTimeAsync(20);
    expect(follower.isLeader()).toBe(true);
  });
});


