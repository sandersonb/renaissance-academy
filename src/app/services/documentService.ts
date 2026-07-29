/**
 * DocumentService — registration paperwork (replaces the public S3 bucket in the
 * legacy enroll.pl). The enrollment specialist uploads a PDF per slot via the
 * admin portal; files live in the DB and are streamed ONLY to authorized parents
 * through the API (never a public link). Entitlement mirrors enroll.pl:
 *   - returning_family : a returning student (ACPT_REENROLL), post-lottery
 *   - family           : a new admitted student (PEND_REGISTER), non-returning family
 *   - grade_<g>        : per grade of each PEND_REGISTER child (grade_0 = Kindergarten)
 */
import { RegStatus } from '../../domain/regStatus.js';
import type { AppConfig } from '../config.js';
import type { DocumentFile, Repositories } from '../ports/repositories.js';

export class DocumentError extends Error {}

export interface DocSlot { slug: string; label: string }

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const gradeSlot = (g: number): DocSlot => ({ slug: `grade_${g}`, label: g === 0 ? 'Kindergarten Packet' : `${ordinal(g)} Grade Packet` });

/** The fixed set of paperwork slots (refreshed yearly by re-upload). */
export const DOCUMENT_CATALOG: DocSlot[] = [
  { slug: 'family', label: 'Family Packet (new families)' },
  { slug: 'returning_family', label: 'Family Packet (returning families)' },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(gradeSlot),
];
const CATALOG_BY_SLUG = new Map(DOCUMENT_CATALOG.map((s) => [s.slug, s]));
const MAX_SIZE = 15 * 1024 * 1024;

export interface AdminDocRow {
  slug: string; label: string; filename: string | null; size: number | null; uploadedAt: string | null;
  available: boolean;
  /** No real upload, but the bundled sample is being served in the meantime. */
  usingDefault: boolean;
}

const DEFAULT_FILENAME = 'RA-registration-packet-SAMPLE.pdf';

export class DocumentService {
  /** `defaultPdf` (bundled sample) is served when a slot has no real upload yet,
   *  so links never 404 and the admin can see which slots still need a file. */
  constructor(private repos: Repositories, private config: AppConfig, private defaultPdf: Buffer | null = null) {}

  catalog(): DocSlot[] {
    return DOCUMENT_CATALOG;
  }

  private defaultFile(slug: string): DocumentFile | null {
    if (!this.defaultPdf) return null;
    return {
      slug, filename: DEFAULT_FILENAME, contentType: 'application/pdf',
      bytes: this.defaultPdf, size: this.defaultPdf.length, uploadedAt: null, uploadedBy: null,
    };
  }

  /** Admin view: every slot + whether a real file is uploaded (or the default is serving). */
  async adminList(): Promise<AdminDocRow[]> {
    const stored = new Map((await this.repos.documents.list()).map((m) => [m.slug, m]));
    return DOCUMENT_CATALOG.map((slot) => {
      const m = stored.get(slot.slug);
      return {
        slug: slot.slug, label: slot.label, filename: m?.filename ?? null, size: m?.size ?? null,
        uploadedAt: m?.uploadedAt ?? null, available: !!m, usingDefault: !m && !!this.defaultPdf,
      };
    });
  }

  async upload(slug: string, filename: string, bytes: Buffer, uploadedBy: number | null): Promise<void> {
    if (!CATALOG_BY_SLUG.has(slug)) throw new DocumentError('Unknown document slot.');
    if (!bytes || bytes.length === 0) throw new DocumentError('No file received.');
    if (bytes.length > MAX_SIZE) throw new DocumentError('File too large (max 15 MB).');
    if (!(bytes.length >= 4 && bytes.toString('latin1', 0, 4) === '%PDF')) throw new DocumentError('File must be a PDF.');
    const clean = (filename || `${slug}.pdf`).replace(/[^\w.\- ]/g, '_').slice(0, 200);
    await this.repos.documents.upsert({ slug, filename: clean, contentType: 'application/pdf', bytes, size: bytes.length, uploadedBy });
  }

  async remove(slug: string): Promise<void> {
    if (!CATALOG_BY_SLUG.has(slug)) throw new DocumentError('Unknown document slot.');
    await this.repos.documents.delete(slug);
  }

  async adminFile(slug: string): Promise<DocumentFile | null> {
    return (await this.repos.documents.getFile(slug)) ?? this.defaultFile(slug);
  }

  /** Which documents a parent is entitled to (mirrors enroll.pl). */
  async entitledSlugs(parentId: number): Promise<Set<string>> {
    const kids = await this.repos.children.findByParent(parentId);
    const returning = kids.some((c) => c.regStatus === RegStatus.ACPT_REENROLL);
    const needGrades = new Set(kids.filter((c) => c.regStatus === RegStatus.PEND_REGISTER).map((c) => c.gradeNextYear));
    const slugs = new Set<string>();
    if (returning && this.config.postLottery) slugs.add('returning_family');
    if (needGrades.size > 0) {
      if (!returning) slugs.add('family');
      for (const g of needGrades) slugs.add(`grade_${g}`);
    }
    return slugs;
  }

  /** Entitled documents for the parent portal list (downloadable if uploaded or a default exists). */
  async parentDocuments(parentId: number): Promise<{ slug: string; label: string; available: boolean }[]> {
    const entitled = await this.entitledSlugs(parentId);
    const stored = new Set((await this.repos.documents.list()).map((m) => m.slug));
    return DOCUMENT_CATALOG.filter((s) => entitled.has(s.slug)).map((s) => ({
      slug: s.slug, label: s.label, available: stored.has(s.slug) || !!this.defaultPdf,
    }));
  }

  /** Stream target for a parent — the upload, else the bundled default, else null
   *  (also null if they're not entitled to this slug). */
  async parentFile(parentId: number, slug: string): Promise<DocumentFile | null> {
    const entitled = await this.entitledSlugs(parentId);
    if (!entitled.has(slug)) return null;
    return (await this.repos.documents.getFile(slug)) ?? this.defaultFile(slug);
  }
}
