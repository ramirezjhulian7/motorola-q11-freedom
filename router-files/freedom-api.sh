#!/bin/sh
# ============================================================================
# Q11 Freedom - authenticated write API (CGI)
# Lives at /www/cgi-bin/freedom-api.sh on EVERY node (master and slaves).
#
# AUTHENTICATION (one of two):
#   1) token    = a valid ubus session (the one the app gets at login).
#   2) mesh_key = shared mesh key (freedom.mesh.key). Used ONLY by the master
#      to talk to its slaves, and it only unlocks a small set of actions
#      (see MESH_ACTIONS). It travels over HTTPS inside the LAN.
# No valid credential -> 401. This is not an open endpoint.
#
# Protocol: POST JSON { "token"|"mesh_key": "...", "action": "...", ... }
# Response: JSON { "ok": true, ... } | { "ok": false, "error": "..." }
#
# HARDWARE LESSONS (Broadcom BCM6756, OEM firmware):
#  - WiFi changes only apply reliably through nvram + REBOOT.
#  - Rebooting from a CGI: send the response, close stdout, then run
#    `ubus call system reboot` (uhttpd kills child processes, so
#    `reboot &` does not work).
#  - JSON emitted by a shell CGI must escape newlines.
# ============================================================================

FREEDOM_VERSION="1.0.0"
CONFIG_NS="freedom"
MESH_ACTIONS=" status assoclist apply_sync reboot get_log "

# ---- helpers ---------------------------------------------------------------
emit() { printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n%s\n' "$1" "$2"; }
fail() { emit "${2:-400 Bad Request}" "{\"ok\":false,\"error\":\"$1\"}"; exit 0; }
ok()   { emit "200 OK" "{\"ok\":true${1:+,$1}}"; exit 0; }

# escape for JSON strings (values we return)
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'; }

# multi-line text -> JSON string without control characters
esc_ml() {
    tr -d '\000-\010\013-\037' | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | awk 'BEGIN{ORS="\\n"}{print}'
}

# top-level string field of the received JSON (simple, no jq)
field() {
    printf '%s' "$BODY" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

is_ip() {
    case "$1" in *[!0-9.]* | "") return 1 ;; esac
    echo "$1" | awk -F. 'NF==4 && $1!="" && $2!="" && $3!="" && $4!="" &&
                         $1<=255 && $2<=255 && $3<=255 && $4<=255 {ok=1} END{exit !ok}'
}
is_mac() { echo "$1" | grep -qiE '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'; }
# "safe" text for names: no quotes, backslash, $ or backtick; max 40
safe_name() {
    case "$1" in *[\"\'\`\$\\]*) return 1 ;; esac
    [ "${#1}" -le 40 ]
}
mac_key() { printf '%s' "$1" | tr 'a-f:' 'A-F_'; }

lan_ip()   { uci -q get network.lan.ipaddr; }
role()     { r=$(uci -q get $CONFIG_NS.node.role); echo "${r:-master}"; }
mesh_key() { uci -q get $CONFIG_NS.mesh.key; }
node_id()  { n=$(uci -q get $CONFIG_NS.mesh.node_id); echo "${n:-master}"; }
root_hash() { sed -n 's/^root:\([^:]*\):.*/\1/p' /etc/shadow; }
psk_hash() { nvram get wl0_wpa_psk 2>/dev/null | md5sum | cut -c1-12; }

ensure_mesh_key() {
    [ -n "$(mesh_key)" ] && return 0
    K=$(head -c 64 /dev/urandom | md5sum | cut -c1-32)
    uci set $CONFIG_NS.mesh=mesh 2>/dev/null
    uci set $CONFIG_NS.mesh.key="$K"
    uci commit $CONFIG_NS
}

# ids of the slaves registered on the master (node_<id> sections with an ip)
slave_ids() { uci -q show $CONFIG_NS | sed -n "s/^$CONFIG_NS\.node_\([^.=]*\)\.ip=.*/\1/p"; }

# call from the master to another node's API over HTTPS (self-signed cert)
node_call() {  # node_call <ip> <json> [timeout]
    printf '%s' "$2" | curl -sk -m "${3:-6}" -H 'Content-Type: application/json' \
        --data-binary @- "https://$1/cgi-bin/freedom-api.sh" 2>/dev/null
}

# internet state: written by the LED daemon every 30s
internet_ok() {
    s=$(cat /tmp/freedom-internet 2>/dev/null)
    if [ -z "$s" ]; then
        ping -c1 -W1 8.8.8.8 >/dev/null 2>&1 && s=ok || s=down
    fi
    [ "$s" = ok ]
}

# ---- clients of THIS node (WiFi + cable) -----------------------------------
# Prints comma-separated JSON objects (with a trailing comma).
#  WiFi: `wl assoclist` + rssi per radio.
#  Cable: bridge MAC table, eth* ports only. On a slave the uplink port (where
#  the master's MAC is learned) is skipped: whatever arrives through it belongs
#  to other nodes, not to this one.
stations() {
    NODE="$1"
    wifimacs=" "
    # MAC->IP from the ARP table: clients that kept their IP across a reboot
    # have no DHCP lease record (leases live in RAM), but they do have an ARP entry.
    ARP=$(awk 'NR>1 && $3!="0x0" {print toupper($4) "=" $1}' /proc/net/arp | tr '\n' ' ')
    for DEV in wl0 wl1; do
        band="2.4G"; [ "$DEV" = "wl1" ] && band="5G"
        for mac in $(wl -i "$DEV" assoclist 2>/dev/null | sed -n 's/^assoclist[[:space:]]*//p'); do
            is_mac "$mac" || continue
            MU=$(printf '%s' "$mac" | tr 'a-f' 'A-F')
            rssi=$(wl -i "$DEV" rssi "$mac" 2>/dev/null | tr -cd '0-9-')
            [ -n "$rssi" ] || rssi=0
            ip=""; for e in $ARP; do [ "${e%%=*}" = "$MU" ] && ip="${e#*=}"; done
            printf '{"mac":"%s","ip":"%s","signal":%s,"band":"%s","device":"%s","conn":"wifi","node":"%s"},' \
                "$MU" "$ip" "$rssi" "$band" "$DEV" "$NODE"
            wifimacs="$wifimacs$MU "
        done
    done

    ports=$(brctl showstp br-lan 2>/dev/null | sed -n 's/^\([a-z0-9.]*\) (\([0-9]*\))$/\2:\1/p' | tr '\n' ' ')
    upport=""
    if [ "$(role)" = "slave" ]; then
        MIP=$(uci -q get $CONFIG_NS.mesh.master_ip)
        if [ -n "$MIP" ]; then
            ping -c1 -W1 "$MIP" >/dev/null 2>&1
            MMAC=$(awk -v ip="$MIP" '$1==ip{print tolower($4)}' /proc/net/arp)
            [ -n "$MMAC" ] && upport=$(brctl showmacs br-lan 2>/dev/null | awk -v m="$MMAC" '$2==m{print $1; exit}')
        fi
    fi
    brctl showmacs br-lan 2>/dev/null | awk -v ports="$ports" -v wifi="$wifimacs" \
        -v up="$upport" -v node="$NODE" -v arp="$ARP" '
        BEGIN { n = split(ports, a, " "); for (i = 1; i <= n; i++) { split(a[i], b, ":"); pm[b[1]] = b[2] }
                n = split(arp, c, " "); for (i = 1; i <= n; i++) { split(c[i], d, "="); am[d[1]] = d[2] } }
        $3 == "no" {
            p = $1; m = toupper($2)
            if (pm[p] !~ /^eth/) next
            if (up != "" && p == up) next
            if (index(wifi, " " m " ")) next
            printf "{\"mac\":\"%s\",\"ip\":\"%s\",\"signal\":null,\"band\":\"cable\",\"device\":\"%s\",\"conn\":\"cable\",\"node\":\"%s\"},", m, am[m], pm[p], node
        }'
}

# ---- master -> slave sync --------------------------------------------------
# Pushes the WiFi SSID/key, the root password hash and the master IP.
# Prints the result as a JSON string: "ok" | "reboot" | "offline" | "error".
push_sync() {  # push_sync <id> <ip>
    B=$(printf '{"mesh_key":"%s","action":"apply_sync","ssid":"%s","psk":"%s","shadow":"%s","master_ip":"%s"}' \
        "$(mesh_key)" "$(nvram get wl0_ssid)" "$(nvram get wl0_wpa_psk)" "$(root_hash)" "${MASTER_IP_OVERRIDE:-$(lan_ip)}")
    R=$(node_call "$2" "$B" 10)
    case "$R" in
        *'"ok":true'*'"rebooting":true'*) echo '"reboot"' ;;
        *'"ok":true'*) echo '"ok"' ;;
        "") echo '"offline"' ;;
        *) echo '"error"' ;;
    esac
}

