import crypto from 'crypto';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer } from '../helpers';
import { deliverPending, notificationEmail, openUrl } from '../../src/server/delivery';
import { writeNotification } from '../../src/server/notifications';

let server: Awaited<ReturnType<typeof createTestServer>>;
let receiver: https.Server;
let received: { headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
let status = 201;
let endpoint = '';

beforeAll(async () => {
  server = await createTestServer({ APP_URL: 'https://madar.example.com' });
  // web-push only speaks HTTPS: a throwaway self-signed receiver, trusted in this test process only.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  receiver = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = status;
      res.end();
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  endpoint = `https://127.0.0.1:${(receiver.address() as AddressInfo).port}/push/abc`;
});
afterAll(() => {
  receiver.close();
  server.close();
});

/** A subscription with real P-256 keys, as a browser would create it. */
function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

describe('notification delivery', () => {
  it('pushes new notifications to the colleague’s devices, following their preferences', async () => {
    await deliverPending(server.db, server.config); // first run only sets the starting point
    server.db.savePushSubscription('usr-6', { endpoint, ...browserKeys() }, 'test');

    writeNotification(server.db, { userId: 'usr-6', title: 'تكليف بتغطية', message: 'مؤتمر', linkUrl: '/diary/d1', category: 'diary' });
    writeNotification(server.db, { userId: 'usr-6', title: 'تنبيه عام', message: 'x', category: 'system' }); // push off by default
    const stats = await deliverPending(server.db, server.config);
    expect(stats.push).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0].headers['content-encoding']).toBe('aes128gcm');
    expect(String(received[0].headers.authorization)).toMatch(/^vapid t=/);
    expect(received[0].body.length).toBeGreaterThan(50);

    // Nothing is sent twice.
    expect((await deliverPending(server.db, server.config)).push).toBe(0);
  });

  it('respects quiet hours except for urgent items, and drops dead subscriptions', async () => {
    received = [];
    server.db.writeRow('notificationPrefs', 'usr-6', { id: 'usr-6', userId: 'usr-6', channels: {}, watchWords: [], flashAlerts: true, quietFrom: '00:00', quietTo: '23:59' }, 0, null);
    writeNotification(server.db, { userId: 'usr-6', title: 'عادي', message: '', category: 'diary' });
    writeNotification(server.db, { userId: 'usr-6', title: 'عاجل', message: '', category: 'wire', urgent: true });
    const stats = await deliverPending(server.db, server.config);
    expect(stats.push).toBe(1);

    status = 410;
    writeNotification(server.db, { userId: 'usr-6', title: 'عاجل 2', message: '', category: 'wire', urgent: true });
    await deliverPending(server.db, server.config);
    expect(server.db.listPushSubscriptions('usr-6')).toHaveLength(0);
  });

  it('builds a safe Arabic e-mail with a deep link', () => {
    const mail = notificationEmail({ title: '<b>عنوان</b>', message: 'نص', category: 'diary', linkUrl: '/diary/d1' }, server.config);
    expect(mail.subject).toContain('عنوان');
    expect(mail.html).toContain('&lt;b&gt;');
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain(openUrl(server.config, '/diary/d1').replace(/&/g, '&amp;'));
    expect(openUrl(server.config, '/diary/d1')).toBe('https://madar.example.com/?open=%2Fdiary%2Fd1');
  });
});
