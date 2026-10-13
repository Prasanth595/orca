import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("relay_boot", Path(__file__).with_name("linux-relay-boot.py"))
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)


def item(application="orca", schema=boot.SCHEMA):
    return Mock(get_attributes=Mock(return_value={"application": application, "xdg:schema": schema}),
                get_label=Mock(return_value="Chromium Safe Storage"),
                get_secret=Mock(return_value=b"fixture-key"))


def collection(items, locked=False):
    return Mock(is_locked=Mock(return_value=locked), get_all_items=Mock(return_value=items))


class RelayBootTests(unittest.TestCase):
    def test_exports_only_orca_key_without_unlocking_personal_collections(self):
        other = item("other-app")
        locked = collection([item()], locked=True)
        key = boot.select_key([locked, collection([other, item()])])
        self.assertEqual(key["secret"], "fixture-key")
        locked.get_all_items.assert_not_called()
        other.get_secret.assert_not_called()

    def test_missing_locked_or_ambiguous_key_fails_closed(self):
        for collections in ([], [collection([item()], True)], [collection([item(), item()])]):
            with self.subTest(collections=collections), self.assertRaises(ValueError):
                boot.select_key(collections)

    def test_rejects_foreign_or_malformed_credentials(self):
        valid = boot.select_key([collection([item()])])
        self.assertEqual(boot.validate_key(valid), valid)
        for value in (None, [], {}, {**valid, "secret": ""},
                      {**valid, "attributes": []},
                      {**valid, "attributes": {"application": "other", "xdg:schema": boot.SCHEMA}}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                boot.validate_key(value)

    def test_unit_separates_argument_expansion_from_credential_paths(self):
        unit = boot.unit_text(Path('/helper $var% "x"'), Path('/app $var%'), Path('/key $var%'))
        self.assertIn('LoadCredentialEncrypted="orca-relay-keyring:/key $var%%"', unit)
        self.assertIn('"/app $$var%%"', unit)
        self.assertIn("WantedBy=default.target", unit)
        self.assertIn("ORCA_BACKGROUND_LAUNCH=1", unit)
        self.assertIn("RestartPreventExitStatus=3", unit)
        self.assertNotIn("DISPLAY=", unit)
        with self.assertRaises(ValueError):
            boot.unit_quote("/bad\nExecStart=command")

    def test_prepare_encrypts_over_stdin_and_does_not_enable_services(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "config"
            app = Path(root) / "orca-ide"
            app.write_text("fixture")
            app.chmod(0o700)
            secrets = SimpleNamespace(dbus_init=lambda: None,
                                      get_all_collections=lambda _: [collection([item()])])
            calls = []

            def encrypt(argv, **kwargs):
                calls.append((argv, kwargs))
                Path(argv[-1]).write_bytes(b"encrypted-fixture")

            with patch.dict(os.environ, {"XDG_CONFIG_HOME": str(config)}), \
                    patch.dict("sys.modules", {"secretstorage": secrets}), \
                    patch.object(boot.shutil, "which", return_value="/fixture"), \
                    patch.object(boot.subprocess, "run", side_effect=encrypt):
                boot.prepare(app)
                self.assertEqual(len(calls), 1)
                argv, kwargs = calls[0]
                self.assertEqual(argv[:4], ["systemd-creds", "encrypt", "--user", "--with-key=auto"])
                self.assertNotIn("fixture-key", " ".join(argv))
                self.assertEqual(json.loads(kwargs["input"])["secret"], "fixture-key")
                state = config / "orca-relay-boot"
                self.assertEqual((state / "keyring.cred").stat().st_mode & 0o777, 0o600)
                self.assertEqual(state.stat().st_mode & 0o777, 0o700)
                self.assertNotIn("fixture-key", (state / "runtime.py").read_text())
                before = (config / "systemd/user" / boot.UNIT).read_bytes()
                with self.assertRaises(ValueError):
                    boot.prepare(app)
                self.assertEqual((config / "systemd/user" / boot.UNIT).read_bytes(), before)

    def test_encryption_failure_leaves_no_installation(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "config"
            app = Path(root) / "orca-ide"
            app.write_text("fixture")
            app.chmod(0o700)
            secrets = SimpleNamespace(dbus_init=lambda: None,
                                      get_all_collections=lambda _: [collection([item()])])
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": str(config)}), \
                    patch.dict("sys.modules", {"secretstorage": secrets}), \
                    patch.object(boot.shutil, "which", return_value="/fixture"), \
                    patch.object(boot.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "encrypt")):
                with self.assertRaises(subprocess.CalledProcessError):
                    boot.prepare(app)
                self.assertFalse((config / "orca-relay-boot").exists())
                self.assertFalse((config / "systemd/user" / boot.UNIT).exists())

    def test_runtime_refuses_an_existing_secret_service(self):
        with tempfile.TemporaryDirectory() as root:
            credential = Path(root) / boot.NAME
            credential.write_text(json.dumps(boot.select_key([collection([item()])])))
            bus = Mock(name_has_owner=Mock(return_value=True))
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": root}), \
                    patch.dict("sys.modules", {"dbus": SimpleNamespace(SessionBus=lambda: bus),
                                               "secretstorage": SimpleNamespace()}), \
                    patch.object(boot.subprocess, "Popen") as spawn:
                with self.assertRaises(ValueError):
                    boot.run(Path("/app"))
                spawn.assert_not_called()

    def test_runtime_isolates_keyring_data_and_launches_without_credential_environment(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / boot.NAME).write_text(json.dumps(boot.select_key([collection([item()])])))
            bus = Mock(name_has_owner=Mock(side_effect=[False, True]))
            store = Mock(collection_path="/org/freedesktop/secrets/collection/session")
            service = Mock()
            secrets = SimpleNamespace(dbus_init=lambda: None, Collection=Mock(return_value=store))
            env = {"CREDENTIALS_DIRECTORY": root, "XDG_RUNTIME_DIR": root, "DISPLAY": ":0",
                   "XAUTHORITY": "/personal", "GNOME_KEYRING_CONTROL": "/personal-keyring"}
            with patch.dict(os.environ, env), \
                    patch.dict("sys.modules", {"dbus": SimpleNamespace(SessionBus=lambda: bus,
                                                                        Interface=lambda *args: service),
                                               "secretstorage": secrets}), \
                    patch.object(boot.subprocess, "Popen") as spawn, \
                    patch.object(boot.os, "execvp") as execute:
                boot.run(Path("/installed/orca-ide"))
                daemon_env = spawn.call_args.kwargs["env"]
                self.assertTrue(daemon_env["XDG_DATA_HOME"].startswith(root + "/orca-relay-keyring-"))
                self.assertNotEqual(daemon_env["GNOME_KEYRING_CONTROL"], "/personal-keyring")
                store.create_item.assert_called_once_with("Chromium Safe Storage",
                    {"application": "orca", "xdg:schema": boot.SCHEMA}, b"fixture-key", replace=True)
                service.SetAlias.assert_called_once_with("default", store.collection_path)
                self.assertNotIn("CREDENTIALS_DIRECTORY", os.environ)
                self.assertNotIn("DISPLAY", os.environ)
                self.assertEqual(os.environ["ORCA_BACKGROUND_LAUNCH"], "1")
                self.assertIn("-nolisten tcp", " ".join(execute.call_args.args[1]))
                self.assertIn("--password-store=gnome-libsecret", execute.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
