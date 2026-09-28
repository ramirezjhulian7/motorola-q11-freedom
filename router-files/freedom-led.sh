#!/bin/sh
# ============================================================================
# Q11 Freedom - status LED driven by internet connectivity.
#   Solid GREEN = internet is reachable (the WAN reaches the outside)
#   Solid RED   = no internet
#
# Why it exists: without Minim, the factory LED script (/sbin/update_leds.sh)
# stays in "agent_down" = BLINKING BLUE ("looking for the cloud"). We replace it
# with a useful internet indicator. Runs as a daemon (freedom-led init), checks
# every CHECK_INTERVAL seconds and only rewrites the LED when the state changes.
# The LEDs accept graded brightness (PWM 0-255), so exact colors are possible.
# ============================================================================

# "Internet OK" color: pure green (R=0, G=255, B=0)
OK_R=0;  OK_G=255; OK_B=0

CHECK_INTERVAL=30
PING_HOSTS="8.8.8.8 1.1.1.1"   # if any of them answers, there is internet

# kill the factory LED daemon so it doesn't fight over the LED
stop_factory_leds() {
    [ -x /etc/init.d/update_leds ] && /etc/init.d/update_leds stop 2>/dev/null
    for p in $(ps 2>/dev/null | grep -v grep | grep update_leds.sh | awk '{print $1}'); do
        kill "$p" 2>/dev/null
    done
}

set_led() {  # $1 = ok (green) | down (red)
    for c in blue green red; do
        [ -e "/sys/class/leds/led_$c/trigger" ] && echo none > "/sys/class/leds/led_$c/trigger" 2>/dev/null
    done
    if [ "$1" = "ok" ]; then
        echo "$OK_R" > /sys/class/leds/led_red/brightness   2>/dev/null
        echo "$OK_G" > /sys/class/leds/led_green/brightness 2>/dev/null
        echo "$OK_B" > /sys/class/leds/led_blue/brightness  2>/dev/null
    else
        echo 255 > /sys/class/leds/led_red/brightness   2>/dev/null
        echo 0   > /sys/class/leds/led_green/brightness 2>/dev/null
        echo 0   > /sys/class/leds/led_blue/brightness  2>/dev/null
    fi
}

has_internet() {
    for h in $PING_HOSTS; do
        ping -c1 -W2 "$h" >/dev/null 2>&1 && return 0
    done
    return 1
}

stop_factory_leds

prev=""
while true; do
    if has_internet; then now=ok; else now=down; fi
    # shared state: the API (freedom-api.sh status) reads it without pinging
    echo "$now" > /tmp/freedom-internet
    [ "$now" != "$prev" ] && { set_led "$now"; prev="$now"; }
    sleep "$CHECK_INTERVAL"
done
