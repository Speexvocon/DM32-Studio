# DM32 Studio

Browser programming for DM32-Multimode P25, DMR and analog FM firmware.

**Open the CPS: https://speexvocon.github.io/DM32-Studio/**

Use desktop Chrome or Edge with a programming cable and the custom firmware's logical CPS protocol (versions 1–5). The browser asks which serial port to use when you click **Connect**. You do not need to run a local server for the hosted version.

V4 and V5 support **256 channels, 16 named zones and 16 named scan lists**. V5 adds **96 named contacts** and P25 individual destinations. Legacy V1–V3 firmware and files retain their 32-channel, 35-record format. New features require matching firmware; updating this website does not install firmware.

## Programming

1. Power the radio on normally, release PTT, connect the programming cable, and close other programs using that port.
2. Click **Connect**, select the cable, then **Read radio**.
3. Save a codeplug file before editing. Set your own frequencies and radio ID; demo data uses radio ID 1.
4. Edit channels, Frequency A/B, zones, scan lists, contacts, radio settings and functions. In Functions, assign **Frequency / Channel** to SK1 or SK2; Radio settings selects each side's zone and whether it starts on its own frequency or a saved channel.
5. Use **Review & write** to review the changes before explicitly applying them.

Editing a field or opening a saved file does not write the radio. A read establishes the current revision and checksum before a write. Features unsupported by older firmware are refused before programming starts. Firmware installation and recovery are separate from this CPS.

## Channels, zones and scanning

- **Zones** organize saved channels for selection. Channel order inside a zone follows global memory order.
- **Channel scan / CH SCAN** visits the selected P25, DMR and FM channels. Compatible co-channel P25 entries retain continuous acquisition.
- **P25 talkgroup scan / TG SCAN** stays on one P25 base channel's receive frequency and NAC, accepting an independent list of up to 64 talkgroups. Duplicate channel memories are unnecessary. Encrypted and unsupported calls remain muted.
- Each scan list has a name, channel dwell, post-call hold and a reply policy: Selected/base, Last heard or Fixed channel. Last-heard TG replies are temporary and preserve saved transmit talkgroups.
- **Bulk edit** changes a field across selected channels. **Move** shifts a channel and keeps zone, scan and reply references attached to their channel records.

## Contacts and messaging


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

## Files and compatibility

New drafts use the complete V5 JSON codeplug format. V5 contains 483 records; V4 retains 387. V1–V4 files remain supported. Upgrade explicitly to add V5 contacts and individual destinations; save an original file for older firmware. Reading an older radio or opening a legacy file keeps its original geometry and payload; use **Upgrade codeplug** explicitly to expand that working copy. Migration preserves channel settings and converts the four old scan memberships into Scan 1–4 with Last heard reply. Newer codeplugs cannot be silently truncated onto older firmware. Save the original file if you still use a legacy radio.

**Export CSV / Import CSV** handle channel rows only; JSON is the complete backup for zones, scan lists and radio settings. Start with the exported header. Frequencies use integer Hz, NAC uses decimal, booleans use `true`/`false`, CTCSS uses integer tenths of Hz and DCS uses decimal wire codes. CSV import replaces listed slots in a local draft, preserving absent rows and other settings. Invalid values or broken references refuse the whole import. Use Review & write to apply changes.

If a transfer loses its commit acknowledgement, its result is uncertain. Disconnect, reconnect and read the radio before another write. The client never retries a commit automatically.

## Browser firmware installer (experimental)

Open **[Firmware](https://speexvocon.github.io/DM32-Studio/firmware.html)**, or use
Studio's Firmware button. Use desktop Chrome or Edge over HTTPS or localhost.
The full flow can make a sealed two-read original backup, prepare the native codec
locally from that backup, check protected regions, install through BFUV32-V2 and
perform a fresh independent readback. It also accepts existing sealed backups and
private Python-prepared packages with their matching release. Select a release
folder downloaded from the trusted beta repository; application firmware and
native codec bytes are not hosted here.

RF-B / `DM32.NRFB.01.050` radios are currently incompatible; support is planned.
Use [backup-only mode](https://speexvocon.github.io/DM32-Studio/firmware.html?backup=1)
to read the complete 1 MiB program and 16 MiB data flash twice, then download a
full dump ZIP to send privately to the maintainer. No recognized codec or
calibration layout is needed to save this diagnostic dump.

Backups and private packages stay on your computer. Save them before installing.
File selection and model identification cannot erase the radio; Review & install
requires separate confirmation after preparation and preservation checks. Transfer
completion is shown separately from independent verification. Keep the CLI
installer/recovery tools available. Physical browser flashing has not yet been
qualified; the browser installer is experimental.

See [the complete browser instructions](firmware-assets/d5e2134/README.md). The
versioned runtime directory keeps the entire module graph immutable, including
RadioFoundry's byte-identical MIT transport modules and checked RAM reader.

## Privacy and hosting

The host serves the application files. Radio communication goes directly between your browser and the programming cable using Web Serial. Codeplugs stay in browser memory; saving downloads a local JSON file. There is no application backend, account, analytics, cloud codeplug storage, or remote runtime dependency.

The public website and its JavaScript source are readable by anyone. This repository contains only the CPS, documentation and license notices. Application firmware images, native codec files, personal codeplugs and radio backups are distributed or stored separately.

## Development

These unbundled HTML, CSS and JavaScript files are the complete application source. Serve this directory over HTTPS or localhost; for a local preview, run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/`.

GitHub Pages publishes the root of `main`. `.nojekyll` keeps the deployment static. Push reviewed CPS changes to `main` to update the site without reflashing firmware. `deployment.json` records the source revision, export adjustments and runtime asset checksums. Versioned asset URLs prevent a cached older module from mixing with this release. The underlying firmware candidate passed host and target CI; this standalone export is also checked in a browser with simulated serial access.

## License and provenance

Project-authored CPS files (`app.js`, `model.js`, `transport.js`, `call-tools.js`, `index.html` and `styles.css`) are licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE). The adapted RadioFoundry undo helper retains its **MIT** license in [vendor/LICENSE.RadioFoundry](vendor/LICENSE.RadioFoundry). See [UPSTREAM.md](UPSTREAM.md) for the pinned upstream reference and attribution.
