import { vi } from 'vitest';

type EventListenerFn = (ev: any) => void;

type WindowStub = {
  addEventListener(type: string, listener: EventListenerFn): void;
  removeEventListener(type: string, listener: EventListenerFn): void;
  dispatchEvent(event: any): void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  localStorage: Storage;
};

class LocalStorageStub implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
    // Fire a minimal storage event
    const w = globalThis.window as unknown as WindowStub | undefined;
    w?.dispatchEvent({ type: 'storage', key, newValue: null });
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
    // Fire a minimal storage event
    const w = globalThis.window as unknown as WindowStub | undefined;
    w?.dispatchEvent({ type: 'storage', key, newValue: value });
  }
}

type ChannelListener = (ev: MessageEvent) => void;

const channelRegistry: Map<string, Set<BroadcastChannelStub>> = new Map();

class BroadcastChannelStub implements BroadcastChannel {
  readonly name: string;
  private listeners = new Set<ChannelListener>();
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;
  onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;

  constructor(name: string) {
    this.name = name;
    let set = channelRegistry.get(name);
    if (!set) {
      set = new Set();
      channelRegistry.set(name, set);
    }
    set.add(this);
  }

  close(): void {
    const set = channelRegistry.get(this.name);
    set?.delete(this);
    this.listeners.clear();
  }

  postMessage(message: any): void {
    const set = channelRegistry.get(this.name);
    if (!set) return;
    const evt = { data: message } as MessageEvent;
    for (const ch of set) {
      for (const l of ch.listeners) {
        try { l(evt); } catch {}
      }
      if (ch.onmessage) {
        try { ch.onmessage.call(ch, evt); } catch {}
      }
    }
  }

  addEventListener(type: string, listener: EventListenerFn): void {
    if (type !== 'message') return;
    this.listeners.add(listener as ChannelListener);
  }

  removeEventListener(type: string, listener: EventListenerFn): void {
    if (type !== 'message') return;
    this.listeners.delete(listener as ChannelListener);
  }

  // Unused in our tests, but required by interface
  addEventListener2(): any {}
  removeEventListener2(): any {}
  dispatchEvent(): boolean { return true; }
}

const windowListeners = new Map<string, Set<EventListenerFn>>();

function createWindowStub(): WindowStub {
  const w: WindowStub = {
    addEventListener(type: string, listener: EventListenerFn) {
      let set = windowListeners.get(type);
      if (!set) {
        set = new Set();
        windowListeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerFn) {
      windowListeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: any) {
      const set = windowListeners.get(event?.type);
      if (!set) return;
      for (const l of Array.from(set)) {
        try { l(event); } catch {}
      }
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    localStorage: new LocalStorageStub(),
  };
  return w;
}

export function setupBrowserEnv(): void {
  // Timers must be faked by the test using vi.useFakeTimers()
  // Provide minimal browser-like globals
  // @ts-ignore
  globalThis.window = createWindowStub();
  // @ts-ignore
  globalThis.document = {};
  // @ts-ignore
  globalThis.BroadcastChannel = BroadcastChannelStub as unknown as any;
}

export function resetBrowserEnv(): void {
  windowListeners.clear();
  channelRegistry.clear();
  // @ts-ignore
  delete (globalThis as any).window;
  // @ts-ignore
  delete (globalThis as any).document;
  // @ts-ignore
  delete (globalThis as any).BroadcastChannel;
  // crypto is conditionally mocked per test
  // @ts-ignore
  if ((globalThis as any).crypto && 'randomUUID' in (globalThis as any).crypto) {
    // @ts-ignore
    delete (globalThis as any).crypto;
  }
}

export function mockUUIDSequence(values: string[]) {
  const seq = [...values];
  const fake = {
    randomUUID: vi.fn(() => (seq.length ? seq.shift()! : `uuid-${Math.random().toString(36).slice(2)}`)),
  };
  // @ts-ignore
  globalThis.crypto = fake as any;
}


