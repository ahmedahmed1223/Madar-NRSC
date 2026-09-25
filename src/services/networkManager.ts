export interface OfflineMutation {
  id: string;
  type: 'SYNC_RUNDOWN' | 'UPDATE_NEWS' | 'UPDATE_EPISODE' | 'CREATE_NEWS' | 'GENERIC';
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: any;
  createdAt: string;
  retryCount: number;
}

export interface NetworkHealthState {
  isOnline: boolean;
  serverReachable: boolean;
  latencyMs: number;
  lastHeartbeat: string | null;
  pendingMutationsCount: number;
  consecutiveFailures: number;
}

const QUEUE_STORAGE_KEY = 'nrcs_offline_mutations_queue_v1';

class NetworkResilienceManager {
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private serverReachable = true;
  private latencyMs = 0;
  private lastHeartbeat: string | null = null;
  private consecutiveFailures = 0;
  private listeners: Array<(state: NetworkHealthState) => void> = [];
  private isDrainingQueue = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));

      // Periodic heartbeat check every 20 seconds
      this.checkServerHealth();
      setInterval(() => {
        this.checkServerHealth();
      }, 20000);
    }
  }

  public subscribe(callback: (state: NetworkHealthState) => void): () => void {
    this.listeners.push(callback);
    callback(this.getState());
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((cb) => {
      try {
        cb(state);
      } catch (e) {
        console.warn('[NetworkManager] Listener error:', e);
      }
    });
  }

  public getState(): NetworkHealthState {
    return {
      isOnline: this.isOnline,
      serverReachable: this.serverReachable,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      pendingMutationsCount: this.getPendingMutations().length,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private handleNetworkChange(online: boolean) {
    this.isOnline = online;
    if (online) {
      this.checkServerHealth().then(() => {
        this.drainOfflineQueue();
      });
    } else {
      this.serverReachable = false;
      this.notify();
    }
  }

  /**
   * Ping backend health endpoint and compute real roundtrip latency
   */
  public async checkServerHealth(): Promise<boolean> {
    if (!navigator.onLine) {
      this.isOnline = false;
      this.serverReachable = false;
      this.notify();
      return false;
    }

    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-cache',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const roundtrip = Math.round(performance.now() - startTime);
        this.latencyMs = roundtrip;
        this.serverReachable = true;
        this.consecutiveFailures = 0;
        this.lastHeartbeat = new Date().toISOString();
        this.notify();

        // Drain any pending mutations if server is reachable
        if (this.getPendingMutations().length > 0) {
          this.drainOfflineQueue();
        }
        return true;
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (err) {
      this.serverReachable = false;
      this.consecutiveFailures++;
      this.latencyMs = 0;
      this.notify();
      return false;
    }
  }

  /**
   * Enqueue mutation to be safely sent when connection recovers
   */
  public enqueueMutation(
    type: OfflineMutation['type'],
    endpoint: string,
    method: OfflineMutation['method'],
    payload: any
  ): void {
    const queue = this.getPendingMutations();
    const mutation: OfflineMutation = {
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type,
      endpoint,
      method,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    queue.push(mutation);
    this.savePendingMutations(queue);
    this.notify();

    // Try immediate execution if online
    if (this.serverReachable) {
      this.drainOfflineQueue();
    }
  }

  public getPendingMutations(): OfflineMutation[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private savePendingMutations(queue: OfflineMutation[]) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('[NetworkManager] Failed to save queue to localStorage:', e);
    }
  }

  /**
   * Drain pending offline mutations sequentially
   */
  public async drainOfflineQueue(): Promise<{ synced: number; failed: number }> {
    if (this.isDrainingQueue) return { synced: 0, failed: 0 };
    const queue = this.getPendingMutations();
    if (queue.length === 0) return { synced: 0, failed: 0 };

    this.isDrainingQueue = true;
    let synced = 0;
    let failed = 0;
    const remaining: OfflineMutation[] = [];

    for (const item of queue) {
      try {
        const res = await fetch(item.endpoint, {
          method: item.method,
          headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' },
          credentials: 'same-origin',
          body: item.payload ? JSON.stringify(item.payload) : undefined,
        });

        if (res.ok) {
          synced++;
        } else if (res.status >= 500 && item.retryCount < 5) {
          item.retryCount++;
          remaining.push(item);
          failed++;
        } else {
          // Unrecoverable (e.g. 400 bad request) - discard to avoid blocking queue
          failed++;
        }
      } catch (networkErr) {
        item.retryCount++;
        remaining.push(item);
        failed++;
        break; // Stop draining if network failed mid-way
      }
    }

    this.savePendingMutations(remaining);
    this.isDrainingQueue = false;
    this.notify();

    return { synced, failed };
  }

  public clearQueue() {
    this.savePendingMutations([]);
    this.notify();
  }
}

export const networkResilienceManager = new NetworkResilienceManager();
