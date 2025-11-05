export type LeaderRecord = { tabId: string; epoch: number; leaseUntil: number };

export type ElectorOptions = {
  storageKey?: string; // default 'crest:leader'
  channelName?: string; // default 'crest_leadership'
  leaseMs?: number; // default 8000
  renewEveryMs?: number; // default 3000
  electionMinBackoffMs?: number; // default 80
  electionMaxBackoffMs?: number; // default 200
};

export type ElectorState = { isLeader: boolean; tabId: string; epoch: number };

export type Elector = {
  start(): void;
  stop(): void;
  isLeader(): boolean;
  getState(): ElectorState;
  getTabId(): string;
  subscribe(listener: (s: ElectorState) => void): () => void; // unsubscribe
};


