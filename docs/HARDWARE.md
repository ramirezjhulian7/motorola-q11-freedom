# Hardware notes: Motorola Q11 (MH7601 / MH7602 / MH7603)

This document collects what is known about the Motorola Q11 mesh routers as
they behave with their stock firmware, and the findings that shaped the design
of Q11 Freedom. Everything below was verified over SSH on real units.

## Summary

| Item | Value |
|---|---|
| SoC | Broadcom BCM6756 (ARM Cortex-A7) |
| Platform / target | `brcmbca`, board `bcm947622` |
| Firmware | OEM OpenWrt 2.0.1.390 (built by Minim) |
| Kernel | Linux 4.19 (4.19.183) |
| C library | glibc (not musl) |
| Writable storage | `/overlay` (mounted as `/`): 16.8 MB total, about 15.8 MB free |
| Read-only storage | `/rom`, 100% used |
| RAM disk | `/tmp`, about 121 MB, volatile |
| WiFi driver | Broadcom proprietary `wl` (not mac80211) |
| Radios | `wl0` = 2.4 GHz, `wl1` = 5 GHz, `wl1.5` = guest / mesh BSS |

## Do not flash this device

Early community notes sometimes describe the Q11 as a Qualcomm IPQ5018 device
and suggest building and flashing upstream OpenWrt with `sysupgrade`. That is
wrong for these units and **will brick them**:

- The SoC is a Broadcom BCM6756. There is no upstream OpenWrt port for it, and
  the WiFi drivers are closed-source Broadcom binaries.
- The stock firmware is linked against glibc. Standard OpenWrt packages (built
  for musl) and `opkg` feeds are incompatible, and LuCI packages cannot be
  installed.
- The Qualcomm ART/EEPROM backup steps found in generic guides do not apply.

Q11 Freedom therefore **never flashes an image**. It only adds files to the
existing OEM OpenWrt overlay (`/www`, `/usr/sbin`, `/etc/init.d`,
`/etc/config`) and changes configuration through `uci` and `nvram`. A factory
reset returns the device to its stock state.

## Storage budget

The overlay has less than 16 MB free, so everything installed on the router
must be small:

- The web app is built on a computer (the router has no Node.js) and only the
  static files are uploaded to `/www/app`. The budget for the whole bundle is
  2-3 MB, with no heavy images.
- There is no `sqm`, `nlbwmon` or `nftables`, and `opkg` does not work. The
  firmware does provide `tc` (with `htb` and `sfq`), `iptables`, `brctl`,
  `curl`, `jsonfilter`, `px5g` and BusyBox, which is what the router scripts rely
  on.

## Management interfaces available on the stock firmware

- **ubus over HTTP** is enabled at `/ubus` (JSON-RPC, `uhttpd.main.ubus_prefix =
  /ubus`). `session.login` with the root user and password returns a
  `ubus_rpc_session` token (300 s, renewable). Q11 Freedom reuses this login
  instead of implementing its own authentication.
- Reachable ubus objects include `network`, `network.wireless`,
  `network.interface.*`, `dnsmasq`, `iwinfo`, `system`, `uci`, `luci-rpc`,
  `service`, `file`, `log`, plus Broadcom objects such as
  `com.broadcom.wrtwifiagt`, `com.broadcom.wifi_md`, `com.broadcom.devinfo_md`
  and `com.broadcom.FirewallService`.
- **Over HTTP the ubus ACLs are read-only**, even for root: `uci.set` and
  `file.exec` return status 6 (permission denied). This is why writes go through
  a small authenticated CGI (`/cgi-bin/freedom-api.sh`) that validates the same
  ubus session token with `ubus call session get` before doing anything.
- Tools present: `/usr/sbin/wl`, `/bin/nvram`, `/sbin/wifi`, `/sbin/uci`.
  `wl -i wlX assoclist` lists the stations associated to each radio.
- DHCP leases are in `/tmp/dhcp.leases` (standard `timestamp MAC IP hostname
  clientid` format) and through `luci-rpc getDHCPLeases`. They live in RAM and
  are lost on reboot.

## Opening SSH: the Minim backdoor

