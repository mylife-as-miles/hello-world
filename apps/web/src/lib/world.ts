import { useSyncExternalStore } from 'react';
import Dexie, { type Table } from 'dexie';
import type { ClientMessage, DirectorSettings, ServerMessage, WorldEvent, WorldEventKind, WorldEventPayload, WorldRuntime, WorldSnapshot } from '@hello-world/contracts';

const emptySnapshot: WorldSnapshot = { schemaVersion: 1, worldId: 'hello-neighborhood', residents: [], relationships: [], weather: 'sunny', eventHistory: [], simulationTime: 0 };
const initialSettings: DirectorSettings = { approvalRequired: false, cooldownSeconds: 3, maxResidents: 30, paused: false };
class WorldCache extends Dexie {
  snapshots!: Table<{ id: string; snapshot: WorldSnapshot; savedAt: number }>;
  constructor() { super('hello-world-v1'); this.version(1).stores({ snapshots: 'id,savedAt' }); }
}
const cache = new WorldCache();
interface WorldState {
  snapshot: WorldSnapshot;
  connection: 'connecting' | 'online' | 'offline';
  mode: 'demo' | 'live';
  twitch: string;
  clients: number;
  settings: DirectorSettings;
  pending: WorldEvent[];
  isDirector: boolean;
  error: string | null;
  residentId: string | null;
}

