# Restore original IPv6 behavior

> **For agentic workers:** Use superpowers:executing-plans for this user-directed rollback.

**Goal:** Cancel the unshipped IPv6 switch and restore the published #14 network wizard while completing the homepage/date release.

**Architecture:** Restore the two wizard/planner files from 7277393; their complete intervening changes belong to the cancelled IPv6 feature. Keep the independently verified procd fix, DNS/rollback readiness checks, upgrade retention checks, homepage and date metadata.

**Tech Stack:** LuCI JavaScript, ucode, shell/Python VM tests, GitHub Actions.

**Spec:** User correction on 2026-11-10: “IPV6不用了，这部分和原来一样吧”; supersedes the IPv6 sections of ../specs/2026-11-09-home-ipv6-release.md.

## Global Constraints
- No real-router flash/reboot; preserve 25.12.2, x86/64 EFI SquashFS and 32/1024 MiB layout.
- No new IPv6 toggle, mode-switch IPv6 policy, or related custom-port restriction; use the published wizard behavior.
- Keep homepage redesign, full MeowX and installed ZeroTier; publish only after final-image checks.
- After publication/validation, retain local diagnostic evidence and remove all completed non-success Actions runs as explicitly requested.

## Review Focus
- Role changes must no longer require an IPv6 choice.
- Neither stale toggle values nor normal wizard edits may add the cancelled IPv6 policy.
- Five original role/protocol combinations must still apply/rollback with working DNS.
- Final release notes must remove cancelled feature claims.
- Upgrade and service fixes must remain intact.

### Task 1: Restore the published wizard
- [x] Replace superseded switch tests with role-change/unchanged-policy and UI regressions; observe failure.
- [x] Restore johnny-model.js and johnny-network.js from 7277393; restore five network-test-plans cases and remove toggle-specific guest branches.
- [x] Run the complete source/transport regression suite and full serial source-overlay smoke on the saved clean r2 image; review the diff.

### Task 2: Release and evidence
- [x] Update spec/release notes/maintenance to the final scope; preserve the cancelled run's artifact.
- [x] Run the guarded clean build, final functionality, four retained upgrades, ISO checks and publication.
- [x] Verify public assets and intended router's native updater without flashing; then clean completed non-success Actions runs and report supported upgrade paths.

Evidence: four RED cases before rollback; Node 92/92, Python 43/43 and Ubuntu shell checks passed in #17. Final clean image passed full serial smoke with five scenarios/13 DNS replies/two startup-signal checks. Four actual retained upgrades passed on that unchanged image, with all eight snapshots checked against their original baselines. Three production/fixture files remain byte-identical to #14. Release 439840845 is public/latest with five downloaded and hash-verified assets; the intended router's unchanged native updater reached ready with the same image hash and unchanged boot ID. No real-router flash/reboot occurred. API inventory after cleanup: 15 success runs, zero other runs. See MAINTENANCE.md for original evidence hashes and publication details.