A factory-fresh unit has no SSH. The stock firmware ships a Minim management
page that can start the SSH daemon. The method was documented by the community
projects [jabeg/motorola-q11-openwrt](https://github.com/jabeg/motorola-q11-openwrt)
and [energy-x/Motorola-MH7601](https://github.com/energy-x/Motorola-MH7601);
credit for it goes to them.

1. Browse to `https://<ip>/cgi-bin/luci/admin/minim/web_admin` and log in as
   `root` with the password printed on the label (accept the self-signed
   certificate).
2. Browse to `https://<ip>/cgi-bin/luci/admin/minim/start_sshd`. An error page
   is expected and normal.
3. SSH is now available: `ssh root@<ip>` with the label password (the old
   Dropbear needs the legacy algorithms listed in `scripts/lib/ssh-common.sh`).

This SSH session is **not persistent**: `start_sshd` only starts the daemon for
the current boot. It is the only step that cannot be automated from
`provision.sh` because it needs a browser. It works as long as the OEM firmware
keeps that page; if a future firmware removes it, another entry point (for
example the serial console) would be needed.

## Unauthenticated surface removed during provisioning

The stock image and earlier community tooling expose a few things that must not
stay on a production router:

- `/www/cgi-bin/router.sh` and `/www/cgi-bin/admin.sh`: CGIs that run commands
  without authentication. Provisioning backs them up to `/data/cgi-backup/` and
  removes them.
- `ttyd`: a root web shell without authentication. Provisioning disables it,
  and the boot guardian keeps it disabled.

## WiFi: nvram plus reboot is the only reliable path

The WiFi stack is Broadcom's proprietary `wl` driver, orchestrated by the
firmware from `nvram`. The usual OpenWrt methods do not work:

| Method | Result |
|---|---|
| `wifi reload` / `wifi` | Fails with `Interface type not supported`. Tools written for mac80211 OpenWrt that rely on it do not apply changes on this chip |
| `uci set wireless...` alone | Ignored by the driver; the broadcast SSID does not change |
| `hostapd_cli disable` / `enable` | Leaves the BSS down (`bss=down`, enable returns FAIL). Never use it |
| `wl -i wlX ssid "..."` | Changes the beacon live, but the WPA key is handled separately by hostapd, so SSID and key become inconsistent and clients get "wrong password" |
| **`nvram set wlX_ssid`, `wlX_wpa_psk`, `wlX_channel`, `nvram commit`, reboot** | **Works.** At boot the firmware regenerates radios, hostapd and BSS consistently from nvram |

Q11 Freedom therefore writes WiFi settings to both `nvram` and `uci` and then
reboots the node (about one minute). The web app warns before every WiFi change
and waits for the node to come back. After the reboot, `get_wifi` reports the
broadcast SSID (`live`) so the change can be confirmed.

## Rebooting from a CGI

- `reboot >/dev/null 2>&1 &` inside a CGI responds but **does not reboot**:
  uhttpd kills the CGI's child processes when the request finishes.
- What works (the node reboots in about 3 s): send the JSON response, run
  `exec >/dev/null 2>&1` so uhttpd releases the connection, and then run
  `ubus call system reboot`. procd performs the reboot independently of the CGI.
  This is how the `reboot`, `set_wifi` and `apply_sync` actions reboot.

## SSH after a reboot

Dropbear does not start reliably after a reboot on this firmware. Sometimes it
comes up very late (around 80 s), sometimes not at all, regardless of enabling
it or restarting it from a late init script. The boot guardian enables it and
starts it if it is missing, but SSH should be treated as a maintenance channel
only. uhttpd is always up a few seconds after boot, and every normal operation
(WiFi, reboot, mesh management) goes through the web app and the CGI. When SSH
is needed and does not answer, re-open it with the Minim backdoor.

## EasyMesh: present but not usable without Minim

The firmware includes Broadcom's complete EasyMesh / Multi-AP stack:
`ieee1905`, `wbd_master`, `wbd_slave`, `bsd` (band steering), `i5ctl`,
`wb_cli`, `mapgetcfg.sh`, and nvram keys such as `multiap_mode` (0 = off,
2 = controller, 1 = agent), `wbd_ifnames`, `map_bss_names`, `map_bh_open`,
`bsd_role`, `bsd_primary` and `bsd_helper`.

It does not run once Minim is disabled. The whole stack depends on Broadcom's
CMS messaging bus (`smd`); `ieee1905` is registered with
`flags=EIF_MESSAGING_CAPABLE`. `smd` has no init script of its own: it was
started by the proprietary management subsystem driven by the Minim agent.
Without it, `ieee1905` crashes with SIGSEGV ("Messaging Not Started") and the
`wbd_*` daemons report "Shutting down 1905". Rebuilding `smd`, its entities and
the CMS start-up sequence would mean re-implementing Broadcom's closed
management stack without sources or documentation, which is not realistic.

## Wireless backhaul

The goal was a slave node that reaches the master over WiFi instead of a cable.
Every standard approach was tried:

| Method | Result |
|---|---|
| Static WDS (`wl wdsX`) | Associates (RSSI -22 to -36 dBm) but no L2 traffic passes (RX = 0). Same with WPA2 and with an open AP, so encryption is not the cause |
| WDS + `wdssec` (nvram + reboot) | Does not even associate after the reboot |
| STA + `wpa_supplicant` (nl80211) | Sees the network, reaches ASSOCIATING and never completes (falls back to SCANNING). `rfkill: Cannot open`: the nl80211 to `wl` integration is incomplete |
| Native `wl join` with WPA2 | Does not associate (`Not associated`); `wl wpa_sup` is unsupported |
| WET + external `wpa_supplicant` | Associates, but the master sends DEAUTH during the 4-way handshake (the external supplicant and the driver fight over key handling) |
| **WET + the driver's internal supplicant** | **Works** |

The root cause of the failures is the same as for EasyMesh: the proprietary
`wl` driver works well as an AP, while the client / WDS / backhaul roles depend
on Broadcom's orchestration layer (wbd, nas, acsd and the `smd` bus), which is
not available without the Minim agent.

### The working combination: WET with the internal supplicant

On the slave, `wl1` (5 GHz) becomes the uplink to the master while `wl0`
(2.4 GHz) keeps serving clients:

```sh
killall acsd2 wlssk openwrt_wifi_agent wpa_supplicant 2>/dev/null
for p in $(pgrep hostapd); do grep -q wl1 /proc/$p/cmdline && kill $p; done
wl -i wl1 down
wl -i wl1 ap 0
wl -i wl1 wet 1             # WET mode (MAC translation in the driver)
wl -i wl1 wsec 4            # AES
wl -i wl1 wpa_auth 0x80     # WPA2-PSK
wl -i wl1 sup_wpa 1         # the driver's INTERNAL supplicant (the key part)
wl -i wl1 set_pmk "<master-wifi-key>"
wl -i wl1 up
wl -i wl1 join "<master-ssid>" imode bss amode wpa2psk
# wait for sup_auth_status = 6, then put wl1 back into br-lan
ip route add default via 192.168.50.1
```

Measured result: association at about -27 dBm RSSI, `sup_auth_status = 6`
(authenticated), 0% packet loss to the master and to the internet over the 5 GHz
link, and real traffic flowing through the master's bridge.

Resulting slave topology: `br-lan` = Ethernet ports + `wl0` + `wl1`, in the same
L2 domain as the master; DHCP server off (the master provides it). While WET is
active `wl1` does not serve clients, so clients use the slave's 2.4 GHz radio or
the master's 5 GHz radio.

This is implemented in `router-files/freedom-wet.sh` and started at boot by
`/etc/init.d/freedom-wet` when `freedom.mesh.uplink_ssid` is set
(`provision.sh --uplink-ssid ... --uplink-key ...`). It is **optional and
experimental**. Known caveats:

- On some boots the slave did not bring up its management IP on `br-lan`, so it
  was unreachable by IP even though L2 traffic flowed. The script now waits for
  authentication before re-adding `wl1` to the bridge and adds the LAN address
  explicitly, but this path has had less testing than the cable model.
- The WET script must not be run over SSH through the link it reconfigures: it
  cuts off the session. It is meant to run from the init script at boot.
- There is no automatic failover between cable and WiFi.

## Cable backhaul: the recommended model

A wired backhaul is a plain L2 bridge and works without any special handling:

- **Master**: runs DHCP and DNS (`dnsmasq`), has a normal WAN toward the
  modem/ISP, and serves the web app.
- **Slaves**: DHCP off, STP on, and the WAN port is moved into the bridge so both
  ports act as LAN (plug the master's cable into either port and use the other
  for a device or to daisy-chain the next node). Gateway and DNS point to the
  master so the slave itself has internet access (for the LED check and NTP).
- All nodes broadcast the same SSID and key, so clients roam between them on
  their own.

Ethernet, powerline or MoCA links all work, since the node only sees an
Ethernet port.

## Status LED

Without Minim, the factory LED script (`/sbin/update_leds.sh`) stays in the
`agent_down` state: blinking blue ("looking for the cloud"). Q11 Freedom stops
that script and runs its own daemon (`freedom-led`):

- Solid green: internet reachable (a ping to 8.8.8.8 or 1.1.1.1 succeeds).
- Solid red: no internet.

The daemon checks every 30 s and only writes the LED when the state changes.
The LEDs (`/sys/class/leds/led_red`, `led_green`, `led_blue`) accept graded
brightness (0-255), so exact colors are possible. The same check result is
written to `/tmp/freedom-internet`, which the API reads for the `internet` field
instead of pinging on every request.
