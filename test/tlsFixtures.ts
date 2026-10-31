/** Ephemeral TEST certificates only; private keys are never committed or printed. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createTlsFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ra-test-tls-'));
  const caFile = join(directory, 'ca.pem');
  const certFile = join(directory, 'server.pem');
  const keyFile = join(directory, 'server-key.pem');
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore', timeout: 30000 });
  try {
    writeFileSync(join(directory, 'ca.cnf'), '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=Renaissance disposable TEST CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
    writeFileSync(join(directory, 'server.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n');
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-config', join(directory, 'ca.cnf'), '-keyout', join(directory, 'ca-key.pem'), '-out', caFile]);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=localhost', '-keyout', keyFile, '-out', join(directory, 'server.csr')]);
    openssl(['x509', '-req', '-in', join(directory, 'server.csr'), '-CA', caFile, '-CAkey', join(directory, 'ca-key.pem'), '-CAcreateserial', '-sha256', '-days', '2', '-extfile', join(directory, 'server.cnf'), '-out', certFile]);
    // The host parent stays 0700. Individual read-only test bind mounts must be
    // readable by mysqld's non-root UID inside the owned container.
    chmodSync(keyFile, 0o644);
    return { directory, caFile, certFile, keyFile, cleanup };
  } catch (error) { cleanup(); throw error; }
}
