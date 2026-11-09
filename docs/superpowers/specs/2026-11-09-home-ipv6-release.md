# Johnnywrt 26.11.10

User-approved scope: remove the homepage ZeroTier card; retain the installed service, identity, menus and all MeowX controls. Four system cards above; full MeowX left, traffic and interfaces stacked right, four shortcuts below. Preserve Aurora light/dark and mobile usability.

Add an IPv6 switch to network wizard step 2 with preview and native rollback. Existing settings stay untouched for same-role edits until the switch is used. Changing role carries the detected switch state into an explicit IPv6 plan shown in preview. Main-router enable uses WAN DHCPv6/PD and LAN RA/DHCPv6; bypass enable uses a LAN DHCPv6 client without advertising or requesting delegated prefixes. Disable affects the wizard's LAN/WAN only, not VPN services, kernel-wide settings or other LAN hosts. Custom IPv6 topologies use advanced settings.

Public version: Johnnywrt 26.11.10; future default YY.MM.DD in Asia/Shanghai. Keep the legacy internal tag, underlying ImmortalWrt 25.12.2 metadata, fixed image filename, EFI SquashFS and 32/1024 MiB layout so old updaters accept this release. Add display_version separately. Do not falsify upstream version.

Stable netifd cbb83a18 loses an unchanged explicit physical-device IPv6 disable when a port leaves a bridge. The wizard rejects that exact transition before staging UCI: target WAN is a current bridge member with an explicit device IPv6=0 and the user has not explicitly selected IPv6 on. Other topologies continue through native apply/rollback. This is a disclosed unsupported custom topology, not a claim that the underlying daemon defect is fixed.

Publish only after source regressions, current signed MeowX packages, disposable-guest preflight, final-image boot, SSH, legacy and latest-release retained upgrades, new-to-new upgrade, ISO embedding and checksums pass. No user-router flash/reboot. Hardware/ISP tests are not implied by VM success.
