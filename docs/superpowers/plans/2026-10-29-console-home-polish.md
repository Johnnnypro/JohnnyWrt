# Console and homepage polish implementation plan

> **For agentic workers:** Use the approved requirements below; implement and verify each task before building.

**Goal:** Ship the approved English console menu and compact MeowX toolbar, and verify the existing ZeroTier setup flow.

**Architecture:** Keep native UCI validation and the existing subscription RPC. Limit UI changes to the subscription row and switch alignment. No homepage update indicator or new version polling.

**Tech Stack:** BusyBox shell/UCI, LuCI JavaScript/CSS, Node tests, Chromium layout checks, QEMU firmware tests, GitHub Actions.

**Spec:** User-approved conversation: menu options 1=view, 2=static settings, 3=exit; blank mask=255.255.255.0, blank DNS=223.5.5.5; compact subscription name with room for ordinary names, account separated by a divider and smaller labeled update action.

## Global constraints

- All console prompts are ASCII English; IP and gateway have no implicit previous value.
- Preserve explicit values, confirmation, invalid-input rejection, pending-change safeguards and unrelated settings.
- Keep web DHCP controls and existing upgrade/network safeguards.
- Do not add the canceled update red dot or version polling.
- Use stable ImmortalWrt 25.12.2, x86/64 EFI SquashFS, 1024 MiB rootfs, Docker=no.
- Verify ZeroTier only; do not change the user's controller or flash real routers.

## Review focus

- Blank defaults differ from previously saved values: test fixed mask/DNS defaults.
- Exit/cancel/EOF: assert byte-identical network and DHCP configuration.
- Long subscription names and account failure: verify visible full name via native options/title, no horizontal page overflow.
- Theme button styles and zoom: test actual switch pseudo-element bounds on/off and disabled.
- ZeroTier authorization does not supply LAN managed routes: report controller and client-routing prerequisites accurately.

## Tasks

1. Console: update `x86-64/test-quickstart.sh`, then `quickstart` and the `build25.sh` login hint. Validate real UCI behavior in a disposable guest, shell syntax and ASCII output.
2. Homepage: add browser layout regression; update `johnny-home.js`/`johnny.css` with the compact row and small labeled refresh action. Retain native select and full-name title. Verify desktop/mobile, long names, dark/light, normal and enlarged display, plus existing Node action tests.
3. ZeroTier: inspect join/start, interface/firewall/hotplug, managed routes, NAT and retention tests. Run existing smoke checks; report what is automatic and what requires controller/client setup.
4. Release: update README/release notes/maintenance evidence, run local preflight and independent review, then build and require all final-image smoke, SSH, retained-settings upgrades and ISO checks. Verify published artifact hashes and report links.

## Execution record

- Existing isolated clone uses branch `fix/console-and-service-switch` from `6c32314`.
- Switch regression reproduced Aurora's centered pseudo-element before the fix; explicit left alignment passed 32 geometry cases.
- Release build #10 (40826456090), source `5964794`, passed the complete firmware, SSH, old-to-new/new-to-new retention and ISO checks. All five public assets match GitHub digests and the checksum file; the upgrade image matches the CI artifact, and both upgrade rounds match the original retention baseline. Full hashes and limitations are recorded in `MAINTENANCE.md`.
- Earlier #6/#7 NAT investigation and successful saved-image CI diagnosis remain documented; no claim that the historical intermittent cause was fixed.
- Official stable release directory rechecked on 2026-10-29: latest stable is 25.12.2.
