# Router API: `/cgi-bin/freedom-api.sh`

The Q11 Freedom backend. It runs on every node (master and slaves). Source:
[router-files/freedom-api.sh](../router-files/freedom-api.sh).

## Protocol

- `POST /cgi-bin/freedom-api.sh` with a JSON body
  `{ "token": "<ubus session>", "action": "<action>", ...params }`.
- Response: `{ "ok": true, ... }` or `{ "ok": false, "error": "<English message>" }`.
  Error messages are plain English sentences (or short codes such as `bad mac`)
  and are meant to be shown to the user as-is.
- **Every parameter is sent as a string** (including numbers and flags): the CGI
  only reads string values from the JSON.
- `401` = invalid or expired session; the app must go back to the login screen.
- The token is the `ubus_rpc_session` returned by `session.login` on `/ubus`
  (see `frontend/src/lib/ubus.ts`). It expires after 300 s without use.
- Alternative `mesh_key` authentication: used only by the master to talk to its
  slaves, and it only unlocks `status`, `assoclist`, `apply_sync`, `reboot` and
  `get_log`. The app never uses it.

## Status and logs

| Action | Parameters | Response |
|---|---|---|
| `status` | none | `role` (master/slave), `node_id`, `version`, `hostname`, `lan_ip`, `wan_ip`, `wan_proto`, `uptime` (s), `clients` (WiFi), `internet` (bool), `dhcp` (bool), `ssid`, `psk_hash`, `master_ip`, `last_sync`, `slaves` (count), `pw_changed` (bool), `mac` |
| `get_log` | none | `log` (last 150 lines, `\n`-separated) |
| `isp` | `refresh`? (`"1"` forces a new lookup) | `public_ip`, `asn`, `org`, `isp`, `domain`, `ts`. The router looks up its public IP on ipwho.is (fallback ipinfo.io) because the WAN is usually private (modem/CGNAT). Cached for 6 h in `/tmp/freedom-isp.json`; if the lookup fails, the previous cache is returned |

## Mesh (master only)

| Action | Parameters | Response |
|---|---|---|
| `nodes` | none | `nodes[]`: `id`, `ip`, `role`, `self`, `online`, `uptime`, `clients`, `internet`, `ssid`, `synced` (WiFi matches the master), `version`, `last_sync`, `mac`. A node that is off only has `id`, `ip`, `online:false` |
| `discover` | none | `found[]`: `ip`, `mac`. Q11 Freedom nodes on the LAN that have not been added yet (detected by `Q11 Freedom` in `/app/manifest.webmanifest`) |
| `adopt_node` | `ip`, `password` (slave root password), `name`? | `id` (`node<last octet>`), `sync` |
| `remove_node` | `node_id` | none |
| `sync_nodes` | none | `results[]`: `id`, `result` = `ok` \| `reboot` \| `offline` \| `error` |
| `node_reboot` | `node_id` | none |
| `node_log` | `node_id` | `log` |
| `mesh_clients` | none | `stations[]` for the whole mesh (see below) |

The master has `id` = `master`. A slave must be provisioned before it is added:
`provision.sh <ip> <password> --role slave --lan-ip 192.168.50.N`.

## Clients

| Action | Parameters | Response |
|---|---|---|
| `assoclist` | none | `stations[]` of this node |
| `mesh_clients` | none | `stations[]` of every node |

`station`: `mac` (uppercase), `ip` (from the ARP table, may be empty), `signal`
(dBm, or `null` for cable), `band` (`2.4G`/`5G`/`cable`), `device`, `conn`
(`wifi`/`cable`), `node` (node id).

The same MAC can be reported by several nodes. Priority to decide which node it
belongs to: WiFi > cable reported by a slave > cable reported by the master.

DHCP hostnames come separately, via ubus `luci-rpc getDHCPLeases`. That table
lives in RAM and is wiped on reboot, so a connected device may have no lease
record.

