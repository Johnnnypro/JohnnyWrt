# Homepage Subscription Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the approved single-icon homepage subscription refresh with current usage and readable desktop/mobile layout.
**Architecture:** Reuse native MeowX refresh RPC and its notifications; reload UCI for returned quota. Scope styling to the homepage subscription region.
**Tech Stack:** LuCI JavaScript/CSS, ucode, Node tests, disposable QEMU guest.
**Spec:** docs/superpowers/specs/2026-10-29-subscription-refresh.md

## Global Constraints
- Direct main is explicitly authorized; preserve existing task changes.
- One icon beside the subscription name updates configuration and provider quota; no separate usage refresh.
- No real router changes and no formal build until complete pre-build gates pass.

## Review Focus
- Repeated clicks and polling during the update must not start another update.
- Read-only/local profiles/missing data/pending changes must not reach the mutating RPC.
- Download success with apply failure must not look fully applied.
- Failed requests preserve known values and clear the busy state.
- Long names, unknown quota, dark mode and 390px must remain readable and operable.

### Task 1: Refresh behavior and compact subscription layout
Files: johnny-home.js, johnny.css, johnny-dashboard.uc, test-johnny-ui.js, test-dashboard-api.sh, preview fixture; paths under x86-64/.
Interface: native `refreshSubscription(section_id)` → success/busy/applied/error fields; UCI used_bytes/total_bytes/expire_ts/update_ts.
- [x] Write and run failing regressions for current-section update, UCI redisplay, guards, duplicate calls, failures and apply status.
- [x] Implement one icon, paired loading/result state, native quota refresh and scoped responsive styling; expose pending MeowX status for the pre-action check.
- [x] Run the complete explicit Node suite and syntax/LF checks; fix failures.

### Task 2: Actual integration and release handoff
Files: guest test additions, MAINTENANCE.md and this plan.
Interface: same synthetic subscription endpoint exercised through real guest RPC, no private subscriptions.
- [x] Test valid download/usage/application, invalid download and retained old cache/usage, busy and permissions with actual guest APIs.
- [ ] Check Aurora/Argon/Bootstrap light/dark at desktop and390px, icons/keyboard/focus, long names and unknown values.
- [ ] Record evidence, review only this new change, commit/push main, and continue the existing original-artifact diagnostic and final-release gates.
