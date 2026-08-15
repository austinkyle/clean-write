const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLoopbackOrigin(value: string, expected: URL) {
  try {
    const candidate = new URL(value);
    return candidate.protocol === expected.protocol
      && candidate.port === expected.port
      && candidate.username === ''
      && candidate.password === ''
      && candidate.pathname === '/'
      && candidate.search === ''
      && candidate.hash === ''
      && LOOPBACK_HOSTS.has(candidate.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(value: string, expected: URL) {
  try {
    const candidate = new URL(`${expected.protocol}//${value}`);
    return candidate.port === expected.port
      && candidate.username === ''
      && candidate.password === ''
      && candidate.pathname === '/'
      && candidate.search === ''
      && candidate.hash === ''
      && LOOPBACK_HOSTS.has(candidate.hostname);
  } catch {
    return false;
  }
}

export function assertLocalOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expectedUrl = new URL(request.url);
  if (!LOOPBACK_HOSTS.has(expectedUrl.hostname)) throw new Error('Invalid local request origin');
  if (origin && origin !== expectedUrl.origin && !isLoopbackOrigin(origin, expectedUrl)) throw new Error('Invalid local request origin');
  const host = request.headers.get('host');
  if (host && host !== expectedUrl.host && !isLoopbackHost(host, expectedUrl)) throw new Error('Invalid local request origin');
}
