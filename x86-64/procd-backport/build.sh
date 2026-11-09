#!/bin/bash
# Build only the stable procd package with the documented upstream backport.
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
build_dir=$(realpath "$1")
output_dir=$(realpath -m "$2")
cd "$build_dir"
sdk=immortalwrt-sdk-25.12.2-x86-64_gcc-14.3.0_musl.Linux-x86_64
curl -fL --connect-timeout 20 --max-time 600 \
  "https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/$sdk.tar.zst" -o sdk.tar.zst
echo '4d4631f134c2f27215a91aa7ef5bf9a01ea96c2450d3b8a5c38048c32462ac60  sdk.tar.zst' | sha256sum -c -
tar --zstd -xf sdk.tar.zst
cd "$sdk"
mkdir -p "$output_dir/keys"
compiler=$(find staging_dir/toolchain-* -path '*/bin/x86_64-openwrt-linux-musl-gcc' -print -quit)
test -n "$compiler"
STAGING_DIR="$PWD/staging_dir" "$compiler" -static -Os -Wall -Wextra -Werror \
  "$source_dir/test-startup-signal.c" -o "$output_dir/test-startup-signal"
# Use the SDK's immutable base feed, including matching dependency recipes.
grep -Fx 'src-git --root=package base https://github.com/immortalwrt/immortalwrt.git^4fc16f2985a358bd43bb522e43f05395fcbd6ed5' feeds.conf.default > feeds.conf
./scripts/feeds update base
test "$(git -C feeds/base_root rev-parse HEAD)" = 4fc16f2985a358bd43bb522e43f05395fcbd6ed5
./scripts/feeds install -p base procd procd-ujail procd-seccomp
recipe=feeds/base/system/procd
grep -Fx 'PKG_SOURCE_VERSION:=58eb263d5abe03f8c1280bdfa65a3b052614215d' "$recipe/Makefile"
grep -Fx 'PKG_RELEASE:=1' "$recipe/Makefile"
sed -i 's/^PKG_RELEASE:=1$/PKG_RELEASE:=2/' "$recipe/Makefile"
mkdir -p "$recipe/patches"
cp "$source_dir/100-johnny-ujail-startup-signals.patch" "$recipe/patches/"
cat > .config <<'CONFIG'
CONFIG_ALL_NONSHARED=n
CONFIG_ALL_KMODS=n
CONFIG_ALL=n
CONFIG_PACKAGE_procd=m
CONFIG_PACKAGE_procd-ujail=m
CONFIG_PACKAGE_procd-seccomp=m
CONFIG_SIGNED_PACKAGES=y
CONFIG
make defconfig
make -j2 package/feeds/base/procd/compile V=s
for package in procd procd-ujail procd-seccomp; do
  mapfile -t matches < <(find bin -name "$package-2026.03.13~58eb263d-r2.apk")
  test "${#matches[@]}" = 1
  cp "${matches[0]}" "$output_dir/"
done
# A signed local index authenticates the exact package hashes. Never export keys.
openssl ecparam -name prime256v1 -genkey -noout -out johnny-procd-private.pem
openssl ec -in johnny-procd-private.pem -pubout -out "$output_dir/keys/johnny-procd.pem"
sdk_dir=$PWD
(cd "$output_dir" && "$sdk_dir/staging_dir/host/bin/apk" mkndx --allow-untrusted \
  --sign "$sdk_dir/johnny-procd-private.pem" --output packages.adb ./*.apk)
staging_dir/host/bin/apk adbdump --format json "$output_dir/packages.adb" > "$output_dir/index.json"
cp "$source_dir/100-johnny-ujail-startup-signals.patch" "$output_dir/"
printf '%s\n' "${GITHUB_SHA:-local}" > "$output_dir/source-revision"
(cd "$output_dir" && sha256sum *.apk packages.adb keys/johnny-procd.pem test-startup-signal \
  100-johnny-ujail-startup-signals.patch source-revision > SHA256SUMS)