| Action | Response |
|---|---|
| `host_names` | `names`: `{ "<MAC>": "<hostname>" }`. DHCP hostnames the master remembered in `/etc/freedom-hosts` (flash), used to show the name of a device that kept its IP across a reboot. Written by `/etc/hotplug.d/dhcp/50-freedom-names` (dnsmasq notification on every new/renewed lease; only writes when something changes; max 500 entries). Only `[A-Za-z0-9._-]` |

The app identifies each device in `frontend/src/lib/deviceType.ts`: a cleaned-up
DHCP hostname (or a known one: Wyze Cam, Kasa, HP printers...) and, if the device
sends no name, the vendor from its MAC prefix (`ouiData.ts`, generated with
`scripts/gen-oui.py`).

## Devices

| Action | Parameters | Notes |
|---|---|---|
| `set_device_name` | `mac`, `name` | An empty `name` deletes the name |
| `set_speed` | `ip`, `down_kbit` | `0` removes the limit. Persists across reboots |
| `set_block` | `mac`, `blocked` (`"1"`/`"0"`) | Pause internet. Applies to the whole mesh |
| `list_static` | none | `leases[]`: `mac`, `ip`, `name` |
| `set_static` | `mac`, `ip`, `name`? | IP reservation. Must be inside the LAN network |
| `del_static` | `mac` | none |

## Own configuration

| Action | Response |
|---|---|
| `get_config` | `config`: `uci export freedom` text with literal `\n`. Sections: `node_<id>` (`name`, `ip`), `dev_<MAC with _>` (`mac`, `name`), `qos_<ip with _>` (`ip`, `down`), `blk_<MAC with _>` (`mac`), `node` (`role`, `mgmt_ip`, `pw_changed`). Secrets (`key`, `uplink_key`) are stripped |
| `set_node_name` | parameters `node_id`, `name` |

## WiFi

| Action | Parameters | Notes |
|---|---|---|
| `get_wifi` | none | `radios[]`: `device` (wl0 = 2.4G, wl1 = 5G), `ssid`, `channel` (`auto` or a number), `live` (SSID being broadcast), `current` (channel in use) |
| `set_wifi` | `device` (`all`/`wl0`/`wl1`), `ssid`?, `key`? (8-63), `channel`?, `reboot`? (`"0"` = do not reboot) | **Reboots the node** (about 1 min). On the master, SSID and key are first copied to the slaves (`sync[]`). Channels are not copied |

## Network

| Action | Parameters | Notes |
|---|---|---|
| `set_lan` | `ipaddr`, `netmask`? | Drops the connection. With slaves attached, only within the same /24 |
| `set_wan` | `proto` = `dhcp` \| `static` (`ipaddr`, `netmask`?, `gateway`, `dns`? comma-separated) \| `pppoe` (`username`, `password`) | Master only |
| `set_dhcp` | `start`, `limit`, `leasetime`? (e.g. `12h`) | The range cannot go past .254 |

## System

| Action | Parameters | Notes |
|---|---|---|
| `set_password` | `password` (min 8) | On the master it is copied to the slaves |
| `reboot` | none | Responds, then reboots |

## Internal actions (node to node)

| Action | Called by | Notes |
|---|---|---|
| `join_mesh` | master, during `adopt_node` (with a user token obtained from the slave's own login) | Parameters `key`, `master_ip`, `node_id`. Stores the mesh key, sets `role=slave` and applies the role |
| `apply_sync` | master, with `mesh_key` | Parameters `ssid`, `psk`, `shadow`, `master_ip`. Returns `rebooting` (bool); the slave reboots if its WiFi changed |

## Hardware constraints that affect the UI

- Every WiFi change reboots the node. The app must warn the user and wait for it
  to come back.
- On a slave (`status.role = slave`) the app must not allow configuration:
  everything is managed from the master (`status.master_ip`).
- SSID, key and names do not accept single or double quotes, backslash, `$` or
  backtick.