/** Read-only snapshot adapter: every mutation crosses the server validation boundary. */
class WorldConnection {
  private state: WorldState = { snapshot: emptySnapshot, connection: 'connecting', mode: 'demo', twitch: 'Checking connection…', clients: 0, settings: initialSettings, pending: [], isDirector: false, error: null, residentId: null };
  private listeners = new Set<() => void>();
  private snapshotListeners = new Set<(snapshot: WorldSnapshot) => void>();
  private socket: WebSocket | null = null;
  private retries = 0;
  private connectedOnce = false;
  private cacheTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  readonly runtime: WorldRuntime = {
    getSnapshot: () => this.state.snapshot,
    subscribe: (listener) => { this.snapshotListeners.add(listener); return () => { this.snapshotListeners.delete(listener); }; },
    dispatch: (event) => { this.send({ type: 'event', event }); },
  };
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); this.start(); return () => { this.listeners.delete(listener); }; };
  private patch(next: Partial<WorldState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
    if (next.snapshot) this.snapshotListeners.forEach(listener => listener(next.snapshot!));
  }
  private start() {
    if (this.started) return;
    this.started = true;
    void cache.snapshots.get('latest').then(row => {
      if (!this.connectedOnce && row?.snapshot.schemaVersion === 1) this.patch({ snapshot: row.snapshot });
    }).catch(() => { /* Cache may be disabled in private browsing; transport remains available. */ });
    void this.connect();
    window.addEventListener('online', () => {
      if (this.socket?.readyState !== WebSocket.OPEN && this.socket?.readyState !== WebSocket.CONNECTING) {
        clearTimeout(this.reconnectTimer); void this.connect();
      }
    });
  }
  private baseUrl() { return new URL(import.meta.env.VITE_SERVER_URL || window.location.origin); }
  private async connect() {
    this.patch({ connection: 'connecting', isDirector: false });
    try {
      const response = await fetch(new URL('/api/status', this.baseUrl()), { credentials: 'include', signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error(`World server returned ${response.status}`);
      const status = await response.json() as { viewerId?: string };
      if (status.viewerId) this.patch({ residentId: status.viewerId });
      const url = new URL('/ws', this.baseUrl());
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      this.socket = ws;
      ws.onopen = () => {
        this.retries = 0;
        this.patch({ connection: 'online', error: null });
      };
      ws.onmessage = event => {
        try { this.receive(JSON.parse(String(event.data)) as ServerMessage); }
        catch { this.patch({ error: 'The world sent an unreadable update. Reconnecting…' }); ws.close(); }
      };
      ws.onerror = () => { this.patch({ error: 'Connection interrupted. Your world will reconnect automatically.' }); };
      ws.onclose = () => { if (this.socket === ws) { this.socket = null; this.reconnect(); } };
    } catch {
      this.patch({ error: 'World server unavailable. Start the server to join; saved world is shown when available.' });
      this.reconnect();
    }
  }
  private reconnect() {
    this.patch({ connection: 'offline', isDirector: false, twitch: 'World server disconnected' });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { void this.connect(); }, Math.min(1000 * 2 ** this.retries++, 15000) + Math.random() * 500);
  }
  private receive(message: ServerMessage) {
    switch (message.type) {
      case 'snapshot': {
        if (message.snapshot.schemaVersion !== 1 || !Array.isArray(message.snapshot.residents)) throw new Error('Unsupported snapshot');
        this.connectedOnce = true;
        this.patch({ snapshot: message.snapshot });
        if (!this.cacheTimer) this.cacheTimer = setTimeout(() => {
          this.cacheTimer = undefined;
          void cache.snapshots.put({ id: 'latest', snapshot: this.state.snapshot, savedAt: Date.now() }).catch(() => {});
        }, 1000);
        break;
      }
      case 'status': this.patch({ mode: message.mode, twitch: message.twitch, clients: message.clients, settings: message.settings, pending: message.pending }); break;
      case 'director-auth': this.patch({ isDirector: message.authorized }); break;
      case 'error': this.patch({ error: message.message }); break;
      case 'event': break; // Snapshot is authoritative; never double-dispatch broadcasts.
    }
  }
  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) { this.patch({ error: 'You are offline. Reconnect before sending an action.' }); return; }
    this.socket.send(JSON.stringify(message));
  }
  sendEvent = (kind: WorldEventKind, payload?: WorldEventPayload, extras?: { targetId?: string; text?: string; displayName?: string }) => {
    this.send({ type: 'event', event: {
      id: crypto.randomUUID(), kind, source: 'viewer', actorId: this.state.residentId || 'viewer',
      actorDisplayName: extras?.displayName || this.state.snapshot.residents.find(r => r.id === this.state.residentId)?.displayName || 'Neighbor',
      timestamp: Date.now(), ...(payload ? { payload } : {}), ...(extras?.targetId ? { targetId: extras.targetId } : {}), ...(extras?.text ? { text: extras.text } : {}),
    } });
  };
  spawnDemoResident = () => {
    const names = ['Juniper', 'Atlas', 'Cleo', 'River', 'Sage', 'Indigo', 'Finn', 'Luna'];
    const suffix = Math.floor(100 + Math.random() * 900);
    this.send({ type: 'event', event: { id: crypto.randomUUID(), kind: 'join', source: 'demo', actorId: `demo:${crypto.randomUUID()}`, actorDisplayName: `${names[Math.floor(Math.random() * names.length)]} ${suffix}`, timestamp: Date.now(), payload: { personality: ['curious', 'friendly'] } } });
  };
  authenticateDirector = (key: string) => this.send({ type: 'director-auth', key });
  updateSettings = (settings: Partial<DirectorSettings>) => this.send({ type: 'director-settings', settings });
  approve = (eventId: string) => this.send({ type: 'approve', eventId });
  reject = (eventId: string) => this.send({ type: 'reject', eventId });
  reset = () => this.send({ type: 'reset' });
  clearError = () => this.patch({ error: null });
}
const world = new WorldConnection();
export function useWorld() {
  const state = useSyncExternalStore(world.subscribe, world.getState, world.getState);
  return { ...state, runtime: world.runtime, sendEvent: world.sendEvent, authenticateDirector: world.authenticateDirector, spawnDemoResident: world.spawnDemoResident, updateSettings: world.updateSettings, approve: world.approve, reject: world.reject, reset: world.reset, clearError: world.clearError };
}
