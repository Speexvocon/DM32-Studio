# DM32 unified browser CPS

This is the primary programming interface for the custom DM32 P25/DMR/FM firmware.
Open the hosted [DM32 Studio](https://speexvocon.github.io/DM32-Studio/) in desktop
Chrome or Edge, or serve this folder locally as described below. Matching beta
images and installation tools are in [DM32-Multimode](https://github.com/Speexvocon/DM32-Multimode).
The owner selected the RadioFoundry-style browser editor instead of continuing
CHIRP integration. The existing CHIRP module and its historical download evidence
remain in the repository; they are not required to use this editor.

## Start locally

From the repository root:

```powershell
python scripts/serve-web-cps.py
```

Open **http://127.0.0.1:8765/** in Chrome or Edge. The server listens on loopback
and serves this folder only. It has no serial, firmware-write or upload API;
Web Serial connects directly from the browser after you click Connect. Localhost
is a secure context for Web Serial. Nothing is sent to a remote service and no
additional JavaScript packages or CDN are needed.

The editor works offline with a sample codeplug or saved JSON file. Protocol 1 supports P25/FM, protocol 2 adds DMR, protocol 3 adds programmable power and radio functions, protocol 4 adds 256 channels, zones and independent scan definitions, protocol 5 adds the shared contact directory and individual P25 destinations, and protocol 6 adds named P25 trunking systems. The client identifies the connected firmware before reading or writing. A legacy upload is allowed only when every new power/function field retains its reserved zero default; DMR cannot be uploaded to protocol 1. Unsupported edits are refused before a transaction starts. Editing a field does not install firmware or establish RF qualification.

## Program the radio

1. Power on normally, release PTT, connect the programming cable and close other
   applications using COM8. The radio remains on its normal application firmware.
2. Click **Connect** and select the programming cable. This identifies the custom
   firmware; it does not grant permission to overwrite settings.
3. Click **Read radio**. This obtains a complete revision/CRC-qualified snapshot.
   Save a codeplug file before changing it.
4. Edit channels, VFO A/B, zones, scan lists, trunking systems, radio settings or the separate **Functions** tab. To apply an offline file,
   read the radio first, then open the file; file metadata alone never qualifies
   a write. Editing, importing and loading a sample never write the radio.
5. Review **Problems** and resolve errors. Click **Review & write**, review the
   proposed changes, then explicitly start the transfer. The firmware stages the
   complete snapshot and publishes it after validation and CRC verification.
6. After a first real upload, read the configuration back and confirm the values
   survive a normal power-off/restart. Browser and simulated-parser checks alone
   do not establish a hardware upload pass.

The firmware pauses reception and PTT during programming. An idle read link
expires after three seconds; abandoned staging expires after 60 seconds.
If the radio changed since the read, the write is refused. If a commit reply is
lost, the outcome is uncertain: reconnect and read again before another write.
The client never repeats a commit automatically.

## Trunking and applets

New Studio drafts use V6, with eight named P25 trunking systems. Existing files
and radio reads retain their actual schema until explicitly upgraded. The
**Trunking** tab configures receive-only or experimental Phase 1 subscriber
systems, control-channel alternatives, exact identities, radio ID/talkgroup and
start-at-boot. Leave **Do not affiliate (receive only)** checked to follow calls
without registration, affiliation or trunked transmission; new systems default
to this setting. See the [step-by-step trunking guide](TRUNKING.md). Registration,
affiliation, granted group voice and talkgroup following have worked in the lab;
precise RF access-slot timing and broader system interoperability remain open.

The **Applets** tab lists eight installed slots, shows execution status, validates
local `.dapp` packages, and offers reviewed installation, replacement, start,
stop and removal. Install does not run the package. It can connect directly to
the APP service without a codeplug takeover or automatic command. Applets share
the same cable and serial arbiter; stop and return to programming before reading
or writing a codeplug or using messages. Local edits and drafts stay in Studio.
After applet management a fresh radio read is required before programming.

Packages are separate from codeplug JSON. The current firmware cannot export
installed package bytes, so retain the source and package files. There is no
automatic format of foreign applet storage and no automatic retry of uncertain
commits. Script permissions cover SAME reception, serial/display text and keys;
native RAW/VOICE PCM sessions are a separate service.

See [Applet instructions](applets/README.md), [AI agent builder instructions](applets/AGENT_GUIDE.md),
and the [offline builder kit](applets/applet-builder.zip). Counter and SAME Watch
source/packages are included. Kit generation is reproducible with
`python scripts/package-applet-builder.py` from the source repository; its
`--check` option refuses stale outputs without writing anything.

## Current fields

- **Trunking** on V6 stores up to eight named P25 Phase 1 systems, each with a
  primary control and up to seven alternates, exact network/site identities,
  an optional radio ID override and selected talkgroup. The **Do not affiliate
  (receive only)** checkbox blocks registration, affiliation and trunked PTT
  while allowing passive following. Uncheck it for experimental subscriber
  operation. Startup is off after migration;
  selecting a system does not start it. The separate start-at-boot option is
  deliberate. Subscriber RF qualification, Phase 2 and encrypted voice are not
  implied by these settings. Complete JSON backups retain the system table;
  older radio uploads refuse the larger format before a transaction begins.
  The radio tries the primary first, then alternates in order. Empty channels
  can be skipped after 450 ms; genuine P25 evidence extends the ordinary
  three-second acquisition window up to 12 seconds. Valid control traffic keeps
  a qualified lock alive, with a separate 30-second site/network identity limit.
  Only fresh metadata for the exact saved site locks a candidate; this is
  recovery within that site, not roaming. Receive-only systems retry receive
  setup faults and recorder gaps without enabling subscriber operation. Calls
  and subscriber requests hold the current receiver. While attached and idle, OK offers
  Resume, Log out and stop, or Stop now. Logout is sent without a network
  acknowledgment and falls back to a local stop if the bounded attempt fails.

- **Channel mode** recalls one of 256 named channel memories on V4 firmware (32 on legacy firmware). **Frequency mode** uses an editable VFO A/B profile. The two sides share one RF receiver; choose the active side and each side's starting mode in Radio settings.
- P25, DMR, narrow FM and wide FM, independent RX/TX frequencies and receive-only. DMR requires the unified V2 firmware.
- P25 NAC, group/individual call selection and PROM/NAC/NAC+destination filtering per channel. Individual P25 destinations use the full 24-bit radio ID; the separate 16-bit group talkgroup is retained when switching call type. Individual settings require V5.
- DMR 24-bit destination, group/private calls, color code, timeslot and direct/repeater framing. The global source ID is shared by both digital modes.
- DMR CC/all destinations, CC+destination or PROM on the selected timeslot. PROM does not monitor both slots or decode encrypted voice.
- Independent analog RX/TX CTCSS or normal/inverse DCS and squelch.
- Nine calibrated power levels per memory/VFO, from L− through H. These are hardware levels, not a claim of measured watts.
- Radio ID, shared P25/DMR microphone gain, active A/B selections and scan list.
- **Functions → Transmit:** a 15–600-second time-out timer (TOT), default 30 seconds, and optional owner TX inhibit.
- **Functions → Programmable buttons:** independent P1, P2, SK1 and SK2 choices for no action, Frequency / Channel, A/B, scan, power cycling, FM broadcast, status, keypad lock or Last heard (V5). Assign **Frequency / Channel** to SK1 or SK2 for a side-key mode switch, or **Last heard** to open recent calls. Default shortcuts are P1 = Frequency / Channel, P2 = status, SK1 = FM broadcast and SK2 = A/B.
- **Functions → FM broadcast:** a receive-only tuner frequency from 65–108 MHz in 0.05-MHz steps, default 87.500 MHz. This is separate from two-way FM channels and never enables broadcast-band transmission.
- **Functions → Display & keypad:** independent screen/keypad-light timeouts. Zero keeps a light on; reception wakes the screen.

Names hold 12 printable ASCII characters. Frequencies are entered as MHz, NACs
as three hexadecimal digits, CTCSS in Hz and DCS in octal. Adjustable microphone
gain applies to P25 and DMR; analog FM retains its native gain. A/B share one RF receiver.
New directory and individual-call controls require the matching firmware iteration. Browser checks verify their editing and wire representation; they do not establish RF interoperability.

### Contacts and local names

**Contacts** stores up to 96 entries with names of up to 24 printable ASCII
characters. Select P25, DMR or Both, then Individual radio or Talkgroup and its
decimal ID. Individual IDs and DMR groups allow 1–16777215; P25 and shared groups
allow 1–65535. Both is useful only when the ID means the same thing in both
protocols. Unit and group IDs have separate namespaces. Overlapping duplicates
within a protocol are rejected.

Names are local lookup labels for received calls and last heard, not transmitted
talker aliases. Channel/VFO address tooltips show matching names. Changing or
deleting a contact never changes a channel destination ID. Contact-only writes
appear in **Review & write** with their old and new values.

**Export contacts CSV** creates the exact `contact,protocol,type,id,name` header;
`contact` is the one-based directory slot. **Import contacts CSV** updates only
listed slots in a clone. Missing slots remain unchanged, and an invalid or
overlapping duplicate entry rejects the complete import. JSON remains the full
backup for the directory, channels and other settings.

### Text messaging

Open **Messages** and choose **Connect for messages**, or **Refresh messages** on
an existing connection. These service commands keep normal radio listening
active; they do not open a codeplug programming transaction. Older firmware
without the service keeps local draft editing available and leaves Send disabled.
A legacy unknown-command TRANSACTION response is checked with read-only service
discovery; the CPS never aborts an active programming transaction to open messages.

The radio stores up to 16 combined inbox/outbox entries in RAM. Messages disappear
when the radio restarts. **Save mailbox file** exports the currently read text
and metadata to a local JSON archive; it never queues a transmission. Refresh
retrieves the latest received text and outgoing status. Contacts label matching
protocol and individual/group identities; received text is always displayed
literally. **Mark read**, **Reply** and **Delete** act on
a stable radio message ID. A reply addresses the original sender as an individual
radio, including when the incoming message was addressed to a group. Long received
DMR text is visibly marked when only the first 80 characters were retained.

Compose up to 80 printable ASCII characters on one line. P25 uses individual
Motorola TMS packet messaging with a 24-bit destination radio ID; voice talkgroups
are not messaging addresses. DMR supports individual/group destinations and the
receiving radio's Motorola TMS, ETSI text, or ETSI IP text format. ETSI IP is the
DMR default. Acknowledgment requests are available only for individual DMR TMS or
ETSI messages. The application limit does not describe either standard's maximum.

**Send message** shows the destination, protocol, format and text for review.
Only confirmation queues an RF transmission, using the radio's currently selected
channel, source ID, power and transmit permissions. **Queued** and **Sending** are
progress states. **Sent · delivery unconfirmed** means transmission completed;
**Delivered** is reserved for a confirmed destination acknowledgment. Failed
messages remain in the outbox. Refresh reads status without retransmitting. A
lost Send acknowledgment never causes an automatic retry: reconnect and find the
reported token in the outbox before deciding whether to send another copy.

**Save draft file** and **Open draft** exchange separate JSON message drafts.
Unsaved drafts last for the current browser session and are excluded from the
codeplug. Saving or editing a draft never transmits it. Radio messages require
compatible firmware and receiving radios; RF interoperability remains a separate
hardware qualification step.

The Frequency / Channel button action keeps its existing numeric ID `2`.
This terminology update does not change the record layout, protocol or saved JSON
keys: older codeplugs with the former VFO / memory action import without changes.

## Files, compatibility and provenance

New drafts use the version-6 `DM32P25-CPS` envelope with 499 canonical records
(15,968 bytes), including named trunking systems, CRC and origin metadata.
V5 files retain 483 records (15,456 bytes), contacts and individual destinations.
V4 files retain their
387 records (12,384 bytes). The client pins the
radio's HELLO version and channel geometry for the entire connection. Legacy
V1/V2/V3 files and radios remain supported with exactly 35 records; opening a
legacy file does not change its payload bytes or CRC. Click **Upgrade codeplug**
explicitly to expand a legacy working copy and convert its four membership bits
into Scan 1–4 with Last heard reply, matching the firmware's migration projection. Save an original file for any
legacy radios: newer data is never truncated to fit old firmware, and legacy drafts
must be explicitly upgraded before writing to newer firmware. The current
**Upgrade codeplug** action targets V6: it retains existing contacts and
individual destinations, adds empty trunking systems, and leaves startup off.
Upgrading a V4 file also adds contact slots and group/individual fields while
retaining its channels, zones and lists. Unknown future
versions are refused.

V1/V2 reserved fields remain zero defaults: 30-second TOT, default button
shortcuts, lowest power and 87.500-MHz broadcast reception. Origin metadata from
a file cannot substitute for reading the connected radio. Undo/redo operates on
the working draft, not the device.

### Zones and two scan types

V4 has **16 named zones** and **16 named scan lists**. Zones select which saved
channels are available to each side; zero means All channels. Select the side's
zone and its starting memory in Radio settings. A selected memory must belong
to that zone. Zone membership follows global channel order.

**Channel scan (CH SCAN)** visits the selected channel configurations. Compatible
co-channel P25 memories share continuous acquisition. **P25 talkgroup scan
(TG SCAN)** stays on one occupied P25 base channel's receive frequency/NAC and
accepts a separate list of up to 64 unique decimal talkgroups. It does not need
duplicate channel memories and enforces its TG list independently of the base
channel's normal receive filter. Encrypted and unsupported calls remain muted.
Each list has a 12-character name, 100–5000-ms channel dwell, 0–10000-ms post-call
hold and a reply policy: Selected/base channel, Last heard, or Fixed reply
channel. Last-heard TG replies are temporary and do not rewrite saved TX TGs.
Empty named lists can be saved but cannot start scanning.

### Bulk editing and channel CSV

**Bulk edit** applies one field to all selected memories atomically. An invalid
or incompatible mode field refuses the entire edit. **Move** moves the selected
record to a channel number, shifts intervening records and rewrites every zone,
scan membership, base-channel, fixed-reply and side-selection reference to follow
the original channel identity. Clearing a channel removes memberships and side
selections; a TG list losing its base is removed, and a fixed reply losing its
channel reverts to Selected. These changes remain part of the reviewed draft.

**Export CSV** produces the exact header required by **Import CSV**. CSV contains
channel records only; JSON remains the complete backup for zones, lists and radio
settings. Channel numbers are one-based, frequencies are integer Hz, NAC is
decimal, booleans are `true`/`false`, CTCSS values are integer tenths of Hz, and DCS
values are decimal wire codes. Tone type names are `none`, `ctcss`, `dcs` and
`dcs-inv`; filter names are `NAC`, `PROM` and `NAC+TG`. Legacy `scanLists` CSV cells
use semicolon-separated zero-based list IDs. V4 cells are empty because membership
lives in separate scan definitions. Unused mode-specific columns must be empty.

CSV import replaces only listed slots in a clone, preserving absent records and
all other configuration. Duplicate slots, malformed values and broken references
refuse the complete import without partial changes. Review the changes before
writing; imports never connect or upload automatically.

This is a P25-aware adaptation of RadioFoundry's editor approach, with our existing
logical transport and atomic storage. RadioFoundry's stock web editor, its binary
codeplug files and qdmr transport are not interchangeable with this firmware.
See [upstream provenance](UPSTREAM.md) and the
[logical protocol specification](./CPS_PROTOCOL.md). The codeplug protocol
has no program-flash, bootloader, calibration or raw-address commands. The
separate message service can explicitly transmit reviewed text. The separate
**Firmware** page uses the factory updater and a pinned RAM reader; see
[browser installation](firmware-assets/3cbd328/README.md). Its file and serial sessions do not
share an open CPS programming connection. CLI installation and recovery tools
remain available.

The newer **RF-B / DM32.NRFB.01.050** radios are currently incompatible with
multimode firmware; support is planned. The Firmware page provides a separate
**Backup / full dump only** mode so owners can save matching reads of the full
1 MiB program and 16 MiB data flash, download a ZIP, and send it privately to the
maintainer. No supported codec is needed to create this diagnostic dump, and no
upload occurs. See [dump and sharing instructions](firmware-assets/3cbd328/README.md#save-a-full-dump-to-send-privately).

## Checks

```powershell
./scripts/test-web-cps.ps1
```

This builds the real application parser/store behind the existing host HAL,
then runs the browser codec/client through both fake serial streams and that
actual C implementation. The bridge never opens a serial port. It checks mixed
P25/DMR/FM fields, atomic reboot retention, revision/CRC guards and uncertain commit
handling. Pure JavaScript tests can also run with `node --test` inside this folder;
the actual-C bridge cases require the library built by the PowerShell script.

First physical browser read/write and FM/mixed-scan observations remain separate
from offline and browser preview checks. Extended RF soak/repeat qualification is
still deferred at the owner's request.

Optional desktop-browser checks, using an already installed Chrome or Edge:

```powershell
# Leave the local server running in another terminal.
python scripts/serve-web-cps.py
# In the second terminal, from the repository root:
node tests/web_cps_browser.mjs
node tests/web_cps_calls_browser.mjs
$env:CPS_URL = 'http://127.0.0.1:8765/'
node tests/web_cps_applets_browser.mjs
```

This launches its own hidden headless browser and injects a simulated Web Serial
peer before loading the editor. It never opens a real programming cable. It
checks local file round trips, form edits, reviewed uploads, stale revisions and
lost commit acknowledgements, and captures desktop/mobile screenshots under
`build/web-cps-browser-qa`. Set `CHROME_PATH` if the installed browser is not found
automatically; no browser package is downloaded. `CPS_URL` may select another
loopback server address.

The call UI suite captures `build/web-cps-calls-browser-qa` and exercises scoped
contact names, atomic CSV imports, literal markup handling, independent P25
individual destinations, offline drafts, live inbox/outbox/reply, explicit text-send review, and reviewed directory writes.

The applet UI suite checks local package loading, explicit reviews, shared-port
handoff, reconnecting to a running VM, read-only storage, unsupported firmware,
unplugged confirmations, and desktop/mobile layout using simulated serial only.

For maintainers, `scripts/export-web-cps.py` exports an exact committed revision
to a reviewed staging folder. Supply separate firmware revision/version values;
browser changes do not change the identity of an already built application.
The export versions module dependencies, preserves pinned loader bytes and writes
`deployment.json` with hashes for the complete public asset set. Validate that
exact export before pushing it to the Studio repository.

## Sharing the CPS and firmware installer

The public CPS and `firmware.html` include static Open Graph and X Card metadata,
with separate 1200 × 630 PNG previews under `social/`. Pasting the public page URL
into a service with link previews enabled lets its crawler read the title,
description and image without running the editor or opening a serial connection.
Preview appearance and caching are controlled by the receiving service.

When changing the advertised beta release, update the version, description and
image URL in `firmware.html`, then regenerate the matching card:

```powershell
# Requires Pillow; generated PNGs are committed so deployment needs no renderer.
python scripts/render-cps-share-cards.py --firmware-version 0.3.0-beta.1
```

Use a new image filename when changing artwork so cached shares can fetch the new
asset. The committed export includes these images in `deployment.json` hashes.
