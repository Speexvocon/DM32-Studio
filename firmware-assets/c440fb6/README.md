# DM32 browser firmware installer

Open `../../firmware.html` in desktop Chrome or Edge over HTTPS or localhost. The
Firmware button in Studio first offers to preserve unsaved edits and disconnects
the programming session. Nothing opens a serial port until Connect cable is
pressed. Opening the page or selecting a folder does not flash the radio.

## Newer RF-B radios: currently incompatible, support planned

Radios with the newer RF-B frontend, including units shipped with
`DM32.NRFB.01.050`, are **currently incompatible** with the multimode firmware.
Support is planned; no availability date is promised. Puya data flash alone does
not identify the RF frontend. See [upstream issue 433](https://github.com/RadioFoundry/RadioFoundry/issues/433).

The flasher blocks installation when the newer-radio checkbox is selected or
NRFB 050 is identified from the backup/version information. **Saving a full dump
does not require a supported codec or recognized calibration layout.** The dump
workflow does not enter the factory updater or erase/write either flash memory;
it loads the reader into RAM and reads the two flash memories twice.

### Save a full dump to send privately

1. Open [backup-only mode](../../firmware.html?backup=1) in desktop Chrome or Edge.
   Close any CPS connection or other application using the programming cable.
2. Keep PTT released. Switch the radio OFF, connect its programming cable, and
   select **Connect cable**. Keep it off until the reader gives its power-on cue.
3. Leave **Backup / full dump only** selected. Select the newer-radio checkbox if
   applicable. Enter a radio label and the stock firmware version (use `unknown`
   if it is unavailable).
4. Select **Create two-read backup**. At the activity log's cue, turn the radio
   ON normally without holding buttons. A blank display while the RAM reader is
   active is expected. Keep the cable and power unchanged through both reads.
5. After **Two complete reads match**, select **Download full dump ZIP**. Confirm
   the browser download finished. The ZIP contains `program.bin` (1 MiB),
   `data.bin` (16 MiB), `full-dump.json` with both reads' SHA-256 evidence, and
   private-sharing instructions. **Save backup folder** is an alternative that
   writes and reads back the same dump files locally.
6. Send the downloaded ZIP privately to the project maintainer using your agreed
   contact method. It contains firmware, device calibration, contacts and other
   personal settings. Do not post it in a public issue or repository. The page
   has no automatic upload or forwarding service.
7. Select **Disconnect**, then switch OFF, remove the battery for 10 seconds,
   refit it and turn ON normally to return to the installed firmware.

This raw diagnostic dump is separate from a sealed installer backup. It cannot
enable installation or satisfy the saved-recovery-package requirement. ZIP
download initiation is not proof that the browser saved it; check Downloads.
Exporting an existing sealed backup instead includes all its original files and
manifest unchanged, plus private-sharing instructions. An interrupted or
nonmatching pair of reads cannot produce a new dump.

## Routine update

Reuse your existing sealed original backup. **A routine update does not read the
flash memories before flashing or automatically read them back afterward.** The original
backup supplies the verified native codec; it does not need to contain your
latest channel settings. Updating writes neither settings nor external data flash.

1. Close CPS or any other application using the programming cable. Keep PTT
   released. Select **Connect cable** and open your existing sealed backup folder.
   Backup validation happens locally and does not start a RAM reader. You can
   export the current JSON codeplug in CPS first if you want an up-to-date copy.
2. Select the beta release folder containing `release.json` and the named
   codec-free application. Obtain these files from the trusted beta repository.
   The browser checks the release and adds the native codec from your backup.
   Select **Save private package** before proceeding. Alternatively, open an
   existing prepared package after selecting its matching release; its saved
   bytes are validated against that release and your sealed backup.
3. Switch OFF, hold PTT + SK1, switch ON, and release both when the green LED
   lights. Select **Identify update mode**. It must answer `BFUV32-V2`; this step
   does not erase or read either complete flash memory.
4. Confirm the same labeled radio and saved files, then **Review & install**. Review
   the version, source revision and label before the final Install firmware
   button. Keep power and cable connected throughout erase and transfer.
5. After **Transfer completed; not independently verified**, select **Disconnect**.
   The radio normally restarts itself; power-cycle normally if needed. Completion means the factory
   updater acknowledged the transfer. It does not claim the installed bytes were
   independently read back.

The RF-B incompatibility block, release/package hashes, native-codec checks,
application/bootloader write boundaries and updater acknowledgements still apply.
Factory identification and your same-radio confirmation do not independently
measure the connected radio's protected data against the backup.

### Optional advanced checks

These checks run only when explicitly selected; neither is part of the default
routine update.

- **Before installation:** expand **Advanced: optional fresh preservation check**,
  select **Require a fresh preservation check for this installation**, then
  **Check radio preservation**. Start with the radio OFF and wait for the reader's
  normal power-on cue. This fresh RAM-reader session compares bootloader and
  factory calibration with the sealed backup. While the option is selected, a
  failed or cancelled check blocks identification and installation. After it
  passes, enter factory update mode and continue with step 3 above.
- **After transfer:** expand **Advanced verification: optional independent
  readback**. Switch OFF, remove and refit the battery, leave the switch OFF, then
  select **Verify installed firmware**. At the log's cue, turn ON normally. A
  separate RAM-reader session checks the prepared application/codec, original
  bootloader and factory calibration. Only a successful check displays
  **VERIFIED**. Disconnect and power-cycle normally afterward.

### First installation without a sealed backup

Expand **Create a first-install backup / full dump**. Start with the radio OFF,
enter its label and installed firmware, then select **Create two-read backup**.
Wait for the log's power-on cue, turn ON normally without buttons, and leave
power/cable unchanged through both complete reads. Both 1 MiB program and 16 MiB
data memories must match. Select **Save backup folder**; every saved file is read
back locally before the save gate passes. Continue with routine-update step 2.
Keep this sealed original backup for later updates; no replacement backup is
needed for every release. The separate full-dump path above remains available
for explicit diagnostic collection, including incompatible radios.

If transfer stops after erase, keep the saved package. The factory updater remains
available; repeat the same guarded installation with your existing sealed backup.
Do not create an original backup from the partially erased application or replace
the package with a bare application file. Existing CLI recovery instructions remain
available in the beta repository.

## Boundaries and provenance

- `device.js` handles the DM32 cable and pinned RAM-reader asset. It offers only
  complete reads and application installation through the factory updater. The
  application UI does not use the RAM monitor's flash-write commands.
- `package.js` is an offline port of the beta backup/codec/package checks. No
  serial, file-system or networking access occurs in that engine. Five exact
  native-codec contracts are supported, including the shared stock 037/039/040
  family; a release must declare its contract too. This family uses the canonical
  codec-map tag 037; the original stock version remains in the backup metadata.
- `backup-export.js` creates the full diagnostic dump and a local ZIP archive.
  It does not extract a codec, enable installation or access a serial port.
- `vendor/` contains unchanged MIT-licensed RadioFoundry transport modules and
  the SHA-256-checked universal RAM monitor from pinned commit
  `75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91`. Its license/provenance are retained.
- Backup, codec and calibration bytes stay on the computer. This page has no
  upload endpoint or telemetry. Its only asset fetch is the pinned loader data.
- SHA-256 checks detect damaged files; a locally supplied manifest is not a
  publisher signature. Obtain the release from a trusted source. Backup labels
  and matching protected data are not cryptographic hardware authentication.
- Factory update mode erases the entire application area from program offset
  `0xC000` through `0x100000`, including the codec slot at `0xE8000`. Every package
  therefore includes that radio's verified native codec. Bootloader and external
  data flash are outside this write.
- Browser transport simulations, Python package parity and browser UI checks are
  separate from physical browser flashing. No new hardware qualification is
  implied by passing those tests.

The browser uses directory selection and local writable directory handles. Keep a
second copy of original backup and codeplug files. Never put owner backup or
generated codec packages into the public CPS repository.
