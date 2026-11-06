# DM32 Studio

Browser programming for DM32-Multimode P25, DMR and analog FM firmware.

**Open the CPS: https://speexvocon.github.io/DM32-Studio/**

Use desktop Chrome or Edge with a programming cable and the custom firmware's logical CPS protocol (versions 1–3). The browser asks which serial port to use when you click **Connect**. You do not need to run a local server for the hosted version.

## Programming

1. Power the radio on normally, release PTT, connect the programming cable, and close other programs using that port.
2. Click **Connect**, select the cable, then **Read radio**.
3. Save a codeplug file before editing. Set your own frequencies and radio ID; demo data uses radio ID 1.
4. Edit channels, Frequency A/B, scan lists, radio settings and functions. In Functions, assign **Frequency / Channel** to SK1 or SK2; Radio settings selects whether each side starts on its own frequency or a saved channel.
5. Use **Review & write** to review the changes before explicitly applying them.

Editing a field or opening a saved file does not write the radio. A read establishes the current revision and checksum before a write. Features unsupported by older firmware are refused before programming starts. Firmware installation and recovery are separate from this CPS.

## Privacy and hosting

The host serves the application files. Radio communication goes directly between your browser and the programming cable using Web Serial. Codeplugs stay in browser memory; saving downloads a local JSON file. There is no application backend, account, analytics, cloud codeplug storage, or third-party runtime dependency.

The public website and its JavaScript source are readable by anyone. This repository contains only the CPS, documentation and license notices. Firmware images, native codec files, personal codeplugs and radio backups are distributed or stored separately.

## Development

These unbundled HTML, CSS and JavaScript files are the complete application source. Serve this directory over HTTPS or localhost; for a local preview, run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/`.

GitHub Pages publishes the root of `main`. `.nojekyll` keeps the deployment static. Push reviewed CPS changes to `main` to update the site without reflashing firmware. `deployment.json` records the source revision and runtime asset checksums of the current export.

## License and provenance

Project-authored CPS files (`app.js`, `model.js`, `transport.js`, `index.html` and `styles.css`) are licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE). The adapted RadioFoundry undo helper retains its **MIT** license in [vendor/LICENSE.RadioFoundry](vendor/LICENSE.RadioFoundry). See [UPSTREAM.md](UPSTREAM.md) for the pinned upstream reference and attribution.
