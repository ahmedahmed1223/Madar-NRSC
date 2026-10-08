import { expect, it } from 'vitest';
import { encryptOfflineValue, decryptOfflineValue } from '../src/services/offlineAirStore';

it('encrypts private text and authenticates both the secret and ciphertext', async () => {
  const value = { script: 'private broadcast copy', selected: 2 };
  const encrypted = await encryptOfflineValue(value, 'long-secret');
  expect(JSON.stringify(encrypted.record)).not.toContain(value.script);
  expect(await decryptOfflineValue(encrypted.record, 'long-secret')).toEqual(value);
  await expect(decryptOfflineValue(encrypted.record, 'wrong-secret')).rejects.toThrow();
  const tampered = { ...encrypted.record, ciphertext: encrypted.record.ciphertext.slice() };
  tampered.ciphertext[0] ^= 1;
  await expect(decryptOfflineValue(tampered, 'long-secret')).rejects.toThrow();
});

it('uses fresh salts and nonces and rejects short unlock secrets', async () => {
  await expect(encryptOfflineValue({}, 'short')).rejects.toThrow();
  const a = await encryptOfflineValue({}, 'long-secret');
  const b = await encryptOfflineValue({}, 'long-secret');
  expect(a.record.iv).toHaveLength(12);
  expect(a.record.salt).toHaveLength(16);
  expect(a.record.iv).not.toEqual(b.record.iv);
  expect(a.record.salt).not.toEqual(b.record.salt);
});
