#!/bin/sh
# Run on an x86/64 EFI SquashFS test guest. All writes are in a scratch folder.
set -e
script=${1:-/usr/libexec/johnny-update}
candidate=${2:-}
expected_repo=${3:-https://github.com/Johnnnypro/JohnnyWrt}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
sed '/^case "${1:-status}" in/,$d' "$script" | sed "s|^work=/tmp/johnny-update$|work=$tmp/state|" > "$tmp/library"
. "$tmp/library"
case "$expected_repo" in
    https://github.com/Johnnnypro/JohnnyWrt|https://github.com/Johnnnnnnnyx/ImmortalWrt-ImageBuilder) ;;
    *) exit 1 ;;
esac
test "$repo" = "$expected_repo"
test "$api" = "https://api.github.com/repos/${expected_repo#https://github.com/}/releases/latest"
latest=Johnnywrt-ISO-25.12.2-100
fixture() {
    printf '{"target":"%s","format":"%s","version":"%s","tag":"%s","rootfs_mb":%s,"display_version":"26.11.10"}\n' \
        "$1" "$2" "$3" "$4" "$5" > "$work/firmware.json"
}
fixture x86/64 squashfs-combined-efi 25.12.2 "$latest" 1024
(validate_metadata)
for invalid in target format version tag size; do
    case "$invalid" in
        target) fixture aarch64 squashfs-combined-efi 25.12.2 "$latest" 1024 ;;
        format) fixture x86/64 ext4-combined-efi 25.12.2 "$latest" 1024 ;;
        version) fixture x86/64 squashfs-combined-efi 26.12.0 "$latest" 1024 ;;
        tag) fixture x86/64 squashfs-combined-efi 25.12.2 wrong 1024 ;;
        size) fixture x86/64 squashfs-combined-efi 25.12.2 "$latest" 2048 ;;
    esac
    if (validate_metadata); then echo "FAIL: accepted invalid $invalid"; exit 1; fi
done
printf test-image > "$work/$image"
printf '%064d  %s\n' 0 "$image" > "$work/SHA256SUMS"
if (verify_image); then echo 'FAIL: accepted corrupt image'; exit 1; fi
if [ -n "$candidate" ]; then
    cp "$candidate" "$work/$image"
    (cd "$work" && sha256sum "$image") > "$work/SHA256SUMS"
    (verify_image)
    echo 'PASS: real firmware hash, full partition map and sysupgrade -T'
fi
fixture x86/64 squashfs-combined-efi 25.12.2 Johnnywrt-ISO-25.12.2-9999999999 1024
cp "$work/firmware.json" "$tmp/candidate.json"
fetch() {
    case "$1" in
        "$api") printf '{"tag_name":"Johnnywrt-ISO-25.12.2-9999999999","name":"Johnnywrt 26.11.10","draft":false,"prerelease":false}' > "$2" ;;
        "$repo/releases/download/Johnnywrt-ISO-25.12.2-9999999999/firmware.json") cp "$tmp/candidate.json" "$2" ;;
        *) return 1 ;;
    esac
}
current=Johnnywrt-ISO-25.12.2-1793414110
check
test "$available" = 1
test "$(jsonfilter -i "$work/status.json" -e '@.state')" = available
echo 'PASS: date-named release remains discoverable by this updater; mismatched target, series, layout and hash rejected'
