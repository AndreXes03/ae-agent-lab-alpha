#!/bin/zsh
set -euo pipefail

temp_dir=""
finish() {
  [[ -z "$temp_dir" ]] || /bin/rm -rf -- "$temp_dir"
  if [[ -t 0 && "${KYNEM_TEST_MODE:-}" != 1 ]]; then
    print
    print "Press Return to close this window."
    read -r || true
  fi
}
trap finish EXIT
fail() { print -u2 "KYNEM install: $*"; exit 1; }
script_dir=${0:A:h}
[[ -f "$script_dir/scripts/install-kynem.mjs" ]] || fail "Installer files are incomplete. Extract the whole ZIP, then open this file again."
if [[ "$OSTYPE" != darwin* && "${KYNEM_TEST_MODE:-}" != 1 ]]; then
  fail "This installer needs macOS."
fi

node_bin=""
for candidate in "${commands[node]:-}" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    major=$(/usr/bin/env "$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)
    if [[ "$major" == <-> && "$major" -ge 24 ]]; then node_bin="$candidate"; break; fi
  fi
done

if [[ -z "$node_bin" ]]; then
  # SHA-256 hashes are from https://nodejs.org/en/blog/release/v24.21.0
  version=24.21.0
  arch=$(/usr/bin/uname -m)
  case "$arch" in
    arm64) expected=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 ;;
    x86_64) arch=x64; expected=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 ;;
    *) fail "Unsupported Mac architecture: $arch" ;;
  esac
  app_support="$HOME/Library/Application Support/KYNEM"
  install_dir="$app_support/node/v$version-$arch"
  node_bin="$install_dir/bin/node"
  if [[ ! -x "$node_bin" ]]; then
    print "Downloading Node.js $version from nodejs.org for this Mac..."
    /bin/mkdir -p "$app_support/node"
    temp_dir=$(/usr/bin/mktemp -d "$app_support/node/.download.XXXXXXXX")
    archive="node-v$version-darwin-$arch.tar.gz"
    /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --output "$temp_dir/$archive" "https://nodejs.org/dist/v$version/$archive" || fail "Node.js download failed. Check your connection and try again."
    actual=$(/usr/bin/shasum -a 256 "$temp_dir/$archive" | /usr/bin/awk '{print $1}')
    [[ "$actual" == "$expected" ]] || fail "Node.js archive checksum did not match the official release."
    /usr/bin/tar -xzf "$temp_dir/$archive" -C "$temp_dir" || fail "Could not unpack Node.js."
    /bin/mv "$temp_dir/node-v$version-darwin-$arch" "$install_dir" || fail "Could not place Node.js in KYNEM support files."
  fi
fi

"$node_bin" "$script_dir/scripts/install-kynem.mjs" "$node_bin"
