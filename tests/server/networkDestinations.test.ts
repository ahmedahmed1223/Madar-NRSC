import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { allowedPushEndpoint, isPublicNetworkAddress } from '../../src/server/networkDestinations';
import { fetchFeed } from '../../src/server/wires';

describe('outbound destination policy', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/example',
    'https://updates.push.services.mozilla.com/wpush/v2/example',
    'https://web.push.apple.com/example',
    'https://db5.notify.windows.com/w/example',
  ])('accepts supported browser push destinations: %s', (url) => {
    expect(allowedPushEndpoint(url)).toBe(true);
  });

  it.each(['http://example.org/push', 'https://example.org/push', 'invalid-url'])('rejects an unsupported push destination: %s', (url) => {
    expect(allowedPushEndpoint(url)).toBe(false);
  });

  it.each(['8.8.8.8', '2606:4700:4700::1111'])('accepts global addresses: %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(true);
  });

  it.each(['127.0.0.1', '10.0.0.1', '192.0.2.1', '::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '64:ff9b::1'])('keeps a non-global address outside the public policy: %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });
});

it('reads a compressed feed after a redirect from an explicitly enabled station-local source', async () => {
  const body = '<rss><channel><title>برقيات المحطة</title></channel></rss>';
  const server = createServer((req, res) => {
    if (req.url === '/feed') {
      res.writeHead(302, { Location: '/current' }).end();
      return;
    }
    res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await expect(fetchFeed(`http://127.0.0.1:${port}/feed`, true)).resolves.toBe(body);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
