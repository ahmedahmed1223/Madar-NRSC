export interface DraftVaultEntry {
  vaultKey: string;
  itemType: 'NEWS' | 'EPISODE' | 'RUNDOWN' | 'TELEPROMPTER' | 'BREAKING';
  itemId?: string;
  title: string;
  data: any;
  timestamp: number;
  formattedDate: string;
}

const VAULT_STORAGE_KEY = 'nrcs_editor_vault_v1';

class DraftVaultManager {
  /**
   * Save an active editing draft snapshot to local recovery vault
   */
  public saveSnapshot(
    vaultKey: string,
    itemType: DraftVaultEntry['itemType'],
    title: string,
    data: any,
    itemId?: string
  ): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const vault = this.getAllSnapshotsMap();
      const entry: DraftVaultEntry = {
        vaultKey,
        itemType,
        itemId,
        title: title || 'مسودة عمل بدون عنوان',
        data,
        timestamp: Date.now(),
        formattedDate: new Date().toLocaleTimeString('ar-SA', { hour12: false }),
      };
      vault[vaultKey] = entry;
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
    } catch (err) {
      console.warn('[DraftVault] Quota or write issue while saving snapshot:', err);
    }
  }

  /**
   * Retrieve a specific snapshot
   */
  public getSnapshot(vaultKey: string): DraftVaultEntry | null {
    const vault = this.getAllSnapshotsMap();
    return vault[vaultKey] || null;
  }

  /**
   * Remove snapshot once user deliberately saves or discards
   */
  public clearSnapshot(vaultKey: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const vault = this.getAllSnapshotsMap();
      if (vault[vaultKey]) {
        delete vault[vaultKey];
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
      }
    } catch {}
  }

  /**
   * Get all uncommitted snapshots
   */
  public getAllSnapshots(): DraftVaultEntry[] {
    const map = this.getAllSnapshotsMap();
    return Object.values(map).sort((a, b) => b.timestamp - a.timestamp);
  }

  private getAllSnapshotsMap(): Record<string, DraftVaultEntry> {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  public clearAll() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(VAULT_STORAGE_KEY);
    } catch {}
  }
}

export const draftVaultManager = new DraftVaultManager();
