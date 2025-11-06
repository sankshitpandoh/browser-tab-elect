# browser-tab-elect

Elect a single browser tab as the leader using BroadcastChannel + localStorage fencing. Only the leader performs critical work (e.g., triggering downloads), with automatic failover if the leader tab closes or crashes.

- Headless core API for any framework
- React hook `useSingleTabLeader`
- Dual ESM/CJS builds with TypeScript types

## Install

```bash
npm i browser-tab-elect
```

## Core API

```ts
import { createLeaderElector } from 'browser-tab-elect';

const elector = createLeaderElector();

elector.start();

if (elector.isLeader()) {
  // perform leader-only action
}

const unsubscribe = elector.subscribe((state) => {
  console.log('leader?', state.isLeader, 'tabId', state.tabId, 'epoch', state.epoch);
});

// later
unsubscribe();
elector.stop();
```

### Options
```ts
createLeaderElector({
  storageKey: 'citadel:leader',          // localStorage key
  channelName: 'citadel_leadership',     // BroadcastChannel name
  leaseMs: 8000,                       // leader lease duration
  renewEveryMs: 3000,                  // heartbeat interval
  electionMinBackoffMs: 80,            // election backoff window
  electionMaxBackoffMs: 200,
});
```

## React Hook

```tsx
import { useSingleTabLeader } from 'browser-tab-elect/react';

function Component() {
  const { isLeader } = useSingleTabLeader();

  // gate work
  useEffect(() => {
    if (!isLeader) return;
    // leader-only logic
  }, [isLeader]);

  return <div>{isLeader ? 'Leader' : 'Follower'}</div>;
}
```

## Protocol (high-level)
- Each tab has a UUID and competes to lead when there's no valid leader.
- Leader writes `{tabId, epoch, leaseUntil}` to localStorage and renews `leaseUntil` every ~3s.
- Followers accept the freshest epoch with a live lease and wait.
- If the lease expires or the leader steps down, a new election runs. Winner is deterministic: lexicographically highest `tabId` among candidates.
- Fencing: leader actions must verify the record matches their `tabId` and has a live lease.

## SSR and Fallbacks
- APIs are safe to import server-side; they no-op when `window` is not available.
- If `BroadcastChannel` is missing, election still functions via storage reads/writes (less responsive).

## Exports
- Root: core API
- Subpath `react`: React hook

```json
{
  "exports": {
    ".": { "import": "./dist/index.mjs", "require": "./dist/index.js" },
    "./react": { "import": "./dist/react/index.mjs", "require": "./dist/react/index.js" }
  }
}
```

## License
ISC


