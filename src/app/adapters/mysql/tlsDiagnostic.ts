import type { Connection } from 'mysql2/promise';

/** Reads only connection/server metadata; never app records or migration history. */
export async function inspectTransport(connection: Connection, verified: boolean) {
  const [metadata] = await connection.query('SELECT DATABASE() AS selected_database, @@version AS version, @@GLOBAL.require_secure_transport AS require_secure_transport');
  const [status] = await connection.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')");
  const values = new Map((status as { Variable_name: string; Value: string }[]).map((row) => [row.Variable_name, row.Value]));
  const cipher = values.get('Ssl_cipher') ?? '';
  const protocol = values.get('Ssl_version') ?? '';
  const server = (metadata as Record<string, unknown>[])[0]!;
  if (verified && (!cipher || !['TLSv1.2', 'TLSv1.3'].includes(protocol))) throw new Error('Expected verified TLS session was not encrypted with TLS 1.2+.');
  return { selected_database: server.selected_database == null ? null : String(server.selected_database),
    version: String(server.version), require_secure_transport: Number(server.require_secure_transport), encrypted: Boolean(cipher),
    certificate_and_hostname_verified: verified && Boolean(cipher), cipher, protocol };
}