# syncs ALL slaves in parallel. Prints a JSON array of results.
sync_all() {
    tmp="/tmp/freedom-sync.$$"; mkdir -p "$tmp"
    for id in $(slave_ids); do
        ip=$(uci -q get $CONFIG_NS.node_$id.ip)
        ( push_sync "$id" "$ip" > "$tmp/$id" ) &
    done
    wait
    out=""
    for id in $(slave_ids); do
        out="$out{\"id\":\"$id\",\"result\":$(cat "$tmp/$id" 2>/dev/null || echo '"offline"')},"
    done
    rm -rf "$tmp"
    echo "[${out%,}]"
}

# ---- read the request ------------------------------------------------------
[ "$REQUEST_METHOD" = "POST" ] || fail "POST required" "405 Method Not Allowed"
BODY=$(cat)
[ -n "$BODY" ] || fail "empty body"

ACTION=$(field action)
MK=$(field mesh_key)

# ---- AUTHENTICATION --------------------------------------------------------
if [ -n "$MK" ]; then
    case "$MK" in *[!0-9a-f]*) fail "bad mesh key" "401 Unauthorized" ;; esac
    LK=$(mesh_key)
    { [ -n "$LK" ] && [ "$MK" = "$LK" ]; } || fail "bad mesh key" "401 Unauthorized"
    case "$MESH_ACTIONS" in *" $ACTION "*) ;; *) fail "action not allowed with mesh key" "403 Forbidden" ;; esac
    VIA=mesh
else
    TOKEN=$(field token)
    [ -n "$TOKEN" ] || fail "missing token" "401 Unauthorized"
    case "$TOKEN" in *[!0-9a-fA-F]*) fail "bad token" "401 Unauthorized" ;; esac
    [ "${#TOKEN}" -eq 32 ] || fail "bad token" "401 Unauthorized"
    USER=$(ubus call session get "{\"ubus_rpc_session\":\"$TOKEN\"}" 2>/dev/null \
           | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -n "$USER" ] || fail "session expired" "401 Unauthorized"
    VIA=user
fi

[ -f "/etc/config/$CONFIG_NS" ] || touch "/etc/config/$CONFIG_NS"

