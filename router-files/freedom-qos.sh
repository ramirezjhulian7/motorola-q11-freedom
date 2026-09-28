#!/bin/sh
# ============================================================================
# Q11 Freedom - per-device speed limit using tc HTB on br-lan.
# Usage: freedom-qos.sh <ip> <down_kbit>     (down_kbit=0 removes the limit)
#
# Download shaping = egress on br-lan (traffic leaving the router toward the
# LAN client). Each client IP gets its own HTB class + u32 filter.
# Class id is derived from the last octet of the IP (2..254 -> 1:<octet>).
# ============================================================================
IFACE="br-lan"
IP="$1"
KBIT="$2"

[ -n "$IP" ] || { echo "usage: $0 <ip> <kbit>"; exit 1; }

# class id from last octet (unique per /24 client)
OCTET=${IP##*.}
CLASSID="1:$OCTET"
HANDLE="$OCTET:"

# ensure root qdisc exists (HTB). default class 1:9999 = unlimited.
ensure_root() {
  tc qdisc show dev "$IFACE" | grep -q "htb 1:" || {
    tc qdisc add dev "$IFACE" root handle 1: htb default 9999
    tc class add dev "$IFACE" parent 1: classid 1:9999 htb rate 1000mbit
  }
}

remove_one() {
  # delete filter + class for this IP if present (ignore errors)
  tc filter del dev "$IFACE" protocol ip parent 1: prio 1 \
     u32 match ip dst "$IP/32" flowid "$CLASSID" 2>/dev/null
  tc qdisc del dev "$IFACE" parent "$CLASSID" handle "$HANDLE" 2>/dev/null
  tc class del dev "$IFACE" classid "$CLASSID" 2>/dev/null
}

if [ "${KBIT:-0}" -le 0 ] 2>/dev/null; then
  remove_one
  exit 0
fi

ensure_root
remove_one   # clear any previous limit for this IP first

tc class add dev "$IFACE" parent 1: classid "$CLASSID" htb \
   rate "${KBIT}kbit" ceil "${KBIT}kbit" burst 15k
tc qdisc add dev "$IFACE" parent "$CLASSID" handle "$HANDLE" sfq perturb 10
tc filter add dev "$IFACE" protocol ip parent 1: prio 1 \
   u32 match ip dst "$IP/32" flowid "$CLASSID"
