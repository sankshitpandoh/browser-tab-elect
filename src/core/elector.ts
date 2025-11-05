import { Elector, ElectorOptions, ElectorState, LeaderRecord } from '../types';

function getNow(): number {
  return Date.now();
}

function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function safeRandomId(): string {
  try {
    // @ts-ignore - crypto may not exist in all environments
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      // @ts-ignore
      return crypto.randomUUID();
    }
  } catch {}
  return `tab-${getNow()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createLeaderElector(options?: ElectorOptions): Elector {
  const isBrowser = isBrowserEnv();

  const storageKey = options?.storageKey ?? 'crest:leader';
  const channelName = options?.channelName ?? 'crest_leadership';
  const leaseMs = options?.leaseMs ?? 8000;
  const renewEveryMs = options?.renewEveryMs ?? 3000;
  const electionMinBackoffMs = options?.electionMinBackoffMs ?? 80;
  const electionMaxBackoffMs = options?.electionMaxBackoffMs ?? 200;

  // SSR/no-browser safe no-op elector
  if (!isBrowser) {
    const noopState: ElectorState = { isLeader: false, tabId: '', epoch: 0 };
    return {
      start() {},
      stop() {},
      isLeader() { return false; },
      getState() { return noopState; },
      getTabId() { return ''; },
      subscribe() { return () => {}; },
    };
  }

  let channel: BroadcastChannel | null = null;
  let renewIntervalId: number | null = null;
  let leaderAliveTimeoutId: number | null = null;
  let electionInProgress = false;
  let closed = false;

  const tabId = safeRandomId();
  let epoch = 0;
  let isLeader = false;
  const subscribers = new Set<(s: ElectorState) => void>();

  const notify = () => {
    const snapshot: ElectorState = { isLeader, tabId, epoch };
    subscribers.forEach(fn => {
      try { fn(snapshot); } catch {}
    });
  };

  function readLeader(): LeaderRecord | null {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as LeaderRecord) : null;
    } catch {
      return null;
    }
  }

  function writeLeader(rec: LeaderRecord) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(rec));
    } catch {}
  }

  function scheduleLeaderAliveTimeout(leaseUntil: number) {
    if (leaderAliveTimeoutId) {
      window.clearTimeout(leaderAliveTimeoutId);
    }
    const delay = Math.max(0, leaseUntil - getNow());
    leaderAliveTimeoutId = window.setTimeout(() => {
      startElection('lease_expired');
    }, delay) as unknown as number;
  }

  function stopLeading(_reason?: string) {
    if (renewIntervalId) {
      window.clearInterval(renewIntervalId);
      renewIntervalId = null;
    }
    if (isLeader) {
      isLeader = false;
      notify();
    }
  }

  function becomeLeader(newEpoch: number) {
    const rec: LeaderRecord = {
      tabId,
      epoch: newEpoch,
      leaseUntil: getNow() + leaseMs,
    };
    writeLeader(rec);
    epoch = rec.epoch;
    isLeader = true;
    electionInProgress = false;
    notify();

    if (renewIntervalId) window.clearInterval(renewIntervalId);
    renewIntervalId = window.setInterval(() => {
      const curr = readLeader();
      if (!curr || curr.tabId !== tabId) {
        stopLeading('fenced_out');
        startElection('lost_leadership');
        return;
      }
      const updated: LeaderRecord = { ...curr, leaseUntil: getNow() + leaseMs };
      writeLeader(updated);
      try { channel?.postMessage({ type: 'HEARTBEAT', payload: updated }); } catch {}
    }, renewEveryMs) as unknown as number;

    try { channel?.postMessage({ type: 'LEADER', payload: rec }); } catch {}
  }

  async function startElection(_reason?: string) {
    if (electionInProgress || closed) return;
    electionInProgress = true;
    if (isLeader) {
      isLeader = false;
      notify();
    }

    const record = readLeader();
    const seenEpoch = record?.epoch ?? 0;

    if (record && record.leaseUntil > getNow()) {
      electionInProgress = false;
      scheduleLeaderAliveTimeout(record.leaseUntil);
      return;
    }

    const me = tabId;
    try { channel?.postMessage({ type: 'ELECT', payload: { tabId: me, seenEpoch } }); } catch {}

    const candidates = new Set<string>([me]);
    const onCandidate = (ev: MessageEvent) => {
      const msg = (ev as MessageEvent<any>).data;
      if (msg?.type === 'ELECT' && typeof msg.payload?.tabId === 'string') {
        candidates.add(msg.payload.tabId);
      }
    };
    try { channel?.addEventListener('message', onCandidate as EventListener); } catch {}

    const backoff = Math.floor(
      electionMinBackoffMs + Math.random() * (electionMaxBackoffMs - electionMinBackoffMs)
    );
    await new Promise(r => setTimeout(r, backoff));

    try { channel?.removeEventListener('message', onCandidate as EventListener); } catch {}

    const latest = readLeader();
    if (latest && latest.leaseUntil > getNow()) {
      electionInProgress = false;
      scheduleLeaderAliveTimeout(latest.leaseUntil);
      return;
    }

    const winner = [...candidates].sort().at(-1)!;
    if (winner === me) {
      const curr = readLeader();
      const newEpoch = Math.max(seenEpoch, curr?.epoch ?? 0) + 1;
      becomeLeader(newEpoch);
    } else {
      electionInProgress = false;
      window.setTimeout(() => {
        const rec2 = readLeader();
        if (!rec2 || rec2.leaseUntil <= getNow()) startElection('winner_silent');
      }, 250);
    }
  }

  function onChannelMessage(ev: MessageEvent) {
    const msg = (ev as MessageEvent<any>).data;
    if (!msg?.type) return;

    if (msg.type === 'LEADER' || msg.type === 'HEARTBEAT') {
      const rec: LeaderRecord = msg.payload;
      const current = readLeader();
      if (rec.epoch >= (current?.epoch ?? 0) && rec.leaseUntil > getNow()) {
        writeLeader(rec);
        if (rec.tabId !== tabId) {
          stopLeading('another_leader');
          scheduleLeaderAliveTimeout(rec.leaseUntil);
          electionInProgress = false;
          if (isLeader) { isLeader = false; notify(); }
        }
      }
    }

    if (msg.type === 'STEP_DOWN') {
      const current = readLeader();
      if (current && current.tabId === msg.payload?.tabId) {
        startElection('step_down');
      }
    }
  }

  function onStorageEvent(e: StorageEvent) {
    if (e.key !== storageKey || !e.newValue) return;
    try {
      const rec = JSON.parse(e.newValue) as LeaderRecord;
      if (rec.leaseUntil > getNow() && rec.tabId !== tabId) {
        stopLeading('storage_leader_seen');
        scheduleLeaderAliveTimeout(rec.leaseUntil);
      }
    } catch {}
  }

  function start() {
    if (closed) return;
    try {
      channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
    } catch {
      channel = null;
    }

    try { channel?.addEventListener('message', onChannelMessage as EventListener); } catch {}
    window.addEventListener('storage', onStorageEvent);

    const initial = readLeader();
    if (initial && initial.leaseUntil > getNow()) {
      scheduleLeaderAliveTimeout(initial.leaseUntil);
      if (initial.tabId === tabId) {
        // If storage says we are leader, ensure we renew promptly
        becomeLeader(Math.max(initial.epoch, epoch));
      }
    } else {
      // kick off
      startElection('init');
    }

    const onUnload = () => {
      closed = true;
      if (isLeader && channel) {
        try { channel.postMessage({ type: 'STEP_DOWN', payload: { tabId } }); } catch {}
      }
      stopLeading('unload');
    };
    window.addEventListener('beforeunload', onUnload);
  }

  function stop() {
    closed = true;
    try { channel?.removeEventListener('message', onChannelMessage as EventListener); } catch {}
    try { channel?.close(); } catch {}
    channel = null;
    window.removeEventListener('storage', onStorageEvent);
    if (leaderAliveTimeoutId) {
      window.clearTimeout(leaderAliveTimeoutId);
      leaderAliveTimeoutId = null;
    }
    stopLeading('stop');
  }

  return {
    start,
    stop,
    isLeader: () => isLeader,
    getState: () => ({ isLeader, tabId, epoch }),
    getTabId: () => tabId,
    subscribe(listener: (s: ElectorState) => void) {
      subscribers.add(listener);
      listener({ isLeader, tabId, epoch });
      return () => { subscribers.delete(listener); };
    },
  };
}


