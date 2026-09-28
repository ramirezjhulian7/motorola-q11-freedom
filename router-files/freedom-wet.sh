#!/bin/sh
# ============================================================================
# Q11 Freedom - WET wireless backhaul (slave node uplinks to master over 5GHz).
# OPTIONAL / EXPERIMENTAL: the recommended backhaul is Ethernet cable.
#
# This is the ONLY method that works on this Broadcom firmware for a wireless
# backhaul (WDS/STA-pure/EasyMesh all fail, see docs/HARDWARE.md). Key trick:
# use the driver's INTERNAL supplicant (wl sup_wpa 1 + set_pmk), NOT
# wpa_supplicant (which gets DEAUTH'd during the 4-way handshake).
#
# wl1 (5GHz) becomes the WET uplink to the master; wl0 (2.4GHz) stays an AP for
# clients. wl1 lives in br-lan so the L2 (and internet) flows transparently.
#
# Config is read from uci 'freedom' (set by provision.sh --role slave):
#   freedom.mesh.uplink_ssid   SSID of the master to connect to
#   freedom.mesh.uplink_key    its WPA2 passphrase
#   freedom.mesh.master_ip     master LAN IP (for default route), e.g. 192.168.50.1
#
# Usage: freedom-wet.sh start | stop | status
# ============================================================================
UPLINK_IF="wl1"
CONF_NS="freedom"

get() { uci -q get "$CONF_NS.mesh.$1"; }

start() {
    SSID=$(get uplink_ssid)
    KEY=$(get uplink_key)
    MASTER=$(get master_ip)
    [ -n "$SSID" ] && [ -n "$KEY" ] || { echo "freedom-wet: uplink_ssid/uplink_key are not configured"; exit 1; }
    [ -n "$MASTER" ] || MASTER="192.168.50.1"

    logger -t freedom-wet "starting WET backhaul to '$SSID' on $UPLINK_IF"

    # silence Broadcom daemons that fight over the radio
    killall acsd2 wlssk openwrt_wifi_agent wpa_supplicant 2>/dev/null
    for p in $(pgrep hostapd); do
        grep -q "$UPLINK_IF" /proc/$p/cmdline 2>/dev/null && kill $p
    done
    sleep 1

    # wl1 -> WET mode with the driver's internal supplicant
    wl -i "$UPLINK_IF" down
    wl -i "$UPLINK_IF" ap 0
    wl -i "$UPLINK_IF" wet 1
    wl -i "$UPLINK_IF" wsec 4
    wl -i "$UPLINK_IF" wpa_auth 0x80
    wl -i "$UPLINK_IF" sup_wpa 1
    wl -i "$UPLINK_IF" set_pmk "$KEY"
    wl -i "$UPLINK_IF" up
    sleep 2
    wl -i "$UPLINK_IF" join "$SSID" imode bss amode wpa2psk

    # WAIT for the internal supplicant to authenticate (status 6) BEFORE
    # touching the bridge; otherwise L2 does not come up (this was the boot failure).
    i=0
    while [ $i -lt 20 ]; do
        sleep 1
        [ "$(wl -i "$UPLINK_IF" sup_auth_status 2>/dev/null | head -1)" = "6" ] && break
        i=$((i+1))
    done
    AUTH=$(wl -i "$UPLINK_IF" sup_auth_status 2>/dev/null | head -1)

    # NOW authenticated: (re)ensure wl1 is in br-lan. The earlier `wl down`
    # removes it from the bridge, so it MUST be re-added after the join.
    brctl addif br-lan "$UPLINK_IF" 2>/dev/null
    ip link set "$UPLINK_IF" up

    # static LAN IP of the slave on br-lan (DHCP off -> it gets none) + route
    LAN_IP=$(uci -q get network.lan.ipaddr)
    LAN_MASK=$(uci -q get network.lan.netmask); [ -n "$LAN_MASK" ] || LAN_MASK="255.255.255.0"
    if [ -n "$LAN_IP" ] && ! ip -4 addr show br-lan | grep -q "$LAN_IP"; then
        ip addr add "$LAN_IP/24" dev br-lan 2>/dev/null
    fi
    ip route del default 2>/dev/null
    ip route add default via "$MASTER" 2>/dev/null

    logger -t freedom-wet "auth_status=$AUTH rssi=$(wl -i "$UPLINK_IF" rssi 2>/dev/null) lan=$LAN_IP"
}

stop() {
    wl -i "$UPLINK_IF" wet 0
    wl -i "$UPLINK_IF" ap 1
    logger -t freedom-wet "WET stopped; $UPLINK_IF is back in AP mode"
}

status() {
    echo "wet=$(wl -i "$UPLINK_IF" wet 2>/dev/null)"
    echo "assoc=$(wl -i "$UPLINK_IF" assoc 2>/dev/null | grep -i ssid | head -1)"
    echo "rssi=$(wl -i "$UPLINK_IF" rssi 2>/dev/null)"
    echo "auth_status=$(wl -i "$UPLINK_IF" sup_auth_status 2>/dev/null | head -1)"
}

case "$1" in
    start)  start ;;
    stop)   stop ;;
    status) status ;;
    *) echo "usage: $0 {start|stop|status}"; exit 1 ;;
esac