# ---- actions ---------------------------------------------------------------
case "$ACTION" in

  # ===== Status of this node (used by the app and by the master to poll) ===
  status)
    UP=$(cut -d. -f1 /proc/uptime)
    CL=0
    for d in wl0 wl1; do
        n=$(wl -i "$d" assoclist 2>/dev/null | grep -c assoclist); CL=$((CL + n))
    done
    WANIP=$(ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null)
    LS=$(uci -q get $CONFIG_NS.mesh.last_sync); case "$LS" in ''|*[!0-9]*) LS=0 ;; esac
    NET=false; internet_ok && NET=true
    DHCP=true; [ "$(uci -q get dhcp.lan.ignore)" = "1" ] && DHCP=false
    NSL=0; [ "$(role)" = "master" ] && NSL=$(slave_ids | wc -l)
    PWC=false; [ "$(uci -q get $CONFIG_NS.node.pw_changed)" = "1" ] && PWC=true
    ok "\"role\":\"$(role)\",\"node_id\":\"$(node_id)\",\"version\":\"$FREEDOM_VERSION\",\"hostname\":\"$(esc "$(cat /proc/sys/kernel/hostname)")\",\"lan_ip\":\"$(lan_ip)\",\"wan_ip\":\"$(esc "$WANIP")\",\"wan_proto\":\"$(esc "$(uci -q get network.wan.proto)")\",\"uptime\":${UP:-0},\"clients\":$CL,\"internet\":$NET,\"dhcp\":$DHCP,\"ssid\":\"$(esc "$(nvram get wl0_ssid)")\",\"psk_hash\":\"$(psk_hash)\",\"master_ip\":\"$(esc "$(uci -q get $CONFIG_NS.mesh.master_ip)")\",\"last_sync\":$LS,\"slaves\":$NSL,\"pw_changed\":$PWC,\"mac\":\"$(cat /sys/class/net/br-lan/address 2>/dev/null)\""
    ;;

  # ===== Names =============================================================
  set_node_name)
    NID=$(field node_id); NAME=$(field name)
    case "$NID" in *[!0-9a-zA-Z_-]* | "") fail "bad node_id" ;; esac
    safe_name "$NAME" || fail "Invalid name. Use up to 40 characters without quotes, backslashes or other special characters."
    uci set "$CONFIG_NS.node_$NID=node" 2>/dev/null
    uci set "$CONFIG_NS.node_$NID.name=$NAME"
    uci commit "$CONFIG_NS"
    ok "\"name\":\"$(esc "$NAME")\""
    ;;

  set_device_name)
    MAC=$(field mac); NAME=$(field name)
    is_mac "$MAC" || fail "bad mac"
    safe_name "$NAME" || fail "Invalid name. Use up to 40 characters without quotes, backslashes or other special characters."
    KEY=$(mac_key "$MAC")
    if [ -z "$NAME" ]; then
        uci -q delete "$CONFIG_NS.dev_$KEY"
    else
        uci set "$CONFIG_NS.dev_$KEY=device"
        uci set "$CONFIG_NS.dev_$KEY.mac=$MAC"
        uci set "$CONFIG_NS.dev_$KEY.name=$NAME"
    fi
    uci commit "$CONFIG_NS"
    ok
    ;;

  # ===== Private config (names, qos, blocks), no secrets ===================
  get_config)
    DUMP=$(uci -q export "$CONFIG_NS" 2>/dev/null \
           | grep -vE "option (key|uplink_key) " | esc_ml)
    ok "\"config\":\"$DUMP\""
    ;;

  # ===== WiFi ==============================================================
  # nvram + REBOOT (the only reliable path on this Broadcom). On the master,
  # if there are slaves, it first pushes the new SSID/key to them (they reboot)
  # and then reboots itself. Channels are NOT synced: each node picks its own.
  set_wifi)
    DEV=$(field device); [ -n "$DEV" ] || DEV="all"
    SSID=$(field ssid); KEY=$(field key); CH=$(field channel)
    DOREBOOT=$(field reboot)
    case "$DEV" in
      wl0|wl1) DEVS="$DEV" ;;
      all)     DEVS="wl0 wl1" ;;
      *)       fail "bad device" ;;
    esac
    if [ -n "$SSID" ]; then
      case "$SSID" in *[\"\'\`\$\\]* ) fail "bad ssid chars" ;; esac
      [ "${#SSID}" -le 32 ] || fail "ssid too long"
    fi
    if [ -n "$KEY" ]; then
      [ "${#KEY}" -ge 8 ] || fail "key too short (min 8)"
      [ "${#KEY}" -le 63 ] || fail "key too long (max 63)"
      case "$KEY" in *[\"\'\`\$\\]* ) fail "bad key chars" ;; esac
    fi
    if [ -n "$CH" ] && [ "$CH" != "auto" ]; then
      case "$CH" in *[!0-9]* ) fail "bad channel" ;; esac
    fi

    for d in $DEVS; do
      IFACE="default_${d}"
      [ -n "$SSID" ] && { nvram set "${d}_ssid=$SSID"; uci -q set "wireless.$IFACE.ssid=$SSID"; }
      [ -n "$KEY" ]  && { nvram set "${d}_wpa_psk=$KEY"; uci -q set "wireless.$IFACE.key=$KEY"; }
      if [ -n "$CH" ] && [ "$CH" != "auto" ]; then
        nvram set "${d}_channel=$CH"; uci -q set "wireless.$IFACE.channel=$CH"
      elif [ "$CH" = "auto" ]; then
        nvram set "${d}_channel=0"; uci -q set "wireless.$IFACE.channel=auto"
      fi
    done
    nvram commit 2>/dev/null
    uci -q commit wireless

    SYNC="[]"
    if [ "$(role)" = "master" ] && [ -n "$SSID$KEY" ] && [ -n "$(slave_ids)" ]; then
      SYNC=$(sync_all)
    fi

    if [ "$DOREBOOT" = "0" ]; then
      ok "\"note\":\"Saved. Reboot the node to apply.\",\"sync\":$SYNC"
    else
      emit "200 OK" "{\"ok\":true,\"note\":\"Saved. The node will reboot now (about 1 minute).\",\"sync\":$SYNC}"
      exec >/dev/null 2>&1
      ubus call system reboot
      exit 0
    fi
    ;;

  get_wifi)
    out=""
    for DEV in wl0 wl1; do
      s=$(nvram get "${DEV}_ssid" 2>/dev/null)
      c=$(nvram get "${DEV}_channel" 2>/dev/null)
      { [ -z "$c" ] || [ "$c" = "0" ]; } && c="auto"
      live=$(wl -i "$DEV" ssid 2>/dev/null | sed -n 's/.*"\(.*\)".*/\1/p')
      cur=$(wl -i "$DEV" chanspec 2>/dev/null | awk '{print $1}')
      out="$out{\"device\":\"$DEV\",\"ssid\":\"$(esc "$s")\",\"channel\":\"$(esc "$c")\",\"live\":\"$(esc "$live")\",\"current\":\"$(esc "$cur")\"},"
    done
    ok "\"radios\":[${out%,}]"
    ;;

  # ===== Network: LAN ======================================================
  set_lan)
    IP=$(field ipaddr); MASK=$(field netmask)
    is_ip "$IP" || fail "bad ip"
    [ -z "$MASK" ] || is_ip "$MASK" || fail "bad netmask"
    if [ "$(role)" = "master" ] && [ -n "$(slave_ids)" ]; then
      [ "${IP%.*}" = "$(lan_ip | sed 's/\.[0-9]*$//')" ] || \
        fail "This mesh has slave nodes, so the LAN IP can only change within the same network (new ${IP%.*}.x, current $(lan_ip | sed 's/\.[0-9]*$//').x)."
      MASTER_IP_OVERRIDE="$IP" sync_all >/dev/null
    fi
    uci set "network.lan.ipaddr=$IP"
    [ -n "$MASK" ] && uci set "network.lan.netmask=$MASK"
    uci set $CONFIG_NS.node=node 2>/dev/null; uci set "$CONFIG_NS.node.mgmt_ip=$IP"; uci commit $CONFIG_NS
    uci commit network
    (sleep 1; /etc/init.d/network reload >/dev/null 2>&1) &
    ok "\"note\":\"The network will reload. Reconnect at the new IP address.\""
    ;;

  # ===== Network: WAN ======================================================
  set_wan)
    [ "$(role)" = "master" ] || fail "A slave node has no WAN (both of its ports are LAN ports)."
    PROTO=$(field proto)
    case "$PROTO" in
      dhcp)
        uci set network.wan.proto=dhcp
        uci -q delete network.wan.ipaddr; uci -q delete network.wan.netmask
        uci -q delete network.wan.gateway; uci -q delete network.wan.dns ;;
      static)
        IP=$(field ipaddr); MASK=$(field netmask); GW=$(field gateway); DNS=$(field dns)
        is_ip "$IP" || fail "Invalid WAN IP address."
        is_ip "$GW" || fail "Invalid gateway address."
        [ -z "$MASK" ] || is_ip "$MASK" || fail "Invalid netmask."
        uci set network.wan.proto=static
        uci set "network.wan.ipaddr=$IP"; uci set "network.wan.netmask=${MASK:-255.255.255.0}"
        uci set "network.wan.gateway=$GW"
        uci -q delete network.wan.dns
        for d in $(echo "$DNS" | tr ',' ' '); do is_ip "$d" && uci add_list "network.wan.dns=$d"; done ;;
      pppoe)
        U=$(field username); P=$(field password)
        [ -n "$U" ] || fail "The PPPoE username is required."
        case "$U$P" in *[\"\'\`\$\\]*) fail "The PPPoE username or password contains unsupported characters." ;; esac
        uci set network.wan.proto=pppoe
        uci set "network.wan.username=$U"; uci set "network.wan.password=$P" ;;
      *) fail "bad proto" ;;
    esac
    uci commit network
    (sleep 1; /etc/init.d/network reload >/dev/null 2>&1) &
    ok
    ;;

  # ===== Network: DHCP =====================================================
  set_dhcp)
    START=$(field start); LIMIT=$(field limit); LEASE=$(field leasetime)
    case "$START$LIMIT" in *[!0-9]* | "") fail "bad range" ;; esac
    [ "$START" -ge 2 ] && [ "$START" -le 254 ] || fail "The start address is out of range (2-254)."
    [ $((START + LIMIT - 1)) -le 254 ] || fail "The range goes past the end of the network (max .254)."
    uci set dhcp.lan.start="$START"
    uci set dhcp.lan.limit="$LIMIT"
    if [ -n "$LEASE" ]; then
      case "$LEASE" in *[!0-9mhd]*) fail "bad leasetime" ;; esac
      uci set dhcp.lan.leasetime="$LEASE"
    fi
    uci commit dhcp
    /etc/init.d/dnsmasq reload >/dev/null 2>&1 &
    ok
    ;;

  # ===== IP reservations (static DHCP) =====================================
  list_static)
    out=""
    for s in $(uci -q show dhcp | sed -n "s/^dhcp\.\(qf_[^.=]*\)=host$/\1/p"); do
      m=$(uci -q get "dhcp.$s.mac"); i=$(uci -q get "dhcp.$s.ip"); n=$(uci -q get "dhcp.$s.name")
      out="$out{\"mac\":\"$(esc "$m")\",\"ip\":\"$(esc "$i")\",\"name\":\"$(esc "$n")\"},"
    done
    ok "\"leases\":[${out%,}]"
    ;;

  set_static)
    MAC=$(field mac); IP=$(field ip); NAME=$(field name)
    is_mac "$MAC" || fail "bad mac"
    is_ip "$IP" || fail "Invalid IP address."
    [ "${IP%.*}" = "$(lan_ip | sed 's/\.[0-9]*$//')" ] || fail "The IP address must be in the $(lan_ip | sed 's/\.[0-9]*$//').x network."
    [ "$IP" = "$(lan_ip)" ] && fail "That is the IP address of the master node."
    HN=$(printf '%s' "$NAME" | tr -c 'A-Za-z0-9-' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//' | cut -c1-32)
    KEY=$(mac_key "$MAC")
    # the IP must not already be reserved for another device
    for s in $(uci -q show dhcp | sed -n "s/^dhcp\.\(qf_[^.=]*\)=host$/\1/p"); do
      [ "$s" = "qf_$KEY" ] && continue
      [ "$(uci -q get "dhcp.$s.ip")" = "$IP" ] && fail "That IP address is already reserved for another device."
    done
    uci set "dhcp.qf_$KEY=host"
    uci set "dhcp.qf_$KEY.mac=$MAC"
    uci set "dhcp.qf_$KEY.ip=$IP"
    if [ -n "$HN" ]; then uci set "dhcp.qf_$KEY.name=$HN"; else uci -q delete "dhcp.qf_$KEY.name"; fi
    uci commit dhcp
    /etc/init.d/dnsmasq restart >/dev/null 2>&1 &
    ok "\"note\":\"The device will get this IP address the next time it renews its lease.\""
    ;;

  del_static)
    MAC=$(field mac); is_mac "$MAC" || fail "bad mac"
    uci -q delete "dhcp.qf_$(mac_key "$MAC")"
    uci commit dhcp
    /etc/init.d/dnsmasq restart >/dev/null 2>&1 &
    ok
    ;;

  # ===== Speed limit (tc htb on br-lan = download) =========================
  set_speed)
    IP=$(field ip); DOWN=$(field down_kbit)
    is_ip "$IP" || fail "bad ip"
    case "$DOWN" in *[!0-9]*) fail "bad speed" ;; esac
    /usr/sbin/freedom-qos.sh "$IP" "${DOWN:-0}" 2>/dev/null
    KEY=$(printf '%s' "$IP" | tr '.' '_')
    if [ -n "$DOWN" ] && [ "$DOWN" -gt 0 ] 2>/dev/null; then
      uci set "$CONFIG_NS.qos_$KEY=qos"; uci set "$CONFIG_NS.qos_$KEY.ip=$IP"; uci set "$CONFIG_NS.qos_$KEY.down=$DOWN"
    else
      uci -q delete "$CONFIG_NS.qos_$KEY"
    fi
    uci commit "$CONFIG_NS"
    ok
    ;;

  # ===== Pause internet (MAC block on the master) ==========================
  set_block)
    MAC=$(field mac); B=$(field blocked)
    is_mac "$MAC" || fail "bad mac"
    KEY=$(mac_key "$MAC")
    if [ "$B" = "1" ]; then
      uci set "$CONFIG_NS.blk_$KEY=block"; uci set "$CONFIG_NS.blk_$KEY.mac=$MAC"
    else
      uci -q delete "$CONFIG_NS.blk_$KEY"
    fi
    uci commit "$CONFIG_NS"
    /usr/sbin/freedom-fw.sh >/dev/null 2>&1
    ok
    ;;

  # ===== Clients of this node ==============================================
  assoclist)
    out=$(stations "$(node_id)")
    ok "\"stations\":[${out%,}]"
    ;;

  # ===== Clients of the WHOLE mesh (master + slaves) =======================
  mesh_clients)
    out=$(stations "$(node_id)")
    if [ "$(role)" = "master" ] && [ -n "$(slave_ids)" ]; then
      K=$(mesh_key); tmp="/tmp/freedom-mc.$$"; mkdir -p "$tmp"
      for id in $(slave_ids); do
        ip=$(uci -q get $CONFIG_NS.node_$id.ip)
        ( node_call "$ip" "{\"mesh_key\":\"$K\",\"action\":\"assoclist\"}" 5 > "$tmp/$id" ) &
      done
      wait
      for id in $(slave_ids); do
        st=$(sed -n 's/.*"stations":\[\(.*\)\].*/\1/p' "$tmp/$id" 2>/dev/null)
        [ -n "$st" ] && out="$out$st,"
      done
      rm -rf "$tmp"
      # drop the mesh nodes themselves from the list: each Q11 uses consecutive
      # MACs (br-lan, eth0, wl0, wl1) sharing the same first 5 bytes
      pref=""
      for id in $(slave_ids); do
        ip=$(uci -q get $CONFIG_NS.node_$id.ip)
        m=$(awk -v ip="$ip" '$1==ip{print toupper($4)}' /proc/net/arp)
        [ -n "$m" ] && pref="$pref ${m%:*}"
      done
      if [ -n "$pref" ]; then
        out=$(printf '%s' "$out" | sed 's/},{/}\n{/g' | awk -v p="$pref" '
          BEGIN { n = split(p, a, " ") }
          { keep = 1; for (i = 1; i <= n; i++) if (index($0, "\"mac\":\"" a[i] ":")) keep = 0
            if (keep) printf "%s,", $0 }' | sed 's/,,/,/g')
      fi
    fi
    ok "\"stations\":[${out%,}]"
    ;;

  # ===== Mesh: list and status of nodes (master) ===========================
  nodes)
    [ "$(role)" = "master" ] || fail "Only the master node manages the mesh."
    MYSSID=$(nvram get wl0_ssid); MYPH=$(psk_hash)
    K=$(mesh_key); tmp="/tmp/freedom-nodes.$$"; mkdir -p "$tmp"
    for id in $(slave_ids); do
      ip=$(uci -q get $CONFIG_NS.node_$id.ip)
      ( node_call "$ip" "{\"mesh_key\":\"$K\",\"action\":\"status\"}" 4 > "$tmp/$id" ) &
    done
    wait
    UP=$(cut -d. -f1 /proc/uptime)
    CL=0; for d in wl0 wl1; do n=$(wl -i "$d" assoclist 2>/dev/null | grep -c assoclist); CL=$((CL + n)); done
    NET=false; internet_ok && NET=true
    out="{\"id\":\"master\",\"ip\":\"$(lan_ip)\",\"role\":\"master\",\"self\":true,\"online\":true,\"uptime\":$UP,\"clients\":$CL,\"internet\":$NET,\"ssid\":\"$(esc "$MYSSID")\",\"synced\":true,\"version\":\"$FREEDOM_VERSION\",\"mac\":\"$(cat /sys/class/net/br-lan/address 2>/dev/null)\"}"
    for id in $(slave_ids); do
      ip=$(uci -q get $CONFIG_NS.node_$id.ip)
      R=$(cat "$tmp/$id" 2>/dev/null)
      case "$R" in
        *'"ok":true'*)
          S_UP=0; S_CL=0; S_NET=0; S_SSID=""; S_PH=""; S_VER=""; S_LS=0; S_MAC=""; S_ROLE=""
          eval "$(jsonfilter -s "$R" -e 'S_UP=@.uptime' -e 'S_CL=@.clients' -e 'S_NET=@.internet' \
                  -e 'S_SSID=@.ssid' -e 'S_PH=@.psk_hash' -e 'S_VER=@.version' -e 'S_LS=@.last_sync' \
                  -e 'S_MAC=@.mac' -e 'S_ROLE=@.role' 2>/dev/null)"
          SYN=false; [ "$S_SSID" = "$MYSSID" ] && [ "$S_PH" = "$MYPH" ] && SYN=true
          NT=false; [ "$S_NET" = "1" ] && NT=true
          case "$S_UP$S_CL$S_LS" in *[!0-9]*) S_UP=0; S_CL=0; S_LS=0 ;; esac
          out="$out,{\"id\":\"$id\",\"ip\":\"$ip\",\"role\":\"$(esc "$S_ROLE")\",\"self\":false,\"online\":true,\"uptime\":${S_UP:-0},\"clients\":${S_CL:-0},\"internet\":$NT,\"ssid\":\"$(esc "$S_SSID")\",\"synced\":$SYN,\"version\":\"$(esc "$S_VER")\",\"last_sync\":${S_LS:-0},\"mac\":\"$(esc "$S_MAC")\"}"
          ;;
        *)
          out="$out,{\"id\":\"$id\",\"ip\":\"$ip\",\"self\":false,\"online\":false}"
          ;;
      esac
    done
    rm -rf "$tmp"
    ok "\"nodes\":[$out]"
    ;;

  # ===== Mesh: find Q11 Freedom nodes not yet added (master) ===============
  # Candidates: ARP table IPs with a Motorola MAC (c8:c7:50) + the .2-.20 range.
  discover)
    [ "$(role)" = "master" ] || fail "Only the master node manages the mesh."
    NET3=$(lan_ip | sed 's/\.[0-9]*$//')
    known=" $(lan_ip) "
    for id in $(slave_ids); do known="$known$(uci -q get $CONFIG_NS.node_$id.ip) "; done
    cands=$(awk -v n="$NET3." 'NR>1 && index($1, n)==1 && tolower($4) ~ /^c8:c7:50/ {print $1}' /proc/net/arp)
    i=2; while [ $i -le 20 ]; do cands="$cands $NET3.$i"; i=$((i + 1)); done
    tmp="/tmp/freedom-disc.$$"; mkdir -p "$tmp"
    seen=" "
    for ip in $cands; do
      case "$seen" in *" $ip "*) continue ;; esac; seen="$seen$ip "
      case "$known" in *" $ip "*) continue ;; esac
      ( curl -sk -m 2 "https://$ip/app/manifest.webmanifest" 2>/dev/null | grep -q "Q11 Freedom" && echo "$ip" > "$tmp/$ip" ) &
    done
    wait
    out=""
    for f in "$tmp"/*; do
      [ -f "$f" ] || continue
      ip=$(cat "$f")
      mac=$(awk -v ip="$ip" '$1==ip{print toupper($4)}' /proc/net/arp)
      out="$out{\"ip\":\"$ip\",\"mac\":\"$mac\"},"
    done
    rm -rf "$tmp"
    ok "\"found\":[${out%,}]"
    ;;

  # ===== Mesh: add a slave (master) ========================================
  # The node must already be provisioned (provision.sh --role slave --lan-ip X)
  # and connected by cable. The master logs in once with THE NODE'S password,
  # hands it the mesh key, and from then on manages and syncs it.
  adopt_node)
    [ "$(role)" = "master" ] || fail "Only the master node can add nodes."
    IP=$(field ip); PW=$(field password); NAME=$(field name)
    is_ip "$IP" || fail "Invalid IP address."
    [ "$IP" = "$(lan_ip)" ] && fail "That is the IP address of the master node."
    [ -n "$PW" ] || fail "The root password of the node is required."
    case "$PW" in *[\"\\]*) fail "The password contains unsupported characters." ;; esac
    safe_name "$NAME" || fail "Invalid name. Use up to 40 characters without quotes, backslashes or other special characters."
    ID="node${IP##*.}"
    [ -n "$(uci -q get $CONFIG_NS.node_$ID.ip)" ] && fail "That node is already part of the mesh."

    ensure_mesh_key
    LOGIN=$(printf '{"jsonrpc":"2.0","id":1,"method":"call","params":["00000000000000000000000000000000","session","login",{"username":"root","password":"%s"}]}' "$PW" \
            | curl -sk -m 6 -H 'Content-Type: application/json' --data-binary @- "https://$IP/ubus" 2>/dev/null)
    [ -n "$LOGIN" ] || fail "No response from $IP. Check the cable and the IP address."
    STOK=$(jsonfilter -s "$LOGIN" -e '@.result[1].ubus_rpc_session' 2>/dev/null)
    [ -n "$STOK" ] || fail "Wrong password for $IP."

    R=$(node_call "$IP" "{\"token\":\"$STOK\",\"action\":\"join_mesh\",\"key\":\"$(mesh_key)\",\"master_ip\":\"$(lan_ip)\",\"node_id\":\"$ID\"}" 8)
    case "$R" in
      *'"ok":true'*) ;;
      "") fail "The node does not have Q11 Freedom installed. Run provision.sh on it first." ;;
      *) fail "The node rejected the join request: $(esc "$(printf '%s' "$R" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')")" ;;
    esac

    uci set "$CONFIG_NS.node_$ID=node"
    uci set "$CONFIG_NS.node_$ID.ip=$IP"
    [ -n "$NAME" ] && uci set "$CONFIG_NS.node_$ID.name=$NAME"
    uci commit "$CONFIG_NS"

    # the slave applies its role (network reload); give it a moment, then sync
    sleep 4
    S=$(push_sync "$ID" "$IP")
    ok "\"id\":\"$ID\",\"sync\":$S"
    ;;

  remove_node)
    [ "$(role)" = "master" ] || fail "Only the master node manages the mesh."
    NID=$(field node_id)
    case "$NID" in *[!0-9a-zA-Z_-]* | "" | master) fail "bad node_id" ;; esac
    uci -q delete "$CONFIG_NS.node_$NID"
    uci commit "$CONFIG_NS"
    ok
    ;;

  sync_nodes)
    [ "$(role)" = "master" ] || fail "Only the master node can sync the mesh."
    ok "\"results\":$(sync_all)"
    ;;

  node_reboot)
    [ "$(role)" = "master" ] || fail "Only the master node manages the mesh."
    NID=$(field node_id)
    case "$NID" in *[!0-9a-zA-Z_-]* | "") fail "bad node_id" ;; esac
    ip=$(uci -q get "$CONFIG_NS.node_$NID.ip"); [ -n "$ip" ] || fail "Unknown node."
    R=$(node_call "$ip" "{\"mesh_key\":\"$(mesh_key)\",\"action\":\"reboot\"}" 5)
    case "$R" in *'"ok":true'*) ok ;; *) fail "The node did not respond." ;; esac
    ;;

  node_log)
    [ "$(role)" = "master" ] || fail "Only the master node manages the mesh."
    NID=$(field node_id)
    case "$NID" in *[!0-9a-zA-Z_-]* | "") fail "bad node_id" ;; esac
    ip=$(uci -q get "$CONFIG_NS.node_$NID.ip"); [ -n "$ip" ] || fail "Unknown node."
    R=$(node_call "$ip" "{\"mesh_key\":\"$(mesh_key)\",\"action\":\"get_log\"}" 6)
    case "$R" in *'"ok":true'*) emit "200 OK" "$R"; exit 0 ;; *) fail "The node did not respond." ;; esac
    ;;

  # ===== SLAVE side: join a mesh (called by the master) ====================
  join_mesh)
    [ "$VIA" = "user" ] || fail "join requires login"
    K=$(field key); MIP=$(field master_ip); NID=$(field node_id)
    case "$K" in *[!0-9a-f]* | "") fail "bad key" ;; esac
    [ "${#K}" -eq 32 ] || fail "bad key"
    is_ip "$MIP" || fail "bad master ip"
    [ "$MIP" = "$(lan_ip)" ] && fail "This node has the same IP address as the master."
    [ "$(lan_ip | sed 's/\.[0-9]*$//')" = "${MIP%.*}" ] || fail "This node is on a different network ($(lan_ip)). Provision it with --lan-ip in ${MIP%.*}.x."
    case "$NID" in *[!0-9a-zA-Z_-]* | "") fail "bad node_id" ;; esac
    uci set $CONFIG_NS.mesh=mesh 2>/dev/null
    uci set "$CONFIG_NS.mesh.key=$K"
    uci set "$CONFIG_NS.mesh.master_ip=$MIP"
    uci set "$CONFIG_NS.mesh.node_id=$NID"
    uci set $CONFIG_NS.node=node 2>/dev/null
    uci set $CONFIG_NS.node.role=slave
    uci commit "$CONFIG_NS"
    emit "200 OK" '{"ok":true,"note":"Joined the mesh."}'
    exec >/dev/null 2>&1
    /usr/sbin/freedom-role.sh
    exit 0
    ;;

  # ===== SLAVE side: apply config from the master ==========================
  apply_sync)
    [ "$(role)" = "slave" ] || fail "This node is not a slave."
    SSID=$(field ssid); PSK=$(field psk); SH=$(field shadow); MIP=$(field master_ip)
    case "$SSID$PSK" in *[\"\'\`\$\\]*) fail "bad wifi chars" ;; esac
    [ "${#SSID}" -le 32 ] || fail "ssid too long"
    changed=0
    for d in wl0 wl1; do
      if [ -n "$SSID" ] && [ "$(nvram get ${d}_ssid)" != "$SSID" ]; then nvram set "${d}_ssid=$SSID"; changed=1; fi
      if [ -n "$PSK" ] && [ "${#PSK}" -ge 8 ] && [ "$(nvram get ${d}_wpa_psk)" != "$PSK" ]; then nvram set "${d}_wpa_psk=$PSK"; changed=1; fi
    done
    if [ -n "$SH" ]; then
      case "$SH" in *[!A-Za-z0-9./\$]*) fail "bad shadow" ;; esac
      [ "$(root_hash)" = "$SH" ] || sed -i "s|^root:[^:]*:|root:$SH:|" /etc/shadow
      uci set $CONFIG_NS.node.pw_changed=1
    fi
    if [ -n "$MIP" ] && is_ip "$MIP" && [ "$MIP" != "$(uci -q get $CONFIG_NS.mesh.master_ip)" ]; then
      uci set "$CONFIG_NS.mesh.master_ip=$MIP"
      NEEDROLE=1
    fi
    uci set "$CONFIG_NS.mesh.last_sync=$(date +%s)"
    uci commit "$CONFIG_NS"
    if [ "$changed" = "1" ]; then
      nvram commit 2>/dev/null
      emit "200 OK" '{"ok":true,"rebooting":true}'
      exec >/dev/null 2>&1
      ubus call system reboot
      exit 0
    fi
    [ "$NEEDROLE" = "1" ] && (/usr/sbin/freedom-role.sh >/dev/null 2>&1 &)
    ok "\"rebooting\":false"
    ;;

  # ===== Remembered DHCP names (survive a reboot) ==========================
  # Written by /etc/hotplug.d/dhcp/50-freedom-names; only [A-Za-z0-9._-].
  host_names)
    out=$(awk 'NF==2 {printf "\"%s\":\"%s\",", $1, $2}' /etc/freedom-hosts 2>/dev/null)
    ok "\"names\":{${out%,}}"
    ;;

  # ===== Internet service provider (ISP) ===================================
  # The WAN usually sits on a private IP (behind a modem or CGNAT), so the ISP
  # is only visible from outside: the public IP is looked up through an
  # external service (ipwho.is, with ipinfo.io as fallback). Cached 6 h in /tmp.
  isp)
    C=/tmp/freedom-isp.json; NOW=$(date +%s)
    TS=0; [ -s "$C" ] && TS=$(jsonfilter -i "$C" -e '@.ts' 2>/dev/null)
    case "$TS" in ''|*[!0-9]*) TS=0 ;; esac
    if [ "$(field refresh)" = "1" ] || [ $((NOW - TS)) -gt 21600 ]; then
      I_OK=0; I_IP=""; I_ASN=""; I_ORG=""; I_ISP=""; I_DOM=""
      R=$(curl -sk -m 5 'https://ipwho.is/?fields=success,ip,connection' 2>/dev/null)
      [ -n "$R" ] && eval "$(jsonfilter -s "$R" -e 'I_OK=@.success' -e 'I_IP=@.ip' -e 'I_ASN=@.connection.asn' \
                     -e 'I_ORG=@.connection.org' -e 'I_ISP=@.connection.isp' -e 'I_DOM=@.connection.domain' 2>/dev/null)"
      if [ "$I_OK" != "1" ]; then
        R=$(curl -sk -m 5 'https://ipinfo.io/json' 2>/dev/null)
        O=""; [ -n "$R" ] && eval "$(jsonfilter -s "$R" -e 'I_IP=@.ip' -e 'O=@.org' 2>/dev/null)"
        # "AS64500 Example ISP Inc." -> asn + name
        [ -n "$O" ] && { I_OK=1; I_ASN=$(echo "$O" | sed -n 's/^AS\([0-9]*\) .*/\1/p'); I_ORG=${O#AS* }; I_ISP=$I_ORG; }
      fi
      case "$I_ASN" in *[!0-9]*) I_ASN="" ;; esac
      if [ "$I_OK" = "1" ]; then
        printf '{"public_ip":"%s","asn":%s,"org":"%s","isp":"%s","domain":"%s","ts":%s}' \
          "$(esc "$I_IP")" "${I_ASN:-0}" "$(esc "$I_ORG")" "$(esc "$I_ISP")" "$(esc "$I_DOM")" "$NOW" > "$C"
      elif [ ! -s "$C" ]; then
        fail "Could not look up the internet provider. Check that the internet connection is up."
      fi
    fi
    D=$(cat "$C"); D=${D#\{}; D=${D%\}}
    ok "$D"
    ;;

  # ===== System log ========================================================
  get_log)
    LOG=$(logread 2>/dev/null | tail -n 150 | esc_ml)
    ok "\"log\":\"$LOG\""
    ;;

  # ===== Root password (on the master it is replicated to the slaves) ======
  set_password)
    PW=$(field password)
    [ "${#PW}" -ge 8 ] || fail "password too short (min 8)"
    case "$PW" in *[\"\'\`\$\\]* ) fail "bad password chars" ;; esac
    printf '%s\n%s\n' "$PW" "$PW" | passwd root >/dev/null 2>&1 || fail "passwd failed"
    uci set $CONFIG_NS.node=node 2>/dev/null; uci set $CONFIG_NS.node.pw_changed=1; uci commit $CONFIG_NS
    SYNC="[]"
    [ "$(role)" = "master" ] && [ -n "$(slave_ids)" ] && SYNC=$(sync_all)
    ok "\"sync\":$SYNC"
    ;;

  # ===== Reboot ============================================================
  reboot)
    emit "200 OK" '{"ok":true,"note":"Rebooting."}'
    exec >/dev/null 2>&1
    ubus call system reboot
    exit 0
    ;;

  *) fail "unknown action: $(esc "$ACTION")" ;;
esac
