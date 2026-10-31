"""Offline installer tests: no root, dnf, systemd, npm, or AWS operations."""

import importlib.util
from contextlib import nullcontext
import io
import json
from pathlib import Path
import ssl
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("setup_host", Path(__file__).parents[1] / "setup-host.py")
setup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Public trust-store material only; never network access or private keys.
        certificate = ssl.create_default_context().get_ca_certs(binary_form=True)[0]
        cls.public_ca = ssl.DER_cert_to_PEM_cert(certificate).encode()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        ca_directory = patch.object(setup, "CA_DIR", self.root / "public-ca")
        ca_directory.start()
        self.addCleanup(ca_directory.stop)
        network = patch.object(setup, "urlopen", side_effect=AssertionError("Installer tests must be offline"))
        network.start()
        self.addCleanup(network.stop)

    def source(self):
        source = self.root / "upload"
        for name in setup.REQUIRED_FILES:
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}")
        for name in ("src", "web/src"):
            path = source / name / "main.ts"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export {};")
        preview = source / "db/preview/base.sql"
        preview.parent.mkdir(parents=True, exist_ok=True)
        preview.write_text("CREATE TABLE fixture (id INT);")
        return source

    def valid_env(self):
        env = dict(line.split("=", 1) for line in setup.env_template("enrollment.example.org").splitlines() if line and not line.startswith("#"))
        ca_file = self.root / "valid-ca.pem"
        ca_file.write_bytes(self.public_ca)
        env.update(DB_HOST="db.example.org", DB_USER="enrollment_app", DB_PASSWORD="test-password",
                   DB_TLS_CA_FILE=str(ca_file),
                   EMAIL_FROM="enrollment@example.org", SMTP_HOST="smtp.example.org",
                   SMTP_USER="test-user", SMTP_PASS="test-smtp-password", ADMIN_IP_ALLOWLIST="198.51.100.10")
        return env

    def test_packages_include_mysql_client_without_server_or_database_connection(self):
        with patch.object(setup, "run") as commands:
            setup.install_host_packages()
        install, probe = [call.args[0] for call in commands.call_args_list]
        self.assertEqual(install[:3], ["dnf", "install", "-y"])
        self.assertIn("mariadb105", install)
        self.assertFalse(any(name.endswith("-server") or name in ("mysql-server", "mysqld") for name in install))
        self.assertEqual(probe, ["mysql", "--no-defaults", "--version"])

    def test_missing_mysql_client_is_not_silently_ignored(self):
        with patch.object(setup, "run", side_effect=[None, setup.SetupError("Client check failed")]) as commands:
            with self.assertRaisesRegex(setup.SetupError, "Client check failed"):
                setup.install_host_packages()
        self.assertEqual(commands.call_args.args[0], ["mysql", "--no-defaults", "--version"])

    def test_source_allowlist_excludes_legacy_secrets_state_and_dependencies(self):
        source = self.source()
        for name in ("old/real-data.sql", ".env", "infrastructure/terraform.tfstate", "src/.env.local", "src/node_modules/secret", "web/node_modules/secret", "web/dist/old.html", "db/preview/production-backup.sql"):
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("NEVER COPY")
        selected = {str(path.relative_to(source)) for path in setup.source_files(source)}
        self.assertIn("src/main.ts", selected)
        self.assertIn("db/preview/base.sql", selected)
        self.assertIn("db/preview/utf8mb4.sql", selected)
        self.assertNotIn("db/preview/production-backup.sql", selected)
        self.assertFalse(any("old/" in name or ".env" in name or "node_modules" in name or "tfstate" in name or "dist/" in name for name in selected))

    def test_source_rejects_symlink_parent_before_reading_files(self):
        source = self.source()
        (source / "web").rename(source / "other-web")
        (source / "web").symlink_to(source / "other-web", target_is_directory=True)
        with self.assertRaises(setup.SetupError):
            setup.source_files(source)

    def test_source_requires_both_reviewed_preview_assets(self):
        source = self.source()
        (source / "db/preview/utf8mb4.sql").unlink()
        with self.assertRaisesRegex(setup.SetupError, "db/preview/utf8mb4.sql"):
            setup.source_files(source)

    def test_source_rejects_symlink_file(self):
        source = self.source()
        (source / "src/linked.ts").symlink_to(source / "package.json")
        with self.assertRaises(setup.SetupError):
            setup.source_files(source)

    def test_digest_ignores_secrets_but_changes_with_source(self):
        source = self.source()
        files = setup.source_files(source)
        before = setup.source_digest(source, files, b"installer")
        (source / ".env").write_text("DB_PASSWORD=secret")
        self.assertEqual(before, setup.source_digest(source, setup.source_files(source), b"installer"))
        (source / "src/main.ts").write_text("export const changed = true;")
        self.assertNotEqual(before, setup.source_digest(source, files, b"installer"))

    def test_proxy_trust_is_exact_and_admin_networks_are_bounded(self):
        self.assertEqual(setup.networks(["192.0.2.26"], proxy=True), ["192.0.2.26/32"])
        for value in ("0.0.0.0/0", "192.0.0.0/16", "::/0"):
            with self.assertRaises(setup.SetupError):
                setup.networks([value], proxy=True)
        with self.assertRaises(setup.SetupError):
            setup.networks(["0.0.0.0/0"])
        with self.assertRaises(setup.SetupError):
            setup.networks(["fe80::1%eth0/128"], proxy=True)

    def test_exact_cidr_and_mapped_network_policy_matches_api_bounds(self):
        self.assertEqual(setup.networks(["198.51.100.10", "203.0.113.8/24", "2001:0DB8::1/64", "::ffff:192.0.2.0/120"]),
                         ["192.0.2.0/24", "198.51.100.10/32", "2001:db8::/64", "203.0.113.0/24"])
        self.assertEqual(setup.networks(["::ffff:c633:640a"], proxy=True), ["198.51.100.10/32"])
        for value in ("203.0.113", "198.51.100.0/23", "::/64", "::ffff:0:0/96", "::ffff:192.0.2.0/119",
                      "2001:db8::/63", "198.51.100.0/255.255.255.0", "fe80::1%eth0", ""):
            with self.subTest(value=value), self.assertRaises((ValueError, setup.SetupError)):
                setup.networks([value])
        with self.assertRaises(setup.SetupError):
            setup.networks(["198.51.100.10"] * 65)

    def test_runtime_admin_policy_rejects_empty_entries_broad_ranges_and_excessive_entries(self):
        for value in ("203.0.113", "203.0.113.0/23", "::/64", "::ffff:0:0/96", "198.51.100.10,", ",198.51.100.10", ",".join(["198.51.100.10"] * 65)):
            env = self.valid_env()
            env["ADMIN_IP_ALLOWLIST"] = value
            self.assertIn("ADMIN_IP_ALLOWLIST", "\n".join(setup.validate_environment(env)))
        env = self.valid_env()
        env["ADMIN_IP_ALLOWLIST"] = "203.0.113.0/24,2001:db8::/64,::ffff:192.0.2.0/120"
        self.assertEqual(setup.validate_environment(env), [])

    def test_runtime_root_origin_and_bcrypt_bounds_match_api_policy(self):
        for key, value in (("APP_BASE_URL", "https://example.org/new/"), ("APP_BASE_URL", "https://example.org/?token=DO_NOT_PRINT"),
                           ("BCRYPT_COST", "3"), ("BCRYPT_COST", "15"), ("BCRYPT_COST", "4.5")):
            env = self.valid_env()
            env[key] = value
            errors = "\n".join(setup.validate_environment(env))
            self.assertIn(key, errors)
            self.assertNotIn("DO_NOT_PRINT", errors)

    def test_nginx_gates_exact_and_nested_admin_routes_and_sanitizes_headers(self):
        config = setup.render_nginx("enrollment.example.org", ["192.0.2.26/32"], [])
        for location in ("= /admin", "^~ /admin/", "= /api/admin", "^~ /api/admin/"):
            self.assertIn(f"location {location}", config)
        self.assertEqual(config.count("deny all;"), 4)
        self.assertIn("proxy_set_header X-Forwarded-For $remote_addr;", config)
        self.assertIn('"1:https" https;', config)
        self.assertIn("set_real_ip_from 192.0.2.26/32;", config)
        self.assertIn("client_max_body_size 16m;", config)
        self.assertIn("log_format enrollment_host escape=json", config)
        self.assertNotIn("$request_uri", config)
        self.assertNotIn("$args", config)
        self.assertNotIn("$http_referer", config)
        self.assertEqual(config.count('add_header Referrer-Policy "no-referrer" always;'), 6)

    def test_unit_uses_compiled_api_and_root_read_env_not_a_shell(self):
        unit = setup.render_unit()
        self.assertIn("dist/app/http/main.js", unit)
        self.assertIn("User=enrollment\n", unit)
        self.assertIn("--validate-env", unit)
        self.assertIn("ProtectSystem=strict", unit)
        self.assertNotIn("npm start", unit)
        self.assertNotIn("tsx", unit)
        self.assertNotIn("/bin/sh", unit)

    def test_environment_template_is_inert_and_validated_after_configuration(self):
        template = setup.env_template("enrollment.example.org")
        self.assertIn("EMAIL_WORKER_INTERVAL_MS=0", template)
        self.assertIn("REMINDER_INTERVAL_MS=0", template)
        self.assertIn("ADMIN_BOOTSTRAP_PASSWORD=\n", template)
        self.assertEqual(setup.validate_environment(self.valid_env()), [])
        self.assertTrue(setup.validate_environment({}))

    def test_setup_requires_an_explicit_hostname_before_host_operations(self):
        with patch.object(setup, "require_host") as require_host, patch.object(setup.sys, "stderr", io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                setup.main(["--source-dir", str(self.root), "--trusted-proxy-cidr", "192.0.2.26/32"])
            self.assertEqual(error.exception.code, 2)
            require_host.assert_not_called()

    def test_startup_rejects_dev_modes_and_does_not_log_secret_values(self):
        env = self.valid_env()
        env.update(DB_PASSWORD="YOUR_SUPER_SECRET", EMAIL_PROVIDER="console", HOST="0.0.0.0", ADMIN_IP_ALLOWLIST="198.51.100.0/0")
        errors = "\n".join(setup.validate_environment(env))
        self.assertIn("DB_PASSWORD", errors)
        self.assertNotIn("YOUR_SUPER_SECRET", errors)
        self.assertIn("EMAIL_PROVIDER", errors)
        self.assertIn("HOST", errors)
        self.assertIn("exact IPs", errors)

    def test_invalid_urls_ports_and_intervals_fail_closed(self):
        for key, value in (("APP_BASE_URL", "http://example.org"), ("APP_BASE_URL", "https://user:secret@example.org"),
                           ("APP_BASE_URL", "https://example.org:bad"), ("DB_PORT", "0"), ("SMTP_PORT", "not-a-port"),
                           ("EMAIL_WORKER_INTERVAL_MS", "-1"), ("REMINDER_INTERVAL_MS", "NaN")):
            env = self.valid_env()
            env[key] = value
            self.assertTrue(setup.validate_environment(env), (key, value))

    def test_managed_files_refuse_unknown_files_and_local_edits(self):
        path = self.root / "managed.conf"
        self.assertTrue(setup.managed_status(path, b"desired", {}))
        path.write_bytes(b"operator's configuration")
        path.chmod(0o644)
        with self.assertRaises(setup.SetupError):
            setup.managed_status(path, b"desired", {})
        self.assertFalse(setup.managed_status(path, path.read_bytes(), {}))
        import hashlib
        previous = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()}
        self.assertTrue(setup.managed_status(path, b"desired", previous))
        path.write_bytes(b"new local edit")
        with self.assertRaises(setup.SetupError):
            setup.managed_status(path, b"desired", previous)

    def test_env_creation_never_replaces_an_existing_file(self):
        path = self.root / ".env"
        self.assertTrue(setup.create_env_once(path, b"initial"))
        path.write_bytes(b"operator secret")
        self.assertFalse(setup.create_env_once(path, b"replacement"))
        self.assertEqual(path.read_bytes(), b"operator secret")

    def test_cached_public_ca_is_preserved_without_network_access(self):
        with patch.object(setup.os, "chown"), patch.object(setup, "fetch_rds_ca", return_value=self.public_ca) as fetch:
            path = setup.ensure_rds_ca("us-west-2")
            self.assertEqual(path, setup.CA_DIR / "rds-us-west-2-bundle.pem")
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
            before = path.stat().st_mtime_ns
            self.assertEqual(setup.ensure_rds_ca("us-west-2"), path)
            self.assertEqual(path.stat().st_mtime_ns, before)
            self.assertEqual(path.read_bytes(), self.public_ca)
            fetch.assert_called_once_with("us-west-2")

    def test_invalid_download_is_not_published_or_used_to_replace_cached_ca(self):
        with patch.object(setup.os, "chown"), patch.object(setup, "fetch_rds_ca", return_value=b"not a PEM"):
            with self.assertRaises(setup.SetupError):
                setup.ensure_rds_ca("us-west-2")
            path = setup.rds_ca_path("us-west-2")
            self.assertFalse(path.exists())
            path.write_bytes(self.public_ca)
            with self.assertRaises(setup.SetupError):
                setup.ensure_rds_ca("us-west-2", refresh=True)
            self.assertEqual(path.read_bytes(), self.public_ca)

    def test_ca_refresh_is_explicit_and_does_not_replace_unexpected_paths(self):
        with patch.object(setup.os, "chown"), patch.object(setup, "fetch_rds_ca", return_value=self.public_ca) as fetch:
            path = setup.ensure_rds_ca("us-west-2")
            replacement = b"# refreshed public bundle\n" + self.public_ca
            fetch.return_value = replacement
            setup.ensure_rds_ca("us-west-2", refresh=True)
            self.assertEqual(path.read_bytes(), replacement)
            self.assertEqual(fetch.call_count, 2)
            path.write_bytes(b"operator file, not a CA")
            with self.assertRaises(setup.SetupError):
                setup.ensure_rds_ca("us-west-2", refresh=True)
            self.assertEqual(path.read_bytes(), b"operator file, not a CA")
            path.unlink()
            path.symlink_to(self.root / "missing")
            with self.assertRaises(setup.SetupError):
                setup.ensure_rds_ca("us-west-2", refresh=True)
            path.unlink()
            path.mkdir()
            with self.assertRaises(setup.SetupError):
                setup.ensure_rds_ca("us-west-2", refresh=True)
            self.assertEqual(fetch.call_count, 2)

    def test_download_uses_verified_https_fixed_region_url_and_bounded_reads(self):
        response = io.BytesIO(self.public_ca)
        with patch.object(setup, "urlopen", return_value=response) as download:
            self.assertEqual(setup.fetch_rds_ca("us-west-2"), self.public_ca)
            arguments, options = download.call_args
            self.assertEqual(arguments, ("https://truststore.pki.rds.amazonaws.com/us-west-2/us-west-2-bundle.pem",))
            self.assertEqual(options["context"].verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(options["context"].check_hostname)
            self.assertEqual(options["timeout"], 30)
        for data in (b"x" * (1024 * 1024 + 1), b"malformed PEM"):
            with patch.object(setup, "urlopen", return_value=io.BytesIO(data)), self.assertRaises(setup.SetupError):
                setup.fetch_rds_ca("us-west-2")
        with patch.object(setup, "urlopen", side_effect=OSError("sensitive response")), self.assertRaisesRegex(setup.SetupError, "verified HTTPS"):
            setup.fetch_rds_ca("us-west-2")
        with self.assertRaises(setup.SetupError):
            setup.fetch_rds_ca("../../not-a-region")

    def test_startup_tls_policy_rejects_missing_invalid_or_private_material(self):
        for mode in ("", "disabled", "preferred"):
            env = self.valid_env()
            env["DB_TLS_MODE"] = mode
            self.assertIn("DB_TLS_MODE", "\n".join(setup.validate_environment(env)))
        for path in ("", "relative.pem", str(self.root / "missing.pem")):
            env = self.valid_env()
            env["DB_TLS_CA_FILE"] = path
            self.assertIn("DB_TLS_CA_FILE", "\n".join(setup.validate_environment(env)))
        for data in (b"DO_NOT_PRINT", self.public_ca + b"\n-----BEGIN PRIVATE KEY-----\nDO_NOT_PRINT\n", b"\xff"):
            env = self.valid_env()
            Path(env["DB_TLS_CA_FILE"]).write_bytes(data)
            errors = "\n".join(setup.validate_environment(env))
            self.assertIn("DB_TLS_CA_FILE", errors)
            self.assertNotIn("DO_NOT_PRINT", errors)

    def test_setup_lock_refuses_a_concurrent_run(self):
        metadata = SimpleNamespace(st_uid=0, st_mode=setup.stat.S_IFREG | 0o600)
        with patch.object(setup, "LOCK", self.root / "setup.lock"), patch.object(setup.os, "fstat", return_value=metadata):
            with setup.setup_lock():
                with self.assertRaises(setup.SetupError):
                    with setup.setup_lock():
                        self.fail("A second installer acquired the same lock")

    def test_changing_upload_is_rejected_before_build_or_promotion(self):
        source = self.source()
        files = setup.source_files(source)
        installer = b"test installer"
        digest = setup.source_digest(source, files, installer)
        app = self.root / "app"
        (app / "releases").mkdir(parents=True)
        copyfile = setup.shutil.copyfile

        def changing_copy(path, destination):
            if path == source / "src/main.ts":
                path.write_text("changed during upload")
            return copyfile(path, destination)

        with patch.object(setup, "APP", app), patch.object(setup, "WEB", self.root / "www"), \
                patch.object(setup.shutil, "copyfile", side_effect=changing_copy), patch.object(setup, "run") as commands:
            with self.assertRaisesRegex(setup.SetupError, "Source changed"):
                setup.build_release(source, files, digest, "v22.20.0", SimpleNamespace(), installer)
            commands.assert_not_called()
        self.assertEqual(list((app / "releases").iterdir()), [])
        self.assertFalse((app / "current").exists())

    def test_installer_rerun_preserves_env_and_skips_rebuild_without_starting_api(self):
        source = self.source()
        locations = {
            "APP": self.root / "app", "WEB": self.root / "www", "CONFIG": self.root / "config",
            "CONTROL": self.root / "control", "HELPER": self.root / "libexec/setup-host.py",
            "NODE_BIN": self.root / "node-bin", "UNIT": self.root / "systemd/enrollment.service",
            "NGINX": self.root / "nginx/enrollment.conf", "BUILD_HOME": self.root / "build-home",
            "RUNTIME_HOME": self.root / "runtime-home", "NODE": str(self.root / "node-22"),
            "NPM": str(self.root / "npm-22"),
        }
        Path(locations["NPM"]).touch()
        user = SimpleNamespace(pw_uid=1001, pw_gid=1001)
        commands = []
        api_active = False
        nginx_warning = False

        def fake_run(command, *, cwd=None, **kwargs):
            commands.append(command)
            result = SimpleNamespace(returncode=0, stdout="", stderr="")
            if command[:2] == ["systemctl", "is-active"]:
                result.returncode = 0 if api_active and command[-1] == setup.SERVICE else 3
            elif command == ["nginx", "-t"] and nginx_warning:
                result.stderr = "[warn] simulated warning"
            elif command == [locations["NODE"], "--version"]:
                result.stdout = "v22.20.0\n"
            elif command[0] == "runuser":
                if "ci" in command:
                    (cwd / "node_modules").mkdir()
                elif command[-2:] == ["run", "build"]:
                    output = cwd / ("dist/index.html" if cwd.name == "web" else "dist/app/http/main.js")
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text("built")
            return result

        arguments = ["--source-dir", str(source), "--server-name", "enrollment.example.org", "--trusted-proxy-cidr", "192.0.2.26/32"]
        with patch.multiple(setup, **locations), patch.object(setup, "require_host"), \
                patch.object(setup, "setup_lock", return_value=nullcontext()), \
                patch.object(setup, "ensure_user", return_value=user), patch.object(setup.os, "chown"), \
                patch.object(setup.shutil, "which", return_value=None), patch.object(setup, "run", side_effect=fake_run), \
                patch.object(setup, "fetch_rds_ca", return_value=self.public_ca) as fetch, \
                patch.dict(setup.os.environ), patch("builtins.print"):
            self.assertEqual(setup.main(arguments), 0)
            self.assertTrue(any(command[:3] == ["dnf", "install", "-y"] and "mariadb105" in command for command in commands))
            self.assertIn(["mysql", "--no-defaults", "--version"], commands)
            fetch.assert_called_once_with("us-west-2")
            env_path = locations["CONFIG"] / ".env"
            env_path.write_text("DB_PASSWORD=DO_NOT_OVERWRITE\n")
            initial_release = (locations["APP"] / "current").resolve()
            initial_npm_calls = len([command for command in commands if command[0] == "runuser"])
            self.assertEqual(setup.main(arguments), 0)
            self.assertEqual(env_path.read_text(), "DB_PASSWORD=DO_NOT_OVERWRITE\n")
            self.assertEqual(env_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(initial_release, (locations["APP"] / "current").resolve())
            self.assertEqual(initial_npm_calls, len([command for command in commands if command[0] == "runuser"]))
            self.assertNotIn("DO_NOT_OVERWRITE", (locations["CONTROL"] / "state.json").read_text())
            self.assertTrue((locations["WEB"] / "current/index.html").is_file())
            self.assertEqual((initial_release / "db/preview/base.sql").read_text(), "CREATE TABLE fixture (id INT);")
            api_active = True
            before_noop = len(commands)
            self.assertEqual(setup.main(arguments), 0)
            self.assertEqual(commands[before_noop:], [["systemctl", "is-active", "--quiet", setup.SERVICE]])
            ca_file = setup.rds_ca_path("us-west-2")
            for extra in (["--refresh-rds-ca"], ["--rds-region", "us-east-1"]):
                with self.assertRaisesRegex(setup.SetupError, "API is running"):
                    setup.main(arguments + extra)
            ca_file.unlink()
            with self.assertRaisesRegex(setup.SetupError, "API is running"):
                setup.main(arguments)
            ca_file.write_bytes(b"invalid cached CA")
            with self.assertRaises(setup.SetupError):
                setup.main(arguments)
            ca_file.write_bytes(self.public_ca)
            fetch.assert_called_once_with("us-west-2")
            (source / "src/main.ts").write_text("changed source")
            with self.assertRaises(setup.SetupError):
                setup.main(arguments)
            (source / "src/main.ts").write_text("export {};")
            api_active = False
            self.assertEqual(setup.main(arguments + ["--refresh-rds-ca"]), 0)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(env_path.read_text(), "DB_PASSWORD=DO_NOT_OVERWRITE\n")
            previous_nginx = locations["NGINX"].read_bytes()
            nginx_warning = True
            with self.assertRaises(setup.SetupError):
                setup.main(arguments + ["--admin-cidr", "198.51.100.10/32"])
            self.assertEqual(locations["NGINX"].read_bytes(), previous_nginx)
            nginx_warning = False
            for command in commands:
                if command[0] == "mysql":
                    self.assertEqual(command, ["mysql", "--no-defaults", "--version"])
                if command[0] == "systemctl" and command[1] in ("start", "restart", "enable"):
                    self.assertNotIn(setup.SERVICE, command)
                    self.assertFalse(any("mariadb" in name or "mysqld" in name for name in command))
                if command[:3] == ["systemctl", "enable", "--now"]:
                    self.assertNotIn(setup.SERVICE, command)
                self.assertNotIn("db:migrate", command)
                self.assertNotIn("db:seed", command)
                self.assertNotIn("db:init-preview", command)
            locations["NGINX"].write_text("operator edit")
            with self.assertRaises(setup.SetupError):
                setup.main(arguments)


if __name__ == "__main__":
    unittest.main()
