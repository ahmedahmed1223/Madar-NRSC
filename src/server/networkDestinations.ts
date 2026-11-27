import { lookup } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const nonGlobal = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) nonGlobal.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) nonGlobal.addSubnet(address, prefix, 'ipv6');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonGlobal.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !nonGlobal.check(address, 'ipv6');
}

/** Use the checked addresses for the actual socket, keeping the URL hostname for HTTP and TLS. */
export const lookupPublicAddress: LookupFunction = (host, options, callback) => {
  lookup(host, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    if (!addresses.length || addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
      return callback(new Error('الرابط يشير إلى عنوان داخلي أو غير عام'), '', 0);
    }
    if (options.all) return callback(null, addresses);
    const { address, family } = addresses[0];
    callback(null, address, family);
  });
};

const pushHosts = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']);
const pushDomains = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function allowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
      && (pushHosts.has(url.hostname) || pushDomains.some(domain => url.hostname.endsWith(domain)));
  } catch {
    return false;
  }
}
