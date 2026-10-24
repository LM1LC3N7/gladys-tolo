# TOLO for Gladys

This integration shows a **TOLO steam generator or sauna with its App Box** in
Gladys, on the local network (UDP, port 51500), with no account and no
cloud. **Never tested with a real device.** Not affiliated with TOLO.

> **Safety.** A steam room or a sauna heats. Never start heating from afar
> without making sure nobody is inside. Turning on from Gladys is **off by
> default**; turning off is held back by no option and no command in
> progress.

## What you get

One device in the Discovery tab, with:

- **Heating on** (yes/no, read only) and the **status** as text ("Off",
  "Heating", "Keeping warm", "On, not heating");
- measured **temperature** and **humidity**, the **setpoint**;
- **time left** (minutes) on the timer;
- **water level** (0, 33, 66 or 100 %) and **tank temperature**;
- **lamp** (on/off) and **fan** (on/off): they heat nothing;
- two buttons: **Turn on (heat)** and **Turn off**.

Heating has no switch: an "everything on" from Google Home, Alexa, HomeKit,
MCP or a scene cannot start it. It may turn the lamp or the fan on.

## Setup

1. Give the App Box a **fixed address** in your router (a fixed DHCP lease).
2. In Gladys, open the TOLO integration and enter that **IP address** (IPv4,
   for instance 192.168.1.50). Refused: a name, broadcast addresses
   (including any address ending in .255), multicast, loopback, 0.x.x.x and
   169.254.x.x.
3. Save, then add the device from the **Discovery** tab (it shows up after
   the first successful read).
4. To start heating from Gladys, turn on **Allow heating from Gladys**, and
   set the **session duration** (30 min by default, 1 to 60 min, the limit
   of the App Box) and the **highest setpoint** (50 °C by default, 35 to
   60 °C, the range of the App Box).

The App Box is read every 30 s (10 s to 1 h), never more often, even after a
restart of the integration, a reconnection to Gladys, the "Test the
connection" button or a Discovery scan. After a command, two follow-up reads
go 5 s and 20 s later.

The protocol gives no serial number nor MAC address: the device is "the App
Box answering at the configured address". Changing the address keeps the
same device in Gladys.

## The commands

### Turn off

It is held back neither by the option, nor by a command in progress, nor by
a read in progress, nor by an App Box that stopped answering, and it also
goes right after a restart, before the first read. It is always sent (never
"already off") and, while the App Box stays silent, sent again up to 4 times
(400 ms apart). It cancels a turn on that has not left yet; if a turn on had
already left, it is sent again when that turn on settles.

It is confirmed only by a read showing the App Box off. Otherwise: "Sent,
without confirmation", and for 2 minutes every read that sees the App Box on
sends the turn off again (3 times at most). This guard is kept in `/data`
and survives a restart. It may also turn off heating started from the App
Box or the TOLO app within those 2 minutes: on purpose. During the guard, a
turn on from Gladys is refused.

It fails ("Not sent") only when no datagram could leave (for instance the
network is unreachable from the container), or when no valid address is
configured.

### Turn on (heat)

It is refused, nothing sent, in these cases:

- "Allow heating from Gladys" is off (checked on arrival, after the read,
  then right before every datagram);
- a turn off is in flight, not confirmed yet (its guard), or asked during
  the turn on;
- another turn on is in progress, or the previous one is not confirmed yet
  (2 minutes at most);
- the App Box does not answer the fresh read (status and settings) within
  1.5 s, or its power state is unreadable;
- the timer or the setpoint could not be set and read back;
- the configuration (address) changed meanwhile;
- the turn on cannot leave within 3.5 s of the click.

Steps: a fresh read of the status and the settings (never the state in
memory); already on: nothing sent; otherwise the **timer** of the App Box is
set to the session duration (never "no timer") and a setpoint above the
highest one is **lowered** to it, both read back; only then does the turn on
leave. It is confirmed only by a read showing the App Box on; otherwise
"Sent, without confirmation". A read of less than 10 s showing the App Box
already on is enough to send nothing (a scene pressing in a loop does not
query the App Box each time).

The bounded timer covers sessions started from Gladys: if someone then
removes the timer on the App Box, the integration does not set it back.

### Setpoint

Refused when the option is off, when the value is not a whole number from
35 °C to the highest setpoint (checked again right before the datagram), or
when another setpoint is in progress. Changing the setpoint does not turn
the App Box on. Confirmed by a read of the settings.

### Lamp and fan

Plain on/off (0 or 1), one command at a time each, confirmed by a read.

## Troubleshooting

- **The App Box does not answer**: the status says so, the device is shown
  unreachable, next try after 30 s, 1, 2 then 5 min (never faster than the
  interval). Turning off is still sent.
- Only answers from **the address and port of the App Box**, well formed
  (prefix, suffix, checksum, length) and of the command sent are taken;
  every exchange has its own socket, so a late answer of an earlier exchange
  is never taken for another one's.
- The container must reach the App Box in UDP (Docker bridge network:
  unicast traffic normally goes out to the local network).

## Limits

- **Protocol not documented** by TOLO: the integration follows the
  open-source tololib library, written by observing the App Box. A firmware
  may change it.
- No automatic discovery: the address is typed by hand.
- No humidity setpoint, aroma therapy, salt bath, sweep nor fan timer yet.
- One App Box per integration.

## Data

`/data/tolo-state.json` holds only the time of the last read and the guard
of a turn off in progress (App Box address, end time, number of resends).
No secret exists in this integration.

Based on the tololib Python library (MIT, Matthias Lohr), ported to
JavaScript: see `THIRD_PARTY_NOTICES.md`.
