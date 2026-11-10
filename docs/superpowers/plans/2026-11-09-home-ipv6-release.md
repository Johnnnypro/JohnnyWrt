# Homepage and date-based release

IPv6 scope superseded by the user on 2026-11-10; execute 2026-11-10-restore-original-ipv6.md. The older steps below record the original plan, not the final feature set.

Spec: ../specs/2026-11-09-home-ipv6-release.md

Global constraints: surgical changes; no ZeroTier uninstall; preserve native rollback, partition layout and legacy update protocol. User authorized implementation and publication after testing. Isolated clone/branch. Read AGENTS.md and complete MAINTENANCE.md before edits (done).

### Task 1: Homepage and IPv6 controls
Files: johnny-home.js, johnny.css, johnny-network.js, johnny-model.js and their existing tests; network-test-plans.js/test-network-apply.uc.
1. Add regression cases for enabled/disabled/unchanged IPv6, main DHCP/static/PPPoE, bypass client, mode changes, readonly preview and advanced topology refusal. Run Node tests: expected new cases fail.
2. Implement the agreed layout and switch with native UCI apply/rollback. Preserve IPv6 unless explicitly selected.
3. Run all Node tests and guest test-input checks: expected pass. Prepare actual-source UI preview; inspect desktop/390px light/dark, switch/preview and complete MeowX controls.
4. Commit implementation and test evidence.

### Task 2: Release metadata and preflight
Files: build workflow, build25.sh, metadata tests, dashboard/updater display, preflight workflow/overlay, meowx-versions.json, docs.
1. Test date validation and backward-compatible metadata using old updater; invalid dates/series rejected. Expected new behavior initially fails.
2. Add public date label without changing internal compatibility tag/system version. Default future dates to Shanghai build date. Include latest #14 upgrade fixture in addition to historical fixture.
3. Pin newly checked signed vendor versions; source overlay preflight on untouched #14 release using identical serial smoke entrypoint, plus retained-upgrade baseline. Expected all gates pass before fresh build.
4. Commit; fresh whole-branch review and fix important findings with regressions.

### Task 3: Final build, verification and publication
1. Publish tested source and dispatch existing guarded build; all checks must finish before release action.
2. Follow build; if failure, record evidence and diagnose original artifact before another compile, per maintenance rules.
3. Validate public assets/metadata/checksums and retained configuration evidence, and report exact supported upgrade path and remaining hardware limits. Record final result in MAINTENANCE.md.

Review Focus: overlooked IPv6 acquisition/RA and PPPoE duplication; custom lan6 handling; untouched saved IPv6 settings; old updater strict tag/metadata parsing; source-vs-final-image verification; missing service controls or mobile overflow.

Confirmed upgrade dependency (2026-11-10): the deployed MeowX Mesh uses a separately installed official Tailscale package, absent from the #14 image. Include that package in the new image and manifest gate. Before building, verify a disposable native machine identity and enabled daemon survive reboot. The final #14-to-new-to-new chain must preserve the same original Tailscale config/state hashes and validate the service without restarting or re-enabling it in assertions. No real control server, account or router flashing is involved.
