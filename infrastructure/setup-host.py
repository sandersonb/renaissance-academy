#!/usr/bin/env python3
# Managed by renaissance-academy host setup. No secrets belong in this file.
"""Prepare an AL2023 ARM64 host from an uploaded, trusted source tree.

No AWS mutations, DB connections/migrations, API activation, DNS or TLS cutover.
Only Python's standard library is required. See HOST_SETUP.md before running.
"""

import argparse
from contextlib import contextmanager
import fcntl
import grp
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import re
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import urlopen


MARKER = "Managed by renaissance-academy host setup"
APP = Path("/opt/renaissance-academy")
WEB = Path("/var/www/renaissance-academy")
CONFIG = Path("/etc/renaissance-academy")
CA_DIR = Path("/etc/pki/renaissance-academy")
CONTROL = Path("/var/lib/renaissance-academy-setup")
HELPER = Path("/usr/local/libexec/renaissance-academy/setup-host.py")
NODE_BIN = Path("/usr/local/lib/renaissance-academy/node-bin")
UNIT = Path("/etc/systemd/system/enrollment-api.service")
NGINX = Path("/etc/nginx/conf.d/enrollment.conf")
SERVICE = "enrollment-api.service"
LOCK = Path("/run/lock/renaissance-academy-setup.lock")
BUILD_USER = "enrollment-build"
BUILD_HOME = Path("/var/lib/enrollment-build")
RUNTIME_USER = "enrollment"
RUNTIME_HOME = Path("/var/lib/enrollment")
NODE = "/usr/bin/node-22"
NPM = "/usr/bin/npm-22"
REQUIRED_FILES = (
    "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
    "web/package.json", "web/package-lock.json", "web/tsconfig.json",
    "web/vite.config.ts", "web/index.html",
    "db/preview/base.sql", "db/preview/utf8mb4.sql",
)
SOURCE_DIRS = ("src", "web/src", "web/public", "assets", "db/migrations")
EXCLUDED = {"old", "new", "cursor", ".git", ".terraform", "node_modules", "dist", "__pycache__"}


class SetupError(Exception):
    pass


def run(command, *, cwd=None, capture=False, check=True):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=capture, check=False)
    if check and result.returncode:
        # No .env values or inherited secret environment are included in commands.
        raise SetupError(f"Command failed (exit {result.returncode}): {command[0]}")
    return result


def active(service):
    return run(["systemctl", "is-active", "--quiet", service], check=False).returncode == 0


@contextmanager
def setup_lock():
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        metadata = os.fstat(fd)
        if metadata.st_uid != 0 or not stat.S_ISREG(metadata.st_mode):
            raise SetupError("Setup lock is not a root-owned regular file.")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("Another host setup is running; wait for it to finish.") from None
        yield
    finally:
        os.close(fd)


def require_host():
    if os.geteuid() != 0:
        raise SetupError("Run as root on the target EC2, not on the development machine.")
    release = {}
    for line in Path("/etc/os-release").read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            release[key] = value.strip('"')
    if release.get("ID") != "amzn" or release.get("VERSION_ID") != "2023" or platform.machine() != "aarch64":
        raise SetupError("Only Amazon Linux 2023 ARM64/aarch64 is supported.")


def install_host_packages():
    # mariadb105 is AL2023's MySQL-compatible CLI package, not the database server.
    run(["dnf", "install", "-y", "nginx", "nodejs22", "nodejs22-npm", "python3", "amazon-ssm-agent",
         "ca-certificates", "util-linux", "shadow-utils", "policycoreutils", "libselinux-utils", "mariadb105"])
    # Do not load operator option files (which may contain secrets/init commands)
    # or open a connection merely to verify the client is available.
    run(["mysql", "--no-defaults", "--version"])


