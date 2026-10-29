# Console Network and Theme Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove custom CSS, restore a familiar console network command, fix verified bundled-theme defects and publish a tested new firmware.
**Architecture:** Native UCI shell menu and existing LuCI view styles. Use each installed theme's resolved appearance; no new background service or independent theme preference.
**Tech Stack:** BusyBox sh/awk, UCI, ucode, LuCI JavaScript/CSS, Python/QEMU, GitHub Actions.
**Spec:** docs/superpowers/specs/2026-10-29-console-network.md

## Global Constraints
- main is explicitly authorized; keep the current checkout and its task edits.
- x86/64 EFI SquashFS, 32 MiB boot, 1024 MiB root; stable ImmortalWrt, Docker=no.
- Preserve all existing functional/retention gates and original baseline; never flash the user router.
- Remove custom CSS feature, preserve ordinary installed themes and native appearance choices.

## Review Focus
- EOF/cancel/invalid address or global pending changes must never commit partial configuration.
- Static IP and DHCP changes must preserve unrelated network/service options; DHCP must not advertise a competing server.
- New quickstart command must not trigger old QuickStart daemon initialization checks.
- Manual light mode against a dark OS must remain light in each supported theme.
- Retained old custom CSS and desktop/mobile theme entries must no longer load or interfere.

### Task 1: Remove custom CSS and check bundled themes
Files: build25.sh, johnny-menu.json, johnny-ui-layout.uc, johnny.css, preview harness, relevant UI/boot/retention tests. Delete obsolete editor/loader/ACL/tests.
Interface: existing three custom views remain; native theme controls unchanged.
- [x] Run absence regression against the old loader and record failure.
- [x] Remove feature wiring and obsolete CSS assertions; add absence checks to the guest smoke test.
- [x] Inspect installed theme appearance signals and actual UI; add regressions for any reproduced defects, then fix their scoped styles/resolver.
- [x] Run Node, guest layout and desktop/mobile contrast checks; record results.

### Task 2: Console network command
Files: new quickstart shell script, test-quickstart.sh; build25.sh/banner; smoke-test25.py; test-sysupgrade.py/test-upgrade-readiness.py.
Interface: `quickstart` interactive stdin; view/modify LAN only; native UCI and reload_config.
- [x] Add isolated real-UCI tests for valid static/DHCP, cancel/EOF, invalid IP/mask/gateway/DNS, pending changes and unrelated setting preservation; observe failure before implementation.
- [x] Implement confirmed static/DHCP changes, safe staging and detached reload; install executable and login hint.
- [x] Install the new command at /usr/bin/quickstart; keep historical /usr/sbin/quickstart detection unchanged and require the new command in new-image smoke/upgrade checks.
- [x] Pass guest tests; use SSH to change to 192.168.0.1, authenticate at the new address, reboot and confirm persistence, then exercise DHCP.

### Task 3: Release verification
Files: workflow, MAINTENANCE.md and release notes.
- [x] Run complete source/LF/serial-input checks and fresh code review; fix confirmed findings with regressions.
- [ ] Record pre-build evidence and push main; dispatch one formal build.
- [ ] Verify final full tests, retained baseline evidence, ISO installation and management-address changes in disposable VM.
- [ ] Publish/verify five public assets, SHA256, manifest/source/partitions and ISO embedded-image equality; document actual boundaries and deliver links.

### Task 1 scope update (explicit user request)
Keep johnny-theme.js/menu as unified installed-theme/appearance settings, replace the CSS editor and its ACL with UCI luci/argon permissions. Reuse guarded official Argon view as a baseclass module in a modal (no independent view initialization), hide its separate menu. Add tests for installed choices, per-theme mode mapping, read-only controls and failure handling. Argon header publishes its resolved light/dark state for the shared page palette. Recheck all three bundled themes before compilation.
