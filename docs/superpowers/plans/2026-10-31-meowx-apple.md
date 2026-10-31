# MeowX update and Apple dashboard defaults

User approved implementation and firmware build on 2026-10-31. Preserve the existing x86/64 UEFI SquashFS layout and all retention checks. No live-router flashing.

## Design and acceptance

- Use signed official OpenWrt MeowX 0.2.0-r1 and core 0.4.6-r1, verified against the vendor feed before building and the final manifest afterward.
- Bundle Apple `https://captive.apple.com/hotspot-detect.html` as the zashboard latency-test preference. Migrate an absent preference or the upstream Google default once; preserve other explicit preferences and subsequent user choices.
- Keep integration in JohnnyWrt-owned files. The shared LuCI loader decorates MeowX's existing update/open methods; official download still runs normally, then an authenticated local RPC installs the defaults before reporting success/opening the panel. Package updates do not own these files.
- Only the bundled zashboard directory is supported. Reject unexpected dashboard layout without modifying its files; surface failures. Do not alter subscriptions, routing, core binaries or custom dashboard installations.
- Full firmware build retains boot, actual SSH, old-to-new/new-to-new retention and ISO integrity gates.

### Task 1: Persist dashboard preference across official updates

Write behavioral browser preference and LuCI integration tests first. Add a small guarded ucode index patcher and authenticated RPC; integrate it into shared header and first boot. Exercise fresh/Google/custom preferences, repeat execution, download failures, patch failures, and package replacement. Test real current zashboard and official MeowX packages in a disposable guest before compiling.

### Task 2: Verify versions and build prerequisites

Remove conflicting locally bundled MeowX APKs, assert expected vendor versions and final manifest. Add the new regression to existing CI gates. Run all current source checks and full source-overlay guest smoke using CI's serial transport; record exact evidence and review the whole branch independently.

### Task 3: Build and verify release

Push reviewed changes, dispatch the existing release workflow for stable 25.12.2, 1 GiB, no Docker. Monitor until completion. Verify package versions, retention evidence, checksums and ISO embedded image. Preserve older releases and report actual results; diagnose any failure from its original artifact before recompiling.

## Review Focus

LuCI asynchronous module ordering and SPA navigation; non-root ACL behavior; upstream package replacement; unsupported/custom dashboard paths; cached HTML and localStorage migration; runtime ucode behavior; build source and manifest identity. Unit tests alone cannot establish browser ordering or firmware boot compatibility.
