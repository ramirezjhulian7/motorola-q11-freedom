# Operations: persistence, reset and recovery

A practical guide to keeping Q11 Freedom nodes under control and to handling
the usual risk scenarios: reboots, factory resets, Minim services coming back,
managing slaves, and recovering WiFi. See [HARDWARE.md](HARDWARE.md) for the
reasons behind each behavior.

## Persistence across reboots

Everything Q11 Freedom installs lives on the writable overlay, so it survives
reboots and power cuts:

| What | Where |
|---|---|
| Web app | `/www/app` |
| API (CGI) | `/www/cgi-bin/freedom-api.sh` |
| Router scripts | `/usr/sbin/freedom-*.sh` |
| Init scripts | `/etc/init.d/freedom-boot`, `freedom-led`, `freedom-qos`, `freedom-wet` |
| DHCP name hook | `/etc/hotplug.d/dhcp/50-freedom-names` |
| Own config (role, mesh key, node and device names, speed limits, blocks) | `/etc/config/freedom` (uci) |
| Remembered DHCP hostnames | `/etc/freedom-hosts` |
| SSID, WiFi key, channel | `nvram` and `/etc/config/wireless` |
| LAN/WAN/DHCP settings, static leases | `/etc/config/network`, `/etc/config/dhcp` |

The SSH access opened with the Minim backdoor is **not** persistent by itself:
`start_sshd` only lasts until the next reboot. To make the node's state
deterministic after every boot, `provision.sh` installs a **boot guardian**,
`/etc/init.d/freedom-boot` (START=99, enabled). On every boot it idempotently:

1. Enables Dropbear (SSH) and starts it if it is not running.
2. Makes sure uhttpd listens on ports 80 and 8080 on all interfaces.
3. Disables and stops the Minim/MotoSync services (`unum`, `unum-support`,
   `unum-updater`, `minim_inits`).
4. Disables and stops `ttyd` (unauthenticated root web shell).
5. Enables and restarts the status LED daemon (`freedom-led`).
6. Re-applies the node role (master or slave) with `freedom-role.sh`, so a power
   cut never changes DHCP, STP or bridge settings.
7. Rebuilds the per-device internet blocks (`freedom-fw.sh`) and makes sure
   they are hooked into `/etc/firewall.user`, so they survive firewall reloads.

Speed limits are re-applied at boot by `/etc/init.d/freedom-qos`, and the
optional WiFi backhaul by `/etc/init.d/freedom-wet`.

To re-install or update the router files on a node without a full provisioning
run:

```sh
bash scripts/deploy-router-files.sh 192.168.50.1 '<root-password>'
bash scripts/deploy-spa.sh          192.168.50.1 '<root-password>'
```

## SSH after a reboot

Dropbear is unreliable on this firmware after a reboot: it may come up about
80 s after boot or not at all, even though the boot guardian enables it. This is
expected and does not affect normal use:

- The web app and the API are served by uhttpd, which is up a few seconds after
  boot. Every normal operation (WiFi, network, devices, mesh, reboot) goes
  through the web app.
- SSH is only needed for maintenance (deploying updates, backups). If it does
  not answer, wait a couple of minutes; if it still does not answer, open it
  again with the Minim backdoor (`.../admin/minim/web_admin` and then
  `.../admin/minim/start_sshd`, see [HARDWARE.md](HARDWARE.md)), using the
  node's current root password.

## What a factory reset erases

A factory reset restores the OEM overlay, so **everything added by Q11 Freedom
is removed**:

- Removed: the web app (`/www/app`), the CGI, the `freedom-*` scripts and init
  scripts, every uci and nvram change, and the root password you set.
- Restored: the original Minim firmware configuration, the factory SSID and WiFi
  key, the label password, LAN IP `192.168.1.1`, and the Minim services
  **enabled again**.

A reset is not dangerous: the node ends up exactly as it came out of the box,
and the WiFi calibration data is not touched (nothing in this project ever
writes to flash partitions). To bring the node back under Q11 Freedom:

1. Connect a computer to the node alone (it is at `192.168.1.1` again).
2. Open SSH with the Minim backdoor and the label password.
3. Optionally back it up: `bash scripts/backup-node.sh 192.168.1.1 '<label-password>'`.
4. Provision it again with the same role and IP it had:

   ```sh
   # master
   bash scripts/provision.sh 192.168.1.1 '<label-password>' --role master --lan-ip 192.168.50.1
   # slave
   bash scripts/provision.sh 192.168.1.1 '<label-password>' --role slave --lan-ip 192.168.50.2
   ```

5. Change the root password from the web app (System).
6. If the node was a slave: on the master, remove its old entry first (adoption
   refuses an IP that is already registered), then add it again from the mesh
   view (`discover` / `adopt_node`) and let it sync.

If the **master** is reset, its `/etc/config/freedom` (including the mesh key
and the list of slaves) is gone. Provision it again and re-adopt each slave from
the mesh view; the new mesh key replaces the old one on each slave when it
joins.

## If Minim services come back

There are two cases:

- **A Minim service comes back after a reboot, without a reset.** The boot
  guardian disables and stops `unum*` and `minim_inits` on every boot, so this
  should not happen. If one does start, disable it by hand; nothing else is
  affected, since the web app, CGI and config stay on disk:

  ```sh
  /etc/init.d/unum disable && /etc/init.d/unum stop
  ```

- **Minim is fully back because of a factory reset.** Follow the reset procedure
  above. The backdoor and provisioning work the same way as the first time, as
  long as the OEM firmware keeps the Minim management page.

Nothing Q11 Freedom does is one-way: you can always take control again, or go
back to stock with a factory reset.

## What the master can and cannot do on slaves

The master talks to each slave's API over HTTPS inside the LAN, authenticated
with the shared mesh key it hands over when the slave is adopted.

| Action on slaves | From the master? |
|---|---|
| Sync WiFi SSID and key (the slave reboots if they changed) | Yes, automatically when WiFi changes on the master, or with "sync" |
| Sync the root password (password hash) | Yes, when the password is changed on the master |
| Update the master IP a slave uses as gateway/DNS | Yes, during sync or a LAN IP change within the same /24 |
| Read status, connected clients and system log | Yes |
| Reboot a slave | Yes |
| Change WiFi channel | No, each node keeps its own channel (auto by default) |
| Update the web app, CGI or router scripts | Not from the master: run `scripts/deploy-spa.sh` and `scripts/deploy-router-files.sh` against each node from a computer |
| Flash a different firmware image | **No.** This device is never flashed; see [HARDWARE.md](HARDWARE.md) |

A slave's own web app is read-only by design: all configuration is done on the
master.

## Recovering WiFi when the BSS goes down

If a radio stops broadcasting (for example after experimenting with
`hostapd_cli` or live `wl` commands), do not try to repair it in place. Reboot
the node; the firmware regenerates radios, hostapd and the BSS from `nvram`:

```sh
ubus call system reboot
```

The same reboot can be triggered from the web app (System on the node itself, or
the node reboot action in the master's mesh view). If the WiFi settings in `nvram` themselves
are wrong, fix them from the web app (WiFi page) on a wired connection; the node
reboots and applies them.

## Backups

Before touching a node, back up its configuration:

```sh
bash scripts/backup-node.sh 192.168.50.1 '<root-password>' master
```

This copies `/etc/config`, Dropbear keys, `passwd`/`shadow`, the MTD layout,
system info and WiFi nvram values to `backups/<label>/`. The `backups/`
directory is git-ignored because it contains secrets.
