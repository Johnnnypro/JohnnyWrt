# MeowX retention and ZeroTier removal

**Goal:** Preserve all three whitelist tools and existing MeowX/Mesh settings, remove ZeroTier from firmware, and build only after saved-image preflight.

**Scope approved in chat:** po0/GGY/AkileCDN preservation, current signed OpenWrt MeowX packages, complete ZeroTier removal, and investigate useful Mesh improvements before building. Keep stable 25.12.2, x86/64 EFI SquashFS, 32/1024 MiB partitions, native SSH fix and network wizard unchanged. Never flash the user's router.

**Approach:** Use a firmware-owned keep.d entry, independent of vendor package updates. Prepare and verify the existing router backup list before its first upgrade: backup selection is performed by the old system. Test synthetic secrets only. Remove ZeroTier packages, resources, RPCs and generated network/firewall integration; migrate only its known legacy sections. Preserve unrelated network/firewall bytes where possible and test migration separately from retention. Keep Mesh native authentication and timeout; improve the specific timeout feedback without hiding other errors or claiming the intermittent control-server timeout is fixed.

## Tasks

- [x] Reproduce missing po0 retention, prove all whitelist data survives package reinstall and old/new firmware upgrades; verify that the old system backup list already includes po0 before its first upgrade.
- [x] Remove ZeroTier build/runtime/UI integration, add absence and migration tests, retain all unrelated service/network tests.
- [x] Verify Mesh timeout presentation against upstream source, patch only the observed timeout path and test healthy recovery versus incomplete application.
- [x] Run all source tests and complete saved-release serial boot/function plus legacy/latest upgrade preflight in GitHub Actions before building.
- [x] Build clean firmware, test final image boot/function, both upgrade chains, exact package versions and ISO contents. Review changes and deliver verified artifacts with accurate first-upgrade instructions.

## Evidence and decisions

- Initial clean baseline: 92 Node tests and SSH/customization/feed shell tests pass locally.
- Signed vendor index currently remains MeowX/LuCI 0.3.4-r1 and core 0.5.0-r1. Recheck before build; do not invent newer OpenWrt versions from the desktop app.
- Live incident: original tailscaled PID retried control HTTPS until 10:30:17 authorization success and 10:30:21 Running. Another enable reached Running 10:34:06. No proof that firmware caused the network timeout; do not alter authentication, disable IPv6 or extend deadlines to conceal it.
- Current machine has bundled Python and Git shell; full Linux/VM checks run in Actions. Local shell tests are useful but do not replace Linux verification.

- Completed: full preflight 42748028072 and final build 42750096011 passed. Release Johnnywrt-ISO-25.12.2-1794282034, source 082377b3c372ca1d2f8b81405b6fe7f6e21d159f. Both upgrade chains and native whitelist backup checks passed; public asset hashes match. The live router downloaded and validated this exact release without flashing. Failed runs were archived locally then removed as requested.
