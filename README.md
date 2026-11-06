# DM32 Studio

Browser programming for DM32-Multimode P25, DMR and analog FM firmware.

**Open the CPS: https://speexvocon.github.io/DM32-Studio/**

Use desktop Chrome or Edge with a programming cable and the custom firmware's logical CPS protocol (versions 1–4). The browser asks which serial port to use when you click **Connect**. You do not need to run a local server for the hosted version.

V4 supports **256 channels, 16 named zones and 16 named scan lists**. Legacy V1–V3 firmware and files retain their 32-channel, 35-record format. Expanded features require V4 firmware; updating this website does not install firmware.

## Programming

1. Power the radio on normally, release PTT, connect the programming cable, and close other programs using that port.
2. Click **Connect**, select the cable, then **Read radio**.
3. Save a codeplug file before editing. Set your own frequencies and radio ID; demo data uses radio ID 1.
4. Edit channels, Frequency A/B, zones, scan lists, radio settings and functions. In Functions, assign **Frequency / Channel** to SK1 or SK2; Radio settings selects each side's zone and whether it starts on its own frequency or a saved channel.
5. Use **Review & write** to review the changes before explicitly applying them.

Editing a field or opening a saved file does not write the radio. A read establishes the current revision and checksum before a write. Features unsupported by older firmware are refused before programming starts. Firmware installation and recovery are separate from this CPS.

## Channels, zones and scanning

- **Zones** organize saved channels for selection. Channel order inside a zone follows global memory order.
- **Channel scan / CH SCAN** visits the selected P25, DMR and FM channels. Compatible co-channel P25 entries retain continuous acquisition.
- **P25 talkgroup scan / TG SCAN** stays on one P25 base channel's receive frequency and NAC, accepting an independent list of up to 64 talkgroups. Duplicate channel memories are unnecessary. Encrypted and unsupported calls remain muted.
- Each scan list has a name, channel dwell, post-call hold and a reply policy: Selected/base, Last heard or Fixed channel. Last-heard TG replies are temporary and preserve saved transmit talkgroups.
- **Bulk edit** changes a field across selected channels. **Move** shifts a channel and keeps zone, scan and reply references attached to their channel records.

## Files and compatibility

New drafts use the complete V4 JSON codeplug format. Reading an older radio or opening a legacy file keeps its original geometry and payload; use **Upgrade codeplug** explicitly to expand that working copy. Migration preserves channel settings and converts the four old scan memberships into Scan 1–4 with Last heard reply. V4 codeplugs cannot be silently truncated onto older firmware. Save the original file if you still use a legacy radio.

**Export CSV / Import CSV** handle channel rows only; JSON is the complete backup for zones, scan lists and radio settings. Start with the exported header. Frequencies use integer Hz, NAC uses decimal, booleans use `true`/`false`, CTCSS uses integer tenths of Hz and DCS uses decimal wire codes. CSV import replaces listed slots in a local draft, preserving absent rows and other settings. Invalid values or broken references refuse the whole import. Use Review & write to apply changes.

If a transfer loses its commit acknowledgement, its result is uncertain. Disconnect, reconnect and read the radio before another write. The client never retries a commit automatically.

## Privacy and hosting

The host serves the application files. Radio communication goes directly between your browser and the programming cable using Web Serial. Codeplugs stay in browser memory; saving downloads a local JSON file. There is no application backend, account, analytics, cloud codeplug storage, or third-party runtime dependency.

The public website and its JavaScript source are readable by anyone. This repository contains only the CPS, documentation and license notices. Firmware images, native codec files, personal codeplugs and radio backups are distributed or stored separately.

## Development

These unbundled HTML, CSS and JavaScript files are the complete application source. Serve this directory over HTTPS or localhost; for a local preview, run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/`.

GitHub Pages publishes the root of `main`. `.nojekyll` keeps the deployment static. Push reviewed CPS changes to `main` to update the site without reflashing firmware. `deployment.json` records the source revision and runtime asset checksums of the current export.

## License and provenance

Project-authored CPS files (`app.js`, `model.js`, `transport.js`, `index.html` and `styles.css`) are licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE). The adapted RadioFoundry undo helper retains its **MIT** license in [vendor/LICENSE.RadioFoundry](vendor/LICENSE.RadioFoundry). See [UPSTREAM.md](UPSTREAM.md) for the pinned upstream reference and attribution.
