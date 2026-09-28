#!/bin/sh
# ============================================================================
# Q11 Freedom - per-device "pause internet" (block by MAC address).
#
# Rebuilds the iptables chain `freedom_block` from uci (freedom.blk_*) and
# hooks it at the top of FORWARD. Runs on the MASTER: all internet-bound
# traffic from the WHOLE mesh goes through it, so a block here applies to
# devices connected to any node.
#
# Idempotent. Called by: freedom-api.sh (on block/unblock),
# /etc/firewall.user (on every firewall reload) and freedom-boot.
# ============================================================================
CHAIN=freedom_block

iptables -N "$CHAIN" 2>/dev/null
iptables -F "$CHAIN"

for sec in $(uci -q show freedom | sed -n "s/^freedom\.\(blk_[^.=]*\)=block$/\1/p"); do
    mac=$(uci -q get "freedom.$sec.mac")
    case "$mac" in
        [0-9A-Fa-f][0-9A-Fa-f]:*) iptables -A "$CHAIN" -m mac --mac-source "$mac" -j DROP ;;
    esac
done

# first position in FORWARD -> also cuts connections that are already established
iptables -C FORWARD -j "$CHAIN" 2>/dev/null || iptables -I FORWARD 1 -j "$CHAIN"
exit 0
