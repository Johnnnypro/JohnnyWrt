# Console network settings and theme maintenance

User approved implementation and a new main release on 2026-10-29, then added inspection/fixes for the other bundled themes.

- Remove custom theme/CSS editor, menu, loader, ACL and upgrade inclusion. Keep installed-theme selection and native appearance controls. Old retained CSS may remain as inert user data; it must not load.
- Provide `quickstart` at SSH and local consoles: view LAN, static IPv4/mask/gateway/DNS, DHCP client, exit. This is a small native UCI script, not the former QuickStart package/service. Add a login hint without running a menu automatically.
- Show changes and explicit confirmation before commit. Reject invalid host addresses, masks, gateways, DNS, unsupported LAN configuration and pending global UCI changes. Cancellation/EOF never modifies configuration. Preserve device/ports, WAN, firewall, MeowX, ZeroTier, credentials and IPv6 addresses. DHCP-client selection disables LAN DHCP/RA serving and uses upstream DNS; static selection preserves existing DHCP-server policy.
- Apply asynchronously so SSH disconnect does not abort reload. Print the new address/reconnection instructions before applying. No automatic rollback after a confirmed console edit; local console remains available for recovery.
- Inspect Aurora, Argon and Bootstrap at desktop/390px, their supported light/dark/system modes, homepage/network/ZeroTier and native system/network/update forms. Fix reproduced readability/layout defects only. Normal text target >=4.5:1.
- Test source and disposable guests before formal compilation. Final image must pass full UEFI/functions/SSH, original old→new and new→new retention gates, ISO installation/network change/reboot and public-asset verification. Preserve 32 MiB boot/1024 MiB root, stable release, signed feed, native SSH -z.
- Do not modify, flash or reboot the real router. Existing user authorization covers main push/new release. Visual mockups do not authorize unrelated homepage redesign.

追加用户要求：保留“系统→主题设置”作为统一入口，选择 Aurora/Argon/Bootstrap；统一提供系统/浅色/深色。选中 Argon 时显示详细设置按钮并在弹窗复用完整官方设置，隐藏独立 Argon 菜单。全部预编译检查通过才允许正式构建。
