#!/usr/bin/env bash
# Local Linux ARM64 package build under rootful Podman, driven by build-linux-arm64-local.ps1.
#   host        (WSL distro, root) build images, then run the two container stages
#   javascript  (x64 container)    platform-neutral JS + the cross-compiled Wayland helper
#   package     (arm64 container)  Linux arm64 install, Electron native rebuild, electron-builder
# The work root holds x64/ and arm64/ git checkouts of one snapshot, so each architecture
# keeps its own node_modules and neither touches the Windows checkout.
set -euo pipefail

work="${ORCA_LINUX_BUILD_WORK:-${2:-/work}}"
staging_parent=/var/lib/orca-local-build

log() { printf '[linux-arm64-local] %s\n' "$*"; }

reject() { log "$*" >&2; return 1; }

validate_checkout_paths() {
  local root="$1" arch target path
  for arch in x64 arm64; do
    target="$root/$arch"
    [ "$(realpath -m -- "$target")" = "$target" ] || return 1
    for path in .git node_modules out dist native/wayland-clipboard/.build; do
      [ "$(realpath -m -- "$target/$path")" = "$target/$path" ] || return 1
    done
  done
}

validate_staging_paths() {
  local root="$1" source="$2" path
  case "$root" in
    "$staging_parent"/*) ;;
    *) reject "WorkRoot must be a dedicated absolute directory below $staging_parent"; return 1 ;;
  esac
  [ "$(realpath -m -- "$root")" = "$root" ] || {
    reject 'WorkRoot must be normalized and contain no symlinks'; return 1;
  }
  source="$(realpath -e -- "$source")"
  case "$root/" in "$source/"*) reject 'WorkRoot overlaps the source checkout'; return 1 ;; esac
  case "$source/" in "$root/"*) reject 'Source checkout overlaps WorkRoot'; return 1 ;; esac
  for path in cache artifacts artifacts/latest-artifact javascript-tree .orca-linux-arm64-source; do
    [ "$(realpath -m -- "$root/$path")" = "$root/$path" ] || {
      reject "Staging path escapes WorkRoot: $path"; return 1;
    }
  done
  validate_checkout_paths "$root" || {
    reject 'A checkout or build output path is a symlink or escapes WorkRoot'; return 1;
  }
}

sync_source() {
  local source="$1" base="$2" snapshot="$3" adopt="$4" arch remote
  validate_staging_paths "$work" "$source"
  source="$(realpath -e -- "$source")"
  local marker="$work/.orca-linux-arm64-source"
  if [ -f "$marker" ]; then
    [ "$(cat "$marker")" = "$source" ] || { reject 'WorkRoot belongs to another source'; return 1; }
  elif [ -d "$work" ] && [ -n "$(ls -A -- "$work")" ] && [ "$adopt" != 1 ]; then
    reject 'Existing unmarked WorkRoot requires -AdoptExistingStaging after inspection'; return 1
  fi
  # Validate both destinations before either checkout is changed.
  for arch in x64 arm64; do
    if [ -e "$work/$arch" ]; then
      [ -d "$work/$arch/.git" ] || { reject "Not a staging checkout: $arch"; return 1; }
      [ "$(git -C "$work/$arch" rev-parse --show-toplevel)" = "$work/$arch" ] || return 1
    fi
  done
  mkdir -p "$work"
  printf '%s\n' "$source" > "$marker"
  for arch in x64 arm64; do
    mkdir -p "$work/$arch"
    [ -d "$work/$arch/.git" ] || git -C "$work/$arch" init -q
    remote="$source"; [ "$arch" = x64 ] || remote="$work/x64"
    git -C "$work/$arch" -c safe.directory="$remote" -c uploadpack.allowAnySHA1InWant=true \
      fetch -q --depth=1 "$remote" "$base" "$snapshot"
    git -C "$work/$arch" update-ref --no-deref HEAD "$base"
    git -C "$work/$arch" read-tree --reset -u "$snapshot"
    git -C "$work/$arch" update-ref refs/orca-local-build/snapshot "$snapshot"
  done
}

# Prints "<archive> <sha256>" for a target in the shared Node runtime pin.
node_pin() {
  awk -v target="'$1':" '
    $1 == target { found = 1 }
    found && $1 == "archive:" { gsub(/[\x27,]/, "", $2); archive = $2 }
    found && $1 == "archiveSha256:" { gsub(/[\x27,]/, "", $2); print archive, $2; exit }
  ' "$2/src/shared/node-runtime-pin.ts"
}

build_image() {
  local tag="$1" platform="$2" base="$3" packages="$4" target="$5" archive sha
  read -r archive sha < <(node_pin "$target" "$work/x64")
  [ -n "$sha" ] || { log "no Node pin for $target"; exit 1; }
  podman build --platform "$platform" -t "$tag" \
    --build-arg "BASE_IMAGE=$base" \
    --build-arg "EXTRA_PACKAGES=$packages" \
    --build-arg "NODE_ARCHIVE=$archive" \
    --build-arg "NODE_SHA256=$sha" \
    -f "$work/x64/config/scripts/build-linux-arm64-local.Containerfile" "$work/x64/config/scripts"
}

# Why a per-arch corepack home: pnpm 12 is a native executable, so one cache cannot serve both.
container_env() {
  printf '%s\n' \
    -e ORCA_BACKGROUND_LAUNCH=1 \
    -e ORCA_CONTAINER_ENGINE=podman \
    -e ORCA_LINUX_BUILD_WORK=/work \
    -e "ORCA_LOCAL_BUILD_VERSION=${ORCA_LOCAL_BUILD_VERSION:?missing local build version}" \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e "COREPACK_HOME=/work/cache/corepack-$1" \
    -e npm_config_store_dir=/work/cache/pnpm-store \
    -e ELECTRON_CACHE=/work/cache/electron \
    -e ELECTRON_BUILDER_CACHE=/work/cache/electron-builder \
    -e ORCA_NODE_RUNTIME_CACHE_DIR=/work/cache/node-runtime \
    -e NODE_OPTIONS=--max-old-space-size=4096
}

run_host() {
  [ -f "$work/.orca-linux-arm64-source" ] || { reject 'Missing staging source marker'; return 1; }
  validate_staging_paths "$work" "$(cat "$work/.orca-linux-arm64-source")"
  local x64_image=localhost/orca-linux-build:x64 arm64_image=localhost/orca-linux-build:arm64
  # WSL drops in-kernel binfmt entries whenever the distro restarts; the config itself persists.
  if [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    /usr/lib/systemd/systemd-binfmt /usr/lib/binfmt.d/qemu-aarch64-static.conf
  fi
  grep -qx enabled /proc/sys/fs/binfmt_misc/qemu-aarch64
  mkdir -p "$work/cache/nested-containers" "$work/artifacts"
  if [ "${ORCA_LINUX_BUILD_SKIP_IMAGES:-0}" != 1 ]; then
    # Why podman/stable: the Wayland helper is compiled by its own Dockerfile, so this stage
    # runs the repo script with a nested Podman instead of Docker.
    build_image "$x64_image" linux/amd64 \
      quay.io/podman/stable@sha256:28c72e39a70b8a6e2b567efe1b34e53850ea77b4c7c1538e41fe5a138055566d \
      'git binutils xz make gcc-c++ python3' linux-x64-glibc
    # Why manylinux_2_28: compiling on glibc 2.28 keeps native addons under both the desktop
    # (2.31) and server (2.28) floors, and gcc-toolset-14 handles Electron's C++20 headers.
    # The runtime libraries let the native-runtime and packaging gates execute the arm64 Electron.
    build_image "$arm64_image" linux/arm64 \
      quay.io/pypa/manylinux_2_28_aarch64@sha256:c22ffd129ac99a8a42d1f2c2f4e88a9089288dd9ee987a7092da1c7dc48f27a9 \
      'nss nspr gtk3 libXScrnSaver libXtst at-spi2-core alsa-lib mesa-libgbm libdrm cups-libs libxkbcommon libnotify xorg-x11-server-Xvfb' \
      linux-arm64-glibc
  fi
  local stages="${ORCA_LINUX_BUILD_STAGES:-javascript package}"
  local x64_env arm64_env
  mapfile -t x64_env < <(container_env x64)
  mapfile -t arm64_env < <(container_env arm64)
  if [[ " $stages " == *' javascript '* ]]; then
    podman run --rm --platform linux/amd64 --privileged "${x64_env[@]}" \
      -v "$work:/work" -v "$work/cache/nested-containers:/var/lib/containers" \
      "$x64_image" bash /work/x64/config/scripts/build-linux-arm64-local.sh javascript
  fi
  if [[ " $stages " == *' package '* ]]; then
    podman run --rm --platform linux/arm64 "${arm64_env[@]}" -v "$work:/work" \
      "$arm64_image" bash /work/arm64/config/scripts/build-linux-arm64-local.sh package
  fi
}

run_javascript() {
  cd "$work/x64"
  [ "$(uname -m)" = x86_64 ]
  # Mirrors release-javascript.yml: a script-free install, then only the Node runtime it needs.
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm run build:packages
  node config/scripts/ensure-native-runtime.mjs --runtime=node
  (cd mobile && pnpm install --frozen-lockfile)
  pnpm run build:release:javascript
  ORCA_CONTAINER_ENGINE=podman node config/scripts/build-wayland-clipboard.mjs --arch arm64
  git write-tree > "$work/javascript-tree"
}

run_package() {
  cd "$work/arm64"
  [ "$(uname -m)" = aarch64 ]
  export ORCA_CONTAINER_ENGINE=podman
  if [ "$(cat "$work/javascript-tree" 2>/dev/null)" != "$(git write-tree)" ]; then
    log 'the x64 JavaScript was built from another snapshot; rerun with the javascript stage'
    exit 1
  fi
  # Install all package slices before packaging; the normal gates still select and validate arm64.
  pnpm run install:release
  export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
  # Match the release JavaScript split; host-specific outputs are excluded from the copy.
  rm -rf out
  mkdir out
  (cd "$work/x64/out" && tar --exclude=./relay --exclude='./orcad*' --exclude='./.orcad*' \
    --exclude=./node-runtime-cache --exclude=./runtimes -cf - .) | tar -C out -xf -
  rm -rf native/wayland-clipboard/.build/arm64
  mkdir -p native/wayland-clipboard/.build
  cp -a "$work/x64/native/wayland-clipboard/.build/arm64" native/wayland-clipboard/.build/arm64
  pnpm run build:wsl-guest
  # Revalidate the copied helper; the arm64 image has no engine and cannot rebuild a cache miss.
  ORCA_CONTAINER_ENGINE=podman pnpm run build:native
  pnpm run verify:built-skills-cli
  node config/scripts/ensure-native-runtime.mjs --runtime=electron
  rm -rf dist/linux-arm64-unpacked
  pnpm exec electron-builder --config config/electron-builder.config.cjs --linux dir --arm64 \
    --publish never
  # Base commit plus snapshot tree, since the snapshot carries uncommitted worktree changes.
  local name
  name="orca-linux-arm64-unpacked-${ORCA_LOCAL_BUILD_VERSION}-$(git rev-parse --short=12 HEAD)-$(git write-tree | cut -c1-8)"
  local artifact="$work/artifacts/$name.tar.gz"
  export ORCA_LOCAL_BUILD_SOURCE_COMMIT="$(git rev-parse HEAD)"
  export ORCA_LOCAL_BUILD_SNAPSHOT_COMMIT="$(git rev-parse refs/orca-local-build/snapshot)"
  export ORCA_LOCAL_BUILD_SNAPSHOT_TREE="$(git write-tree)"
  node -e '
    const fs = require("node:fs");
    const assert = require("node:assert/strict");
    const crypto = require("node:crypto");
    const asar = require("@electron/asar");
    const archive = "dist/linux-arm64-unpacked/resources/app.asar";
    const metadata = asar.extractFile(archive, "package.json");
    assert.equal(JSON.parse(metadata).version, process.env.ORCA_LOCAL_BUILD_VERSION);
    assert(!asar.listPackage(archive).some(path => path.split(/[\\/]/).includes(".tmp")));
    fs.writeFileSync("dist/linux-arm64-unpacked/resources/local-build-provenance.json", JSON.stringify({
      version: process.env.ORCA_LOCAL_BUILD_VERSION,
      sourceCommit: process.env.ORCA_LOCAL_BUILD_SOURCE_COMMIT,
      snapshotCommit: process.env.ORCA_LOCAL_BUILD_SNAPSHOT_COMMIT,
      snapshotTree: process.env.ORCA_LOCAL_BUILD_SNAPSHOT_TREE,
      platform: process.platform, arch: process.arch,
      node: process.versions.node, containerEngine: "podman",
      packagedMetadataSha256: crypto.createHash("sha256").update(metadata).digest("hex")
    }, null, 2) + "\n");
  '
  tar -C dist --transform "s|^linux-arm64-unpacked|$name|" -czf "$artifact" linux-arm64-unpacked
  (cd "$work/artifacts" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
  cp dist/linux-arm64-unpacked/resources/local-build-provenance.json "$artifact.build.json"
  printf '%s\n' "$name" > "$work/artifacts/latest-artifact"
  log "artifact: $artifact"
}

if [[ "${BASH_SOURCE[0]:-$0}" = "$0" ]]; then
  mode="${1:?usage: build-linux-arm64-local.sh host|javascript|package|validate|sync}"
  case "$mode" in
    validate)
      work="${2:?missing work root}"
      validate_staging_paths "$work" "${3:?missing source}"
      ;;
    sync)
      work="${2:?missing work root}"
      sync_source "${3:?missing source}" "${4:?missing base}" "${5:?missing snapshot}" "${6:-0}"
      ;;
    host) run_host ;;
    javascript|package)
      [ "$work" = /work ] || { reject 'Container work root must be /work'; exit 1; }
      validate_checkout_paths "$work"
      "run_$mode"
      ;;
    *) reject "unknown mode: $mode"; exit 2 ;;
  esac
fi
