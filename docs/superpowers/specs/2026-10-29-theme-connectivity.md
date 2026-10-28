# Theme and manual connectivity design

Approved in the chat on 2026-10-29: improve the existing homepage and shared wizard appearance, add manual ZeroTier IP/port testing, check before building and publish a verified firmware. Do not flash a running router.

## Scope

- Keep Aurora and existing navigation. Use its resolved `html[data-darkmode]` state for all custom surfaces, text, inputs, buttons and charts. Explicit light/dark overrides must work regardless of the OS. Follow-system remains Aurora's responsibility.
- Compact independent homepage columns; no stretched empty service/interface cards. Consistent receive-blue/send-purple colors, readable legend and Chinese unknown interface state. Existing service actions and confirmations remain.
- ZeroTier provides a literal target IP and TCP port, manual Start test button, bounded 5-second TCP connection attempt, result, direction and timestamp. No periodic background probing. Never equate a successful TCP connection with two-way LAN host connectivity.
- Remember target and last result in this browser on this router's origin. Changing the target clears the result. Boot/network context changes make previous results require retesting. Homepage links to the test and labels results as historical.
- Validate input on the backend, require a route through the selected ZeroTier device, and require write permission for active probing. No DNS names, shell expressions, port ranges or application payloads.
- User additions: default follow-system appearance; identify actual ZeroTier devices by network metadata; deliver directly to main and remove the temporary remote branch. Add a "Custom theme" entry beside the theme choices, opening a CSS code editor with save/apply and restore. Keep CSS through settings-preserving upgrades and disable user CSS on the editor to retain a recovery path.

## Approach

Use existing LuCI/rpcd/UCI structure, shared CSS tokens and one small shared browser helper. Use ucode socket support for TCP, with actual socket tests in a disposable firmware guest. A manual status record was chosen over a permanent green switch or recurring monitor because the user approved manual testing with last-result time. Store browser preferences locally to avoid unnecessary persistent router configuration writes.

## Acceptance

Reproduce then fix theme contrast and stale/probe-state cases. Check all three custom pages in both themes and a narrow viewport. Run source/shell/UI regression checks before compilation. The exact final image must pass current CI UEFI functions, real SSH, BIOS reboot, old-to-new/new-to-new retained-settings upgrades, manifest and ISO embedded-image hash gates. Publish ISO, EFI sysupgrade image, SHA256SUMS, manifest and accurate release notes. Preserve stable 25.12.2, 1024 MiB rootfs and all retention/SSH protections.
