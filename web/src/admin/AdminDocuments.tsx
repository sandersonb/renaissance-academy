import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi, ApiError, type AdminDoc } from '../api';
import { ErrorBanner } from '../components/Layout';
import { AdminNav } from './AdminNav';

const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

export function AdminDocuments() {
  const [docs, setDocs] = useState<AdminDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setError(null);
    try { setDocs((await adminApi.docList()).documents); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load documents'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (slug: string, file: File | undefined) => {
    if (!file) return;
    setError(null); setBusy(slug);
    try { await adminApi.docUpload(slug, file); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Upload failed'); }
    finally { setBusy(null); if (inputs.current[slug]) inputs.current[slug]!.value = ''; }
  };
  const remove = async (d: AdminDoc) => {
    if (!confirm(`Remove the uploaded "${d.label}"? Parents will no longer be able to download it.`)) return;
    setError(null); setBusy(d.slug);
    try { await adminApi.docDelete(d.slug); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Remove failed'); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <h1>Admin · Registration Paperwork</h1>
      <AdminNav />
      <p className="muted">
        Upload the blank PDF packets here. Parents who are admitted (or re-enrolling) download the relevant packet(s)
        from their portal, then email or hand-deliver the completed forms to the enrollment specialist — they are never
        uploaded back through the site. Re-upload each year to replace the prior version.
      </p>
      <ErrorBanner message={error} />

      {!docs ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Packet</th><th>Current file</th><th>Size</th><th>Uploaded</th><th>Replace / upload</th><th /></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.slug}>
                    <td>{d.label}</td>
                    <td>
                      {d.available ? (
                        <a href={`/api/admin/documents/${d.slug}/file`} target="_blank" rel="noreferrer">{d.filename}</a>
                      ) : d.usingDefault ? (
                        <a href={`/api/admin/documents/${d.slug}/file`} target="_blank" rel="noreferrer" className="muted">
                          sample default — upload to replace
                        </a>
                      ) : (
                        <span className="muted">— not uploaded —</span>
                      )}
                    </td>
                    <td>{fmtSize(d.size)}</td>
                    <td className="muted">{fmtDate(d.uploadedAt)}</td>
                    <td>
                      <input
                        ref={(el) => { inputs.current[d.slug] = el; }}
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={busy === d.slug}
                        onChange={(e) => void upload(d.slug, e.target.files?.[0])}
                      />
                    </td>
                    <td>
                      {d.available && (
                        <button className="small danger" disabled={busy === d.slug} onClick={() => void remove(d)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
