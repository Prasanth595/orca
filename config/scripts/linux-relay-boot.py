#!/usr/bin/env python3
"""Opt-in Linux desktop relay service with a private, volatile Secret Service."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

SCHEMA = "chrome_libsecret_os_crypt_password_v2"
NAME = "orca-relay-keyring"
UNIT = "orca-relay.service"


def unit_quote(value, command=False):
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Service paths must not contain control characters")
    value = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    return '"' + (value.replace("$", "$$") if command else value) + '"'


def select_key(collections):
    matches = []
    for collection in collections:
        if collection.is_locked():
            continue
        for item in collection.get_all_items():
            attrs = item.get_attributes()
            if attrs.get("application") == "orca" and attrs.get("xdg:schema") == SCHEMA:
                matches.append(item)
    if len(matches) != 1:
        raise ValueError("Unlock the Orca keyring first; exactly one Orca Safe Storage key is required")
    item = matches[0]
    return {"label": item.get_label(), "attributes": item.get_attributes(),
            "secret": item.get_secret().decode("utf-8")}


def validate_key(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid Orca keyring credential")
    attrs = data.get("attributes", {})
    if (not isinstance(attrs, dict) or attrs.get("application") != "orca"
            or attrs.get("xdg:schema") != SCHEMA
            or not isinstance(data.get("secret"), str) or not data["secret"]
            or not isinstance(data.get("label"), str)):
        raise ValueError("Invalid Orca keyring credential")
    return data


def unit_text(helper, app, credential):
    return f"""[Unit]
Description=Orca Relay before login (private display and keyring)
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
LoadCredentialEncrypted={unit_quote(NAME + ':' + str(credential))}
ExecStart=/usr/bin/dbus-run-session -- /usr/bin/python3 {unit_quote(str(helper), True)} run --app {unit_quote(str(app), True)}
Environment=ORCA_BACKGROUND_LAUNCH=1
UnsetEnvironment=ELECTRON_RUN_AS_NODE NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE
Restart=on-failure
RestartPreventExitStatus=3
RestartSec=5
KillMode=mixed
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
"""


def prepare(app):
    import secretstorage

    for program in ("systemd-creds", "dbus-run-session", "gnome-keyring-daemon", "xvfb-run", "Xvfb", "xauth"):
        if not shutil.which(program):
            raise ValueError(f"Required command not installed: {program}")
    app = app.resolve(strict=True)
    if not app.is_file() or not os.access(app, os.X_OK):
        raise ValueError("--app must name the installed Orca desktop executable, not its CLI launcher")
    config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    if not config.is_absolute():
        raise ValueError("XDG_CONFIG_HOME must be absolute")
    state = config / "orca-relay-boot"
    unit = config / "systemd/user" / UNIT
    if state.exists() or unit.exists() or state.is_symlink() or unit.is_symlink():
        raise ValueError("An installation already exists; follow the removal instructions before preparing again")
    key = validate_key(select_key(secretstorage.get_all_collections(secretstorage.dbus_init())))
    state.mkdir(mode=0o700, parents=True)
    try:
        credential = state / "keyring.cred"
        # Secrets travel over stdin, never process arguments or a plaintext file.
        subprocess.run(["systemd-creds", "encrypt", "--user", "--with-key=auto",
                        f"--name={NAME}", "-", str(credential)],
                       input=json.dumps(key).encode(), check=True)
        credential.chmod(0o600)
        helper = state / "runtime.py"
        helper.write_bytes(Path(__file__).read_bytes())
        helper.chmod(0o600)
        unit.parent.mkdir(parents=True, exist_ok=True)
        with unit.open("x") as output:
            output.write(unit_text(helper, app, credential))
        unit.chmod(0o600)
    except Exception:
        shutil.rmtree(state)
        raise
    print(f"Prepared {unit}. No services were started or stopped.")
    print("Enable user lingering, quit other Orca instances, then enable this service as documented.")


def run(app):
    import dbus
    import secretstorage

    data = validate_key(json.loads((Path(os.environ["CREDENTIALS_DIRECTORY"]) / NAME).read_text()))
    bus = dbus.SessionBus()
    if bus.name_has_owner("org.freedesktop.secrets"):
        raise ValueError("Refusing to modify an existing Secret Service; run through dbus-run-session")
    runtime = Path(os.environ["XDG_RUNTIME_DIR"])
    control = tempfile.mkdtemp(prefix="orca-relay-keyring-", dir=runtime)
    environment = {**os.environ, "GNOME_KEYRING_CONTROL": control,
                   "XDG_DATA_HOME": str(Path(control) / "data")}
    # An empty data home prevents searches from prompting to unlock personal keyrings.
    daemon = subprocess.Popen(["gnome-keyring-daemon", "--foreground", "--components=secrets",
                               "--control-directory=" + control], env=environment)
    for _ in range(100):
        if bus.name_has_owner("org.freedesktop.secrets"):
            break
        if daemon.poll() is not None:
            raise RuntimeError("Private Secret Service exited during startup")
        time.sleep(0.05)
    else:
        daemon.terminate()
        raise RuntimeError("Private Secret Service did not start")
    collection = secretstorage.Collection(secretstorage.dbus_init(),
                                         "/org/freedesktop/secrets/collection/session")
    collection.create_item(data["label"], data["attributes"], data["secret"].encode(), replace=True)
    service = dbus.Interface(bus.get_object("org.freedesktop.secrets", "/org/freedesktop/secrets"),
                             "org.freedesktop.Secret.Service")
    service.SetAlias("default", collection.collection_path)
    del data
    for name in ("CREDENTIALS_DIRECTORY", "DISPLAY", "XAUTHORITY", "GNOME_KEYRING_CONTROL"):
        os.environ.pop(name, None)
    os.environ["ORCA_BACKGROUND_LAUNCH"] = "1"
    print("Orca private in-memory keyring ready", flush=True)
    os.execvp("xvfb-run", ["xvfb-run", "--auto-servernum",
                          "--server-args=-screen 0 1280x800x24 -nolisten tcp",
                          str(app), "--password-store=gnome-libsecret"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run"))
    parser.add_argument("--app", type=Path, default=Path("/opt/Orca/orca-ide"))
    args = parser.parse_args()
    if sys.platform != "linux" or os.getuid() == 0:
        parser.error("Run as a regular Linux user, without sudo")
    try:
        (prepare if args.action == "prepare" else run)(args.app)
    except ValueError:
        print("Relay setup failed: unlock exactly one Orca keyring entry and check paths and existing installation.", file=sys.stderr)
        return 1
    except Exception:
        # Dependency exceptions can contain credential bytes; do not print their repr.
        print("Relay setup failed. Check dependencies, unlocked Orca keyring, service journal, and the guide.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