def source_files(source):
    """Allowlist only application inputs; never traverse old/, .env or state."""
    files = []

    def safe_path(name):
        path = source
        for component in Path(name).parts:
            path = path / component
            if path.is_symlink():
                raise SetupError("Source path symlinks are not accepted.")
        return path

    for name in REQUIRED_FILES:
        path = safe_path(name)
        if not path.is_file() or path.is_symlink():
            raise SetupError(f"Missing regular source file: {name}")
        files.append(path)
    for name in SOURCE_DIRS:
        directory = safe_path(name)
        if not directory.exists():
            if name in ("src", "web/src"):
                raise SetupError(f"Missing source directory: {name}")
            continue
        if directory.is_symlink() or not directory.is_dir():
            raise SetupError(f"Refusing non-directory/symlink source: {name}")
        for root, dirs, names in os.walk(directory, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and not d.startswith(".env"))
            for child in dirs:
                if (Path(root) / child).is_symlink():
                    raise SetupError("Source directory symlinks are not accepted.")
            for child in sorted(names):
                if child.startswith(".env") or child.endswith((".swp", ".swo", "~")):
                    continue
                path = Path(root) / child
                if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
                    raise SetupError("Source symlinks and special files are not accepted.")
                files.append(path)
    return sorted(files)


def source_digest(source, files, installer):
    digest = hashlib.sha256(installer)
    for path in files:
        digest.update(str(path.relative_to(source)).encode() + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def networks(values, *, proxy=False):
    if len(values) > 64:
        raise SetupError("At most 64 explicit networks are supported.")
    result = set()
    for value in values:
        if "%" in value:
            raise SetupError("Scoped IPv6 zone identifiers are not supported in nginx allowlists.")
        parts = value.split("/")
        if len(parts) > 2 or (len(parts) == 2 and not parts[1].isascii()) or (len(parts) == 2 and not parts[1].isdigit()):
            raise SetupError("Networks must contain exact IP addresses or numeric CIDR lengths.")
        network = ipaddress.ip_network(value, strict=False)
        if network.version == 6:
            mapped = network.network_address.ipv4_mapped
            if mapped is not None and network.prefixlen >= 96:
                network = ipaddress.ip_network(f"{mapped}/{network.prefixlen - 96}", strict=False)
            elif network.overlaps(ipaddress.ip_network("::ffff:0:0/96")):
                raise SetupError("Broad IPv4-mapped IPv6 networks are not supported.")
        minimum = (32 if network.version == 4 else 128) if proxy else (24 if network.version == 4 else 64)
        if network.prefixlen < minimum:
            raise SetupError("Proxy trust requires exact host addresses; admin networks must be /24 IPv4 or /64 IPv6 or narrower.")
        result.add(str(network))
    return sorted(result)


def render_nginx(server_name, proxies, admins):
    trust = "\n".join(f"    set_real_ip_from {network};" for network in proxies)
    peers = "\n".join(f"    {network} 1;" for network in proxies)
    gate = "\n".join(f"        allow {network};" for network in admins) + "\n        deny all;"
    proxy = """        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $enrollment_scheme;
        proxy_read_timeout 120s;
        add_header X-Content-Type-Options nosniff always;
        add_header Cache-Control "no-store" always;"""
    proxy += '\n        add_header Referrer-Policy "no-referrer" always;'
    static = "        try_files $uri /index.html;\n        add_header X-Content-Type-Options nosniff always;\n        add_header Cache-Control \"no-store\" always;"
    static += '\n        add_header Referrer-Policy "no-referrer" always;'
    admin_locations = []
    for location, body in (("= /admin", static), ("^~ /admin/", static), ("= /api/admin", proxy), ("^~ /api/admin/", proxy)):
        admin_locations.append(f"    location {location} {{\n{gate}\n{body}\n    }}")
    return f"""# {MARKER}
# Private HTTP pilot only; TLS continues to terminate at the existing edge.
geo $realip_remote_addr $enrollment_trusted_edge {{
    default 0;
{peers}
}}
map "$enrollment_trusted_edge:$http_x_forwarded_proto" $enrollment_scheme {{
    default $scheme;
    "1:https" https;
}}
# Do not log query strings, Referer, auth headers or request bodies (reset tokens/PII).
log_format enrollment_host escape=json
    '{{"time":"$time_iso8601","ip":"$remote_addr","method":"$request_method","uri":"$uri","status":"$status"}}';
server {{
    listen 80;
    server_name {server_name};
    root {WEB}/current;
    access_log /var/log/nginx/enrollment.access.log enrollment_host;
    client_max_body_size 16m;
{trust}
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;
    add_header X-Content-Type-Options nosniff always;
{chr(10).join(admin_locations)}
    location /api/ {{
{proxy}
    }}
    location / {{
{static}
    }}
}}
"""


def render_unit():
    return f"""# {MARKER}
[Unit]
Description=Renaissance Academy enrollment API
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User={RUNTIME_USER}
Group={RUNTIME_USER}
WorkingDirectory={APP}/current
EnvironmentFile={CONFIG}/.env
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStartPre=/usr/bin/python3 {HELPER} --validate-env
ExecStart={NODE} {APP}/current/dist/app/http/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={RUNTIME_HOME}
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
"""


def env_template(server_name, ca_file=None):
    ca_file = ca_file or rds_ca_path("us-west-2")
    return f"""# Created once by host setup. Never source this file in a shell or commit it.
# systemd EnvironmentFile syntax: KEY=value, no export, no inline comments.
# Quote secrets containing whitespace. No shell expansion is performed.
# Configure secrets, complete the DB/security gates, then explicitly enable/start.
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
APP_BASE_URL=https://{server_name}
DB_HOST=
DB_PORT=3306
DB_NAME=enrollment
DB_USER=
DB_PASSWORD=
DB_TLS_MODE=verify_identity
DB_TLS_CA_FILE={ca_file}
TRUST_PROXY=true
# Exact IPs or bounded CIDRs (/24 IPv4, /64 IPv6 or narrower), maximum 64 entries.
# nginx admin CIDRs are configured separately with --admin-cidr (default deny all).
ADMIN_IP_ALLOWLIST=
BCRYPT_COST=12
DUAL_WRITE_LEGACY_CRYPT=true
# Production cycle values live in app_settings, not .env defaults.
# Initialize once using db:init-settings with explicit reviewed values and --apply.
CHILD_EDITABLE_FIELDS=
ADMIN_BOOTSTRAP_USER=
ADMIN_BOOTSTRAP_PASSWORD=
EMAIL_PROVIDER=smtp
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
# Pilot: no scheduled delivery/reminders. Manual notify/drain still need gating.
EMAIL_WORKER_INTERVAL_MS=0
REMINDER_INTERVAL_MS=0
EMAIL_BATCH_SIZE=20
EMAIL_SEND_SPACING_MS=1500
EMAIL_DAILY_CAP=400
# Use an approved uploaded PDF, not sample paperwork, before offering documents.
DEFAULT_PACKET_PATH=
"""


def validate_environment(env):
    errors = []
    required = ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "EMAIL_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "ADMIN_IP_ALLOWLIST")
    for key in required:
        value = env.get(key, "").strip()
        if not value or value.upper().startswith(("CHANGEME", "REPLACE", "SET_ME", "YOUR_")):
            errors.append(f"{key} is missing or still a placeholder.")
    for key, expected in (("NODE_ENV", "production"), ("HOST", "127.0.0.1"), ("PORT", "3001"), ("TRUST_PROXY", "true"), ("EMAIL_PROVIDER", "smtp"), ("DB_TLS_MODE", "verify_identity")):
        if env.get(key) != expected:
            errors.append(f"{key} must use the prepared host's production setting.")
    try:
        ca_path = Path(env.get("DB_TLS_CA_FILE", ""))
        if not ca_path.is_absolute() or not ca_path.is_file():
            raise SetupError("Missing CA")
        validate_public_ca(ca_path.read_bytes())
    except (OSError, SetupError):
        errors.append("DB_TLS_CA_FILE must be an absolute, readable public CA PEM file; never a private key or secret file.")
    try:
        url = urlsplit(env.get("APP_BASE_URL", ""))
        url.port  # Also reject malformed/non-numeric URL ports without logging values.
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
            errors.append("APP_BASE_URL must be a canonical root HTTPS URL without credentials, query, or fragment.")
    except ValueError:
        errors.append("APP_BASE_URL is invalid.")
    for key in ("DB_PORT", "SMTP_PORT"):
        try:
            if not 1 <= int(env.get(key, "")) <= 65535:
                raise ValueError()
        except ValueError:
            errors.append(f"{key} must be a valid TCP port.")
    for key in ("EMAIL_WORKER_INTERVAL_MS", "REMINDER_INTERVAL_MS"):
        try:
            if int(env.get(key, "")) < 0:
                raise ValueError()
        except ValueError:
            errors.append(f"{key} must be a nonnegative integer (0 disables its timer).")
    try:
        networks([value.strip() for value in env.get("ADMIN_IP_ALLOWLIST", "").split(",")])
    except (ValueError, SetupError):
        errors.append("ADMIN_IP_ALLOWLIST must contain 1–64 nonempty, comma-separated exact IPs or bounded CIDRs (/24 IPv4, /64 IPv6 or narrower).")
    try:
        if not 4 <= int(env.get("BCRYPT_COST", "12")) <= 14:
            raise ValueError()
    except ValueError:
        errors.append("BCRYPT_COST must be an integer from 4 through 14.")
    return errors


def atomic_write(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".enrollment-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            os.fchmod(handle.fileno(), mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def create_env_once(path, data):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    return True


def managed_status(path, desired, previous, mode=0o644):
    if path.is_symlink():
        raise SetupError(f"Refusing managed-file symlink: {path}")
    if not path.exists():
        return True
    if not path.is_file():
        raise SetupError(f"Refusing non-file managed path: {path}")
    current = path.read_bytes()
    if current == desired:
        metadata = path.stat()
        return metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) != mode
    if previous.get(str(path)) != hashlib.sha256(current).hexdigest():
        raise SetupError(f"Refusing to overwrite unrecognized or locally modified file: {path}")
    return True


def ensure_directory(path, mode=0o755):
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise SetupError(f"Refusing unsafe directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    os.chown(path, 0, 0)
    path.chmod(mode)


def rds_ca_path(region):
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-[0-9]+", region):
        raise SetupError("Invalid RDS CA region.")
    return CA_DIR / f"rds-{region}-bundle.pem"


def validate_public_ca(data):
    try:
        text = data.decode("utf8")
        certificates = re.findall(r"-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----", text)
        remainder = re.sub(r"-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----", "", text)
        remainder = "".join(line for line in remainder.splitlines() if not line.strip().startswith("#")).strip()
        if not certificates or remainder or "PRIVATE KEY" in text:
            raise ValueError()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cadata="\n".join(certificates))
        counts = context.cert_store_stats()
        if not counts["x509_ca"] or counts["x509"] != counts["x509_ca"]:
            raise ValueError()
    except (ValueError, ssl.SSLError):
        raise SetupError("Invalid public CA bundle; existing material was not replaced.") from None


def fetch_rds_ca(region):
    rds_ca_path(region)  # Validate the region before constructing the fixed HTTPS URL.
    url = f"https://truststore.pki.rds.amazonaws.com/{region}/{region}-bundle.pem"
    try:
        with urlopen(url, timeout=30, context=ssl.create_default_context()) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise SetupError("Public CA response was unexpectedly large.")
        validate_public_ca(data)
        return data
    except OSError:
        raise SetupError("Could not download the public RDS CA over verified HTTPS; existing CA/secrets unchanged.") from None


def ensure_rds_ca(region, refresh=False):
    ensure_directory(CA_DIR)
    path = rds_ca_path(region)
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise SetupError("Refusing non-regular managed CA path.")
    if path.exists():
        validate_public_ca(path.read_bytes())
    if not path.exists() or refresh:
        data = fetch_rds_ca(region)
        validate_public_ca(data)
        atomic_write(path, data, 0o644)
    os.chown(path, 0, 0)
    path.chmod(0o644)  # Public CA, readable by the unprivileged API; never a key.
    return path


def ensure_user(name, home):
    try:
        user = pwd.getpwnam(name)
        if user.pw_dir != str(home) or not user.pw_shell.endswith("nologin"):
            raise SetupError(f"Existing user {name} is not the dedicated service account; refusing to modify it.")
    except KeyError:
        try:
            grp.getgrnam(name)
        except KeyError:
            run(["groupadd", "--system", name])
        run(["useradd", "--system", "--gid", name, "--home-dir", str(home), "--create-home", "--shell", "/sbin/nologin", name])
        user = pwd.getpwnam(name)
    ensure_directory(home, 0o700)
    os.chown(home, user.pw_uid, user.pw_gid)
    return user


def own_tree(path, uid, gid, *, public=False):
    for root, dirs, files in os.walk(path, followlinks=False):
        for child in [Path(root)] + [Path(root) / name for name in dirs + files]:
            if child.is_symlink():
                if not child.resolve().is_relative_to(path.resolve()):
                    raise SetupError("A built artifact contains a symlink outside its release.")
                os.chown(child, uid, gid, follow_symlinks=False)
                continue
            os.chown(child, uid, gid)
            if public:
                child.chmod(0o755 if child.is_dir() or child.stat().st_mode & 0o111 else 0o644)


def build_release(source, files, digest, node_version, builder, installer):
    release_id = hashlib.sha256((digest + node_version).encode()).hexdigest()[:24]
    release = APP / "releases" / release_id
    web_release = WEB / "releases" / release_id
    manifest = release / ".host-release.json"
    expected = {"source_digest": digest, "node_version": node_version}
    if release.exists():
        if release.is_symlink() or manifest.is_symlink() or not manifest.is_file() or json.loads(manifest.read_text()) != expected or not (release / "dist/app/http/main.js").is_file():
            raise SetupError("Existing release is incomplete/unrecognized; inspect it rather than overwriting it.")
        if not web_release.exists():
            publish_static(release / "web/dist", web_release)
        elif web_release.is_symlink() or not (web_release / "index.html").is_file():
            raise SetupError("Existing static release is incomplete/unrecognized.")
        return release, web_release
    stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=APP / "releases"))
    try:
        for path in files:
            destination = stage / path.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
        copied = [stage / path.relative_to(source) for path in files]
        if source_digest(stage, copied, installer) != digest:
            raise SetupError("Source changed during copying. Finish uploading before retrying setup.")
        own_tree(stage, builder.pw_uid, builder.pw_gid)
        stage.chmod(0o750)
        environment = ["runuser", "-u", BUILD_USER, "--", "env", "-i", f"HOME={BUILD_HOME}",
                       f"PATH={NODE_BIN}:/usr/bin:/bin", "NODE_OPTIONS=--max-old-space-size=512",
                       "npm_config_update_notifier=false"]
        for directory, arguments in ((stage, ["ci", "--include=dev", "--no-audit", "--no-fund"]),
                                     (stage, ["run", "build"]),
                                     (stage / "web", ["ci", "--include=dev", "--no-audit", "--no-fund"]),
                                     (stage / "web", ["run", "build"]),
                                     (stage, ["prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"])):
            run(environment + [NPM] + arguments, cwd=directory)
        if not (stage / "dist/app/http/main.js").is_file() or not (stage / "web/dist/index.html").is_file():
            raise SetupError("Build did not produce the API and frontend entrypoints.")
        # These are only installer-created staging paths, never uploaded sources.
        shutil.rmtree(stage / "web/node_modules")
        atomic_write(stage / ".host-release.json", json.dumps(expected, sort_keys=True).encode())
        own_tree(stage, 0, 0, public=True)
        if web_release.exists() or web_release.is_symlink():
            raise SetupError("Static release already exists without a matching application release; inspect it.")
        os.rename(stage, release)
        publish_static(release / "web/dist", web_release)
        return release, web_release
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def publish_static(source, destination):
    if source.is_symlink() or not (source / "index.html").is_file():
        raise SetupError("Missing regular frontend build output.")
    for path in source.rglob("*"):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise SetupError("Refusing non-regular static build output.")
    stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=WEB / "releases"))
    try:
        shutil.copytree(source, stage, dirs_exist_ok=True)
        own_tree(stage, 0, 0, public=True)
        os.rename(stage, destination)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def switch_link(path, target):
    if path.exists() and not path.is_symlink():
        raise SetupError(f"Refusing to replace a real path with a release symlink: {path}")
    temporary = path.with_name(f".{path.name}-{os.getpid()}")
    temporary.symlink_to(target)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv == ["--validate-env"]:
        errors = validate_environment(os.environ)
        if errors:
            print("Enrollment startup refused:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 1 if errors else 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path, help="Trusted uploaded repository source directory")
    parser.add_argument("--trusted-proxy-cidr", action="append", required=True, help="Exact AL1 peer IP, /32 or /128; repeat if needed")
    parser.add_argument("--admin-cidr", action="append", default=[], help="Allowed real-client admin CIDR; default denies all admin access")
    parser.add_argument("--server-name", required=True, help="Approved deployment hostname; keep actual inventory local")
    parser.add_argument("--rds-region", default="us-west-2", help="Region for the official public RDS CA bundle")
    parser.add_argument("--refresh-rds-ca", action="store_true", help="Explicitly refresh a valid cached public CA; API must be stopped first")
    args = parser.parse_args(argv)
    require_host()
    os.environ["PATH"] = "/usr/sbin:/usr/bin:/sbin:/bin"
    with setup_lock():
        return provision(args)


def provision(args):
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", args.server_name):
        raise SetupError("server-name must be a hostname, not nginx configuration.")
    proxies = networks(args.trusted_proxy_cidr, proxy=True)
    admins = networks(args.admin_cidr)
    ca_file = rds_ca_path(args.rds_region)
    source = args.source_dir.resolve(strict=True)
    if any(source.is_relative_to(path.resolve()) for path in (APP, WEB, CONFIG, CONTROL, CA_DIR)):
        raise SetupError("Upload source outside the installer's managed application/configuration directories.")
    files = source_files(source)
    installer = Path(__file__).read_bytes()
    digest = source_digest(source, files, installer)
    state_path = CONTROL / "state.json"
    if state_path.is_symlink():
        raise SetupError("Refusing a setup-state symlink.")
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    desired = {NGINX: render_nginx(args.server_name, proxies, admins).encode(), UNIT: render_unit().encode(), HELPER: installer}
    changed = {path: managed_status(path, data, state.get("managed_files", {}), 0o755 if path == HELPER else 0o644) for path, data in desired.items()}
    for path in (APP / "current", WEB / "current"):
        if path.exists() and not path.is_symlink():
            raise SetupError(f"Refusing unmanaged current-release path: {path}")
        expected = state.get("release" if path == APP / "current" else "static_release")
        if path.is_symlink() and (not expected or path.resolve() != Path(expected).resolve()):
            raise SetupError(f"Current-release link differs from setup state; inspect before changing it: {path}")
    env_path = CONFIG / ".env"
    if env_path.is_symlink() or (env_path.exists() and not env_path.is_file()):
        raise SetupError("Refusing non-regular .env file.")
    if env_path.exists():
        env_path.chmod(0o600)
        os.chown(env_path, 0, 0)
    if active(SERVICE):
        current = APP / "current"
        if state.get("source_digest") != digest or state.get("server_name") != args.server_name or any(changed.values()) or not current.is_symlink() or current.resolve() != Path(state.get("release", "")).resolve() or not env_path.is_file() or state.get("rds_region") != args.rds_region or args.refresh_rds_ca or ca_file.is_symlink() or not ca_file.is_file():
            raise SetupError("API is running and setup would change its release/configuration. Stop it explicitly in an approved window, then rerun.")
        validate_public_ca(ca_file.read_bytes())
        print("Host/source/configuration already prepared; active API left untouched. No packages, releases or secrets changed.")
        return 0

    install_host_packages()
    node_version = run([NODE, "--version"], capture=True).stdout.strip()
    if not node_version.startswith("v22.") or not Path(NPM).is_file():
        raise SetupError("Expected namespaced AL2023 Node.js 22 and npm executables.")
    for path in (APP, APP / "releases", WEB, WEB / "releases", NODE_BIN):
        ensure_directory(path)
    ensure_directory(CONFIG, 0o700)
    ensure_directory(CONTROL, 0o700)
    ca_file = ensure_rds_ca(args.rds_region, args.refresh_rds_ca)
    builder = ensure_user(BUILD_USER, BUILD_HOME)
    ensure_user(RUNTIME_USER, RUNTIME_HOME)
    for name, target in (("node", NODE), ("npm", NPM)):
        link = NODE_BIN / name
        if link.is_symlink() and os.readlink(link) == target:
            continue
        if link.exists() or link.is_symlink():
            raise SetupError(f"Refusing to overwrite runtime selector: {link}")
        link.symlink_to(target)

    create_env_once(env_path, env_template(args.server_name, ca_file).encode())
    env_path.chmod(0o600)
    os.chown(env_path, 0, 0)
    release, web_release = build_release(source, files, digest, node_version, builder, installer)
    previous_nginx = NGINX.read_bytes() if NGINX.exists() else None
    try:
        for path, data in desired.items():
            if changed[path]:
                atomic_write(path, data, 0o755 if path == HELPER else 0o644)
        test = run(["nginx", "-t"], capture=True, check=False)
        if test.returncode or "[warn]" in test.stderr:
            diagnostic = CONTROL / "nginx-validation.log"
            atomic_write(diagnostic, (test.stdout + test.stderr).encode(), 0o600)
            raise SetupError(f"nginx configuration test failed or warned; previous nginx config restored. See root-only {diagnostic}.")
    except Exception:
        if changed[NGINX]:
            if previous_nginx is None:
                NGINX.unlink(missing_ok=True)
            else:
                atomic_write(NGINX, previous_nginx)
        raise
    switch_link(APP / "current", release)
    switch_link(WEB / "current", web_release)
    if shutil.which("selinuxenabled") and run(["selinuxenabled"], check=False).returncode == 0:
        run(["setsebool", "-P", "httpd_can_network_connect", "on"])
        run(["restorecon", "-R", str(WEB)])
    run(["systemctl", "daemon-reload"])
    nginx_was_active = active("nginx.service")
    run(["systemctl", "enable", "--now", "nginx.service", "amazon-ssm-agent.service"])
    if changed[NGINX] and nginx_was_active:
        run(["systemctl", "reload", "nginx.service"])
    state = {"source_digest": digest, "node_version": node_version, "release": str(release), "static_release": str(web_release),
             "server_name": args.server_name, "rds_region": args.rds_region, "managed_files": {str(path): hashlib.sha256(data).hexdigest() for path, data in desired.items()}}
    atomic_write(state_path, (json.dumps(state, indent=2) + "\n").encode(), 0o600)
    print(f"Host prepared. Release: {release.name}")
    print(f"Configure {env_path} locally; its contents were not printed or copied from uploaded source.")
    print(f"Public RDS CA prepared: {ca_file}. Ensure .env has DB_TLS_MODE=verify_identity and DB_TLS_CA_FILE pointing here.")
    print("API was NOT enabled, started or restarted. No database/migration/email/DNS/certificate-cutover actions were performed.")
    print("Complete HOST_SETUP.md gates, then explicitly: systemctl enable --now enrollment-api.service")
    if not admins:
        print("Admin routes deny all clients. Rerun with --admin-cidr before authorizing staff access.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (SetupError, OSError, ValueError) as error:
        print(f"Host setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
