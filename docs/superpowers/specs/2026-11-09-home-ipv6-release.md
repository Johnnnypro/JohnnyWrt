# Johnnywrt 26.11.10

User-approved scope: remove the homepage ZeroTier card; retain the installed service, identity, menus and all MeowX controls. Four system cards above; full MeowX left, traffic and interfaces stacked right, four shortcuts below. Preserve Aurora light/dark and mobile usability.

Add an IPv6 switch to network wizard step 2 with preview and native rollback. Existing settings stay untouched until the switch is used. Main-router enable uses WAN DHCPv6/PD and LAN RA/DHCPv6; bypass enable uses a LAN DHCPv6 client without advertising or requesting delegated prefixes. Disable affects the wizard's LAN/WAN only, not VPN services, kernel-wide settings or other LAN hosts. Custom IPv6 topologies use advanced settings.

Public version: Johnnywrt 26.11.10; future default YY.MM.DD in Asia/Shanghai. Keep the legacy internal tag, underlying ImmortalWrt 25.12.2 metadata, fixed image filename, EFI SquashFS and 32/1024 MiB layout so old updaters accept this release. Add display_version separately. Do not falsify upstream version.

Publish only after source regressions, current signed MeowX packages, disposable-guest preflight, final-image boot, SSH, legacy and latest-release retained upgrades, new-to-new upgrade, ISO embedding and checksums pass. No user-router flash/reboot. Hardware/ISP tests are not implied by VM success.
