import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestHeaders } from '../web/src/requestHeaders.js';
import { api, adminApi } from '../web/src/api.js';

afterEach(() => vi.unstubAllGlobals());
describe('browser request contract', () => {
  it('marks bodyless and JSON mutations but not GET, preserving supplied content types', () => {
    expect(requestHeaders({ method: 'POST' }).get('x-enrollment-request')).toBe('1');
    expect(requestHeaders({ method: 'POST' }).has('content-type')).toBe(false);
    expect(requestHeaders({ method: 'PATCH', body: '{}' }).get('content-type')).toBe('application/json');
    expect(requestHeaders({ method: 'GET' }).has('x-enrollment-request')).toBe(false);
    expect(requestHeaders({ method: 'POST', body: new Blob([]), headers: { 'Content-Type': 'application/pdf' } }).get('content-type')).toBe('application/pdf');
  });
  it('refreshes offers explicitly before fetching the read-only dashboard', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await api.me();
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/me/refresh-offers', '/api/me']);
    expect(fetch.mock.calls[0]![1].headers.get('x-enrollment-request')).toBe('1');
    expect(fetch.mock.calls[1]![1].headers.has('x-enrollment-request')).toBe(false);
  });
  it('marks raw PDF upload and preserves credentials/type/body', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const file = new File(['%PDF-fixture'], 'packet.pdf', { type: 'application/pdf' });
    await adminApi.docUpload('packet', file);
    const options = fetch.mock.calls[0]![1];
    expect(options.headers.get('x-enrollment-request')).toBe('1'); expect(options.headers.get('content-type')).toBe('application/pdf');
    expect(options.credentials).toBe('include'); expect(options.body).toBe(file);
  });
  it('stops dashboard GET when explicit refresh fails and handles nonobject error JSON safely', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('null', { status: 403, statusText: 'Forbidden', headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.me()).rejects.toThrow('Forbidden');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
