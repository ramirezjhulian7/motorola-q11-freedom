#!/bin/sh
# ============================================================================
# Q11 Freedom - applies the node ROLE (master / slave). Idempotent.
#
# Called by:  freedom-boot (on EVERY boot -> the role survives power cuts)
#             freedom-api.sh join_mesh (when the master adopts this node)
#             provision.sh (during provisioning)
#
# The role lives in /etc/config/freedom:
#   freedom.node.role        master | slave
#   freedom.mesh.master_ip   IP of the master (slaves only)
#   freedom.node.wan_if      original WAN port, saved when it is moved into the bridge
#
# MASTER: DHCP/DNS server, normal WAN toward the modem/ISP.
# SLAVE:  pure bridge. DHCP OFF, STP ON, and its WAN port joins the bridge so
#         BOTH ports are LAN (plug the master's cable into either one and use
#         the other for a device or to daisy-chain the next node).
#         Gateway/DNS = master, so the slave itself has internet (LED, NTP).
#
# Only reloads network/dnsmasq if something changed, to avoid dropping
# connections for nothing.
# ============================================================================

ROLE=$(uci -q get freedom.node.role)
[ -n "$ROLE" ] || exit 0

dhcp_changed=0
net_changed=0

list_has() {  # list_has "<space-separated list>" <item>
    case " $1 " in *" $2 "*) return 0 ;; esac
    return 1
}

list_del() {  # list_del "<list>" <item>  -> prints the list without the item
    out=""
    for x in $1; do [ "$x" = "$2" ] || out="$out $x"; done
    echo $out
}

case "$ROLE" in
  master)
    if [ "$(uci -q get dhcp.lan.ignore)" = "1" ]; then
        uci -q delete dhcp.lan.ignore; dhcp_changed=1
    fi
    # If it used to be a slave, give the WAN port back to its interface
    WANIF=$(uci -q get freedom.node.wan_if)
    if [ -n "$WANIF" ]; then
        LANIFS=$(uci -q get network.lan.ifname)
        if list_has "$LANIFS" "$WANIF"; then
            uci set network.lan.ifname="$(list_del "$LANIFS" "$WANIF")"
            net_changed=1
        fi
        if [ "$(uci -q get network.wan.ifname)" != "$WANIF" ]; then
            uci set network.wan.ifname="$WANIF"; uci set network.wan.proto=dhcp
            net_changed=1
        fi
        uci -q delete freedom.node.wan_if; uci commit freedom
    fi
    # the master does not use a gateway/dns on the LAN (it gets them via WAN)
    [ -n "$(uci -q get network.lan.gateway)" ] && { uci -q delete network.lan.gateway; net_changed=1; }
    [ -n "$(uci -q get network.lan.dns)" ] && { uci -q delete network.lan.dns; net_changed=1; }
    ;;

  slave)
    MIP=$(uci -q get freedom.mesh.master_ip)

    [ "$(uci -q get dhcp.lan.ignore)" = "1" ] || { uci set dhcp.lan.ignore=1; dhcp_changed=1; }
    [ "$(uci -q get network.lan.stp)" = "1" ] || { uci set network.lan.stp=1; net_changed=1; }

    # WAN -> bridge (both ports become LAN)
    WANIF=$(uci -q get network.wan.ifname)
    if [ -n "$WANIF" ]; then
        uci set freedom.node.wan_if="$WANIF"; uci commit freedom
        uci -q delete network.wan.ifname
        uci set network.wan.proto=none
        net_changed=1
    fi
    WANIF=$(uci -q get freedom.node.wan_if)
    if [ -n "$WANIF" ]; then
        LANIFS=$(uci -q get network.lan.ifname)
        list_has "$LANIFS" "$WANIF" || { uci set network.lan.ifname="$LANIFS $WANIF"; net_changed=1; }
    fi

    # gateway and DNS through the master
    if [ -n "$MIP" ]; then
        [ "$(uci -q get network.lan.gateway)" = "$MIP" ] || { uci set network.lan.gateway="$MIP"; net_changed=1; }
        [ "$(uci -q get network.lan.dns)" = "$MIP" ] || { uci set network.lan.dns="$MIP"; net_changed=1; }
    fi
    ;;
esac

if [ "$dhcp_changed" = 1 ]; then
    uci commit dhcp
    /etc/init.d/dnsmasq restart >/dev/null 2>&1
fi
if [ "$net_changed" = 1 ]; then
    uci commit network
    /etc/init.d/network reload >/dev/null 2>&1
fi

logger -t freedom-role "role=$ROLE applied (dhcp_changed=$dhcp_changed net_changed=$net_changed)"
exit 0
