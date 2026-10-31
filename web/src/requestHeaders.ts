/** Nonsecret request marker: defense against simple cross-origin browser writes, not authentication. */
export function requestHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase())) headers.set('x-enrollment-request', '1');
  return headers;
}
