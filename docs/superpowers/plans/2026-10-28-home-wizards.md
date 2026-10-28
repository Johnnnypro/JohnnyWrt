# JohnnyWrt Home and Wizards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved independent homepage, network wizard and ZeroTier wizard, then publish a tested GitHub-built firmware.
**Architecture:** LuCI views share small native status/validation helpers; scoped rpcd provides bounded device telemetry and ZeroTier membership operations. Network changes use native UCI staged changes and rollback confirmation. Existing service implementations remain authoritative.
**Tech Stack:** LuCI JavaScript/CSS, rpcd ucode, UCI, shell, Node test runner, Python, QEMU, GitHub Actions.
**Spec:** ../specs/2026-10-28-home-wizards-design.md

## Global Constraints
- Johnnnypro/JohnnyWrt main branch; stable25.12.2, x86/64 EFI/GPT SquashFS, 32MiB boot, 1024MiB root; no Docker in firmware.
- No iStore/QuickStart dependency. Preserve native updater, MeowX, ZeroTier identity, LAN configuration and SSH -z.
- No private site data in source, public outputs or logs. Official logos only.
- ZeroTier authorization instruction exactly: 请自行打开 ZeroTier 授权面板，授权此设备。
- No real-router flashing/reboot. No release deletion. Publish only after required checks pass.

## Review Focus
- Existing multi-network/VLAN/custom-firewall setups must not be silently rewritten by the simple wizard; staged or unsupported topology must produce an actionable refusal.
- Offline MeowX/controller and missing subscription/account must not render fake zero/green or block other cards.
- Read-only sessions and crafted RPC arguments must not mutate configuration or execute arbitrary shell input.
- Existing network ID/identity must remain stable across repeated joins and retained upgrades; route/online states cannot imply complete LAN reachability.
- Disconnection during network apply must use native rollback/confirm; package removal must not loosen old/new readiness checks.

### Task 1: Device API and shared presentation model
**Files:** create x86-64/johnny-dashboard.uc, johnny-dashboard-acl.json, johnny-model.js, test-johnny-model.js, test-dashboard-api.sh.
**Interfaces:** luci.johnny status() returns bounded system/interface/ZeroTier/MeowX telemetry without secrets; join(id) preserves existing memberships; check(id) only probes already known managed route gateways. johnny.model derives subscription quota, counter deltas, authorization state and validated network plans.
- [x] Write/observe failing behavior tests for unknown quota, reset counters, unauthorized/missing address, invalid/duplicate ports, noncontiguous masks, incomplete PPPoE and WAN/LAN overlap.
- [x] Implement bounded API, least-privilege ACLs and pure derivations; reject malformed IDs and pending changes before writes.
- [x] Run Node and real ucode tests in disposable Linux/OpenWrt environment; verify no tokens returned and repeated join preserves existing fields/identity.
- [x] Commit passing task.

### Task 2: Native homepage and service wizard
**Files:** create johnny-home.js, johnny-zerotier.js, johnny.css, johnny-menu.json, test-johnny-ui.js; add official ZeroTier asset.
**Interfaces:** consume luci.johnny and johnny.model; use existing tools.meowx functions for service/profile operations and panel URL.
- [x] Add failing UI tests for absent services/accounts, RPC rejection, write permission, authorization polling and failure controls.
- [x] Implement approved cards, live counter charts, current subscription/account, service actions and ZeroTier three-stage wizard with automatic reading of routes.
- [x] Verify actual view rendering and native controls with production LuCI resources in a disposable browser/guest; no fabricated telemetry.
- [x] Run all UI/model tests and commit.

### Task 3: Independent network wizard
**Files:** create johnny-network.js and network mutation tests in test-johnny-ui.js/model tests.
**Interfaces:** model creates validated network/DHCP/firewall edits; LuCI uci.save and ui.changes.apply(true) provide native session rollback and reconnect behavior.
- [x] Add failing tests for same-port WAN/LAN, static address/netmask/gateway, missing PPPoE credentials, existing pending changes, unsupported topology and rollback handoff.
- [x] Implement role, ports, addressing, preview steps. Preserve unrelated firewall rules and ZeroTier/MeowX state; reuse native network devices and original advanced page.
- [x] Test static and DHCP bypass plus primary DHCP/static/PPPoE plan generation; exercise apply/confirm and unconfirmed rollback in disposable guest.
- [x] Commit passing task.

### Task 4: Integrate packages, boot migration and release gates
**Files:** build25.sh, 99-zz-bypass, 99-zzz-johnnywrt, johnny-ui-layout.uc, test-ui-layout.sh, smoke-test25.py, test-sysupgrade.py, test-upgrade-readiness.py, workflow, AGENTS.md, MAINTENANCE.md.
**Interfaces:** install created resources/API/ACLs, homepage/menu priority, ZeroTier wizard child. Remove QuickStart package/build/API checks and replace with actual independent functionality checks.
- [x] Add failing readiness test that new firmware without QuickStart is ready only with live LAN and no pending configuration; retain old QuickStart initialization regression.
- [x] Remove selected iStore/QuickStart packages and fail manifest gate if transitively reintroduced; preserve existing network/identity on retained upgrades and clear obsolete LuCI routing caches.
- [x] Add syntax/LF/schema/component preflight before build; keep UEFI/BIOS/SSH/retention/module/ISO checks. Smoke new pages/API and isolated network rollback.
- [x] Run complete appropriate local/preflight suite and fresh whole-branch review. Fix blocking findings and record evidence.
- [ ] Publish source on JohnnyWrt main, verify remote bytes, dispatch GitHub workflow, follow to completion. Diagnose failures from evidence and repair, never bypass gate.
- [ ] Verify five public assets/digests/source and run authorized real-device nonflashing validation. Record actual results in maintenance notes and deliver release.
