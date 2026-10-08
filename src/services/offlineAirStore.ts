import { offlineAirPacketSchema, type OfflineAirPacket } from '../shared/offlineAir';

export interface OfflineEncryptedValue {
  version: 1;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  if (secret.length < 8) throw new Error('كلمة فتح النسخة يجب ألا تقل عن 8 أحرف');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptOfflineValue(value: unknown, secret: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(secret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)),
  ));
  return { key, record: { version: 1 as const, salt, iv, ciphertext } };
}

export async function decryptOfflineValue(record: OfflineEncryptedValue, secret: string): Promise<unknown> {
  if (record.version !== 1 || record.iv.length !== 12 || record.salt.length !== 16) throw new Error('نسخة محلية غير صالحة');
  const key = await deriveKey(secret, record.salt);
  return decryptWithKey(record, key);
}

export async function decryptWithKey(record: OfflineEncryptedValue, key: CryptoKey): Promise<unknown> {
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.ciphertext);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export interface OfflinePacketMetadata {
  packetId: string; dbId: string; userId: string; showId: string;
  preparedAt: string; shellVersion: string;
}
interface StoredPacket extends OfflinePacketMetadata {
  encrypted: OfflineEncryptedValue;
  local?: { iv: Uint8Array; ciphertext: Uint8Array };
}
const DATABASE = 'madar-offline-air-v1';
const STORE = 'packets';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'packetId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('أغلق نوافذ الأوفلاين القديمة ثم أعد المحاولة'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T;
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('تعذر حفظ النسخة المحلية'));
    });
  } finally { db.close(); }
}

const metadataOf = (row: StoredPacket): OfflinePacketMetadata => ({
  packetId: row.packetId, dbId: row.dbId, userId: row.userId, showId: row.showId,
  preparedAt: row.preparedAt, shellVersion: row.shellVersion,
});

export async function listPacketMetadata(): Promise<OfflinePacketMetadata[]> {
  return (await transaction<StoredPacket[]>('readonly', store => store.getAll())).map(metadataOf);
}

export async function savePacket(packet: OfflineAirPacket, secret: string): Promise<OfflinePacketMetadata> {
  offlineAirPacketSchema.parse(packet);
  // A new packet never replaces another packet: previous sessions remain recoverable.
  if (await transaction('readonly', store => store.get(packet.packetId))) throw new Error('معرّف النسخة موجود مسبقاً');
  const { record } = await encryptOfflineValue(packet, secret);
  const row: StoredPacket = {
    packetId: packet.packetId, dbId: packet.dbId, userId: packet.userId,
    showId: packet.show.id, preparedAt: packet.preparedAt, shellVersion: packet.shellVersion, encrypted: record,
  };
  await transaction('readwrite', store => store.add(row));
  try {
    const saved = await transaction<StoredPacket>('readonly', store => store.get(packet.packetId));
    const verified = offlineAirPacketSchema.parse(await decryptOfflineValue(saved.encrypted, secret));
    if (JSON.stringify(verified) !== JSON.stringify(offlineAirPacketSchema.parse(packet))) throw new Error('فشل التحقق من النسخة المحفوظة');
  } catch (error) {
    await deletePacket(packet.packetId);
    throw error;
  }
  return metadataOf(row);
}

export async function unlockPacket(packetId: string, secret: string) {
  const row = await transaction<StoredPacket | undefined>('readonly', store => store.get(packetId));
  if (!row) throw new Error('النسخة غير موجودة على هذا الجهاز');
  const key = await deriveKey(secret, row.encrypted.salt);
  const packet = offlineAirPacketSchema.parse(await decryptWithKey(row.encrypted, key));
  if (packet.packetId !== row.packetId || packet.dbId !== row.dbId || packet.userId !== row.userId) throw new Error('هوية النسخة غير صالحة');
  const local = row.local ? JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: row.local.iv, additionalData: new TextEncoder().encode(packetId) }, key, row.local.ciphertext,
  ))) : null;
  return { packet, key, local };
}

export async function saveLocalState(packetId: string, key: CryptoKey, state: unknown): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(packetId) }, key, new TextEncoder().encode(JSON.stringify(state)),
  ));
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(packetId);
      request.onsuccess = () => {
        if (!request.result) { tx.abort(); return; }
        store.put({ ...request.result, local: { iv, ciphertext } });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('لم يتم حفظ العملية المحلية'));
    });
  } finally { db.close(); }
}

export async function deletePacket(packetId: string): Promise<void> {
  await transaction('readwrite', store => store.delete(packetId));
}

export async function exportEncryptedPacket(packetId: string): Promise<Blob> {
  const row = await transaction<StoredPacket | undefined>('readonly', store => store.get(packetId));
  if (!row) throw new Error('النسخة غير موجودة');
  const encode = (bytes: Uint8Array) => Array.from(bytes);
  return new Blob([JSON.stringify({ ...metadataOf(row), version: 1,
    encrypted: { ...row.encrypted, salt: encode(row.encrypted.salt), iv: encode(row.encrypted.iv), ciphertext: encode(row.encrypted.ciphertext) },
    local: row.local ? { iv: encode(row.local.iv), ciphertext: encode(row.local.ciphertext) } : null,
  })], { type: 'application/json' });
}

export async function purgeUser(userId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.userId === userId) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
