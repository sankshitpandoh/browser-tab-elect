import { useEffect, useMemo, useState } from 'react';
import { createLeaderElector } from '../core/elector';
import type { Elector, ElectorOptions, ElectorState } from '../types';

const isBrowser = typeof window !== 'undefined';

const electors = new Map<string, Elector>();
const started = new WeakMap<Elector, boolean>();

function getKey(opts?: ElectorOptions): string {
  return JSON.stringify({
    storageKey: opts?.storageKey ?? 'crest:leader',
    channelName: opts?.channelName ?? 'crest_leadership',
    leaseMs: opts?.leaseMs ?? 8000,
    renewEveryMs: opts?.renewEveryMs ?? 3000,
    electionMinBackoffMs: opts?.electionMinBackoffMs ?? 80,
    electionMaxBackoffMs: opts?.electionMaxBackoffMs ?? 200,
  });
}

function getOrCreateElector(opts?: ElectorOptions): Elector {
  const key = getKey(opts);
  let inst = electors.get(key);
  if (!inst) {
    inst = createLeaderElector(opts);
    electors.set(key, inst);
  }
  if (!started.get(inst)) {
    inst.start();
    started.set(inst, true);
  }
  return inst;
}

export function useSingleTabLeader(options?: ElectorOptions): { isLeader: boolean; tabId: string } {
  const [state, setState] = useState<ElectorState>({ isLeader: false, tabId: '', epoch: 0 });

  const elector = useMemo(() => {
    if (!isBrowser) return null;
    return getOrCreateElector(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.storageKey, options?.channelName]);

  useEffect(() => {
    if (!isBrowser || !elector) return;
    setState(elector.getState());
    const unsub = elector.subscribe((s) => setState(s));
    return () => {
      unsub();
    };
  }, [elector]);

  return { isLeader: state.isLeader, tabId: state.tabId };
}


