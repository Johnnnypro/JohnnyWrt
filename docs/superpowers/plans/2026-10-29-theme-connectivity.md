# Theme and Manual Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship readable custom LuCI pages and truthful manual ZeroTier TCP checks in verified firmware.

**Architecture:** Shared CSS follows Aurora's resolved theme. A shared LuCI helper stores per-network browser test preferences/results, while a bounded authenticated ucode method checks actual routing and TCP connectivity.

**Tech Stack:** LuCI JavaScript, CSS, rpcd/ucode, Node tests, QEMU, GitHub Actions ImageBuilder.

**Spec:** docs/superpowers/specs/2026-10-29-theme-connectivity.md

## Global Constraints

- Stable ImmortalWrt 25.12.2, EFI SquashFS, 1024 MiB rootfs, Docker=no.
- No deployed-router flash, reboot, config edits or private data in the repository.
- Manual probes only; TCP attempt timeout 5000 ms. Historical result labels, no claim of two-way host connectivity.
- Keep all existing CI boot, actual SSH and retained-settings upgrade gates.

## Review Focus

- Wrong-network routes and local/loopback targets cannot produce ZeroTier success (Task 1).
- Target edits, boot changes and a failed status refresh cannot leave misleading success (Task 2).
- Read-only users and overlapping clicks cannot send active or duplicate probes (Task 2).
- OS dark plus explicit light, and OS light plus explicit dark, must keep readable controls (Task 3).
- Missing subscriptions, long IPv6 values and narrow screens must not overflow (Tasks 2/3).

### Task 1: Bounded socket probe

**Files:** create x86-64/johnny-probe.uc and its guest tests; modify johnny-dashboard.uc, johnny-dashboard-acl.json, build25.sh and smoke-test25.py.
**Interfaces:** rpc `luci.johnny.probe({id,ip,port})` returns target, outcome, timestamp, elapsed_ms, device; status/check provide boot context. Invalid requests return an error without connecting.

- [x] Write and run failing guest tests for malformed inputs, wrong interface, reachable/refused TCP and bounded timeout.
- [x] Implement numeric IP/port validation, actual route/device matching, bounded socket connect, no application data; wire write-only RPC and required socket package.
- [x] Run actual guest probe tests and existing source suite; commit.

### Task 2: Manual workflow and historical result

**Files:** create x86-64/johnny-connectivity.js and test-johnny-connectivity.js; modify johnny-zerotier.js, johnny-home.js, test-johnny-ui.js, build25.sh.
**Interfaces:** shared helper reads/saves target/result by network; derives a context key from boot, node/network and routes; renders no current-health claim.

- [x] Write failing tests for no automatic probes, duplicate clicks, read-only mode, target changes, context changes, stored malformed data and request failure.
- [x] Implement accessible IP/port controls, test button and exact historical summaries; update homepage link.
- [x] Run complete Node suite and syntax checks; commit.

### Task 3: Theme and compact layout

**Files:** modify johnny.css and johnny-home.js; add reusable preview/contrast checks for real custom-page DOM with Aurora styles.

- [x] Demonstrate unreadable colors in existing CSS using browser contrast checks before replacing them.
- [x] Define paired theme tokens, remove conflicting OS media rules, fix controls, independent homepage columns, chart series colors/legend and unknown state.
- [x] Verify homepage/network/ZeroTier light and dark at desktop and mobile width; ensure normal text contrast >= 4.5 and no horizontal overflow; run full source suite; commit.

### Task 4: Review, build and release

**Files:** workflow test/dependency/release-note entries, MAINTENANCE.md.

- [x] Review whole diff independently; fix significant findings with regression tests.
- [x] Run script/LF/JS/JSON and existing Python regression checks plus probe/UI checks before build. Recheck main head and upgrade fixtures.
- [ ] Integrate reviewed changes without overwriting concurrent work; launch main workflow with 25.12.2 / 1G / no Docker.
- [ ] Follow final-image UEFI/functions/SSH, BIOS reboot and both retention upgrades, manifest, ISO identity and publication. On failure follow AGENTS.md existing-artifact diagnostics before any fresh build.
- [ ] Verify release assets and metadata; report firmware links and material limits.
