# Applets in DM32 Studio

Applets are small installable programs for the custom DM32 firmware. Install or
replace an applet over the normal programming cable; a firmware flash is not
needed each time. Eight slots are available, with a maximum of 32 KiB per applet.

## Load and manage

1. Open **Applets** in Studio using desktop Chrome or Edge. Power the radio on
   normally, release PTT and close any other program using its cable.
2. Choose **Connect for applets**, then **Refresh applets**. This connection
   does not silently stop an already running script. If the radio is running
   trunking, stop that session from its menu before using applets; its saved
   system and start-at-boot preference remain stored.
3. Choose a `.dapp` package. Studio checks its format, checksum, instructions
   and declared permissions locally. Review its name and permissions, choose a
   slot, then confirm installation. Replacing an occupied slot replaces its
   applet. Installation does not start it.
4. Use **Start** to run an installed applet. Normal radio listening pauses
   while the applet owns the radio. A SAME applet may retune to a weather channel.
5. Use **Stop & return to programming**, or the radio's Back key, to stop.
   Stopping restores the radio context; scanning does not resume automatically.
   After stopping with Back, choose **Stop & return to programming** to release
   the browser's applet connection before reading or writing a codeplug.
6. **Remove** deletes a chosen slot after confirmation. It does not format the
   applet partition or alter codeplug channels and contacts.

After leaving applet management, read the radio again before writing a codeplug.
Local codeplug edits and message drafts are retained. Applet packages are separate
from the JSON codeplug: keep their source and `.dapp` files. The current serial
API lists slots but cannot download installed package bytes.

Foreign contents in the applet partition block installation and removal. Studio
reports the refusal; it does not offer an automatic erase or format operation.
After a disconnected or timed-out installation, reconnect and refresh the slots
before deciding whether to install again. A missing acknowledgment can leave an
uncertain result; Studio never silently retries a commit.

## Examples and builder kit

- [Counter source](examples/counter.dappsrc) / [package](examples/counter.dapp):
  a one-second counter using the screen and serial output, without RF reception.
- [SAME Watch source](examples/same-watch.dappsrc) / [package](examples/same-watch.dapp):
  NOAA SAME metadata monitoring at 162.550 MHz. This is an experimental decoder,
  not a replacement for a dedicated weather alert receiver.
- [Download the builder kit](applet-builder.zip): Python compiler, examples,
  complete AI agent instructions and GPL license. Offline compilation needs
  Python 3 and no extra packages. The optional serial CLI needs `pyserial`.
- [Instructions for AI agents](AGENT_GUIDE.md): supported language, limits,
  compilation, validation and deliverables.

Installable scripts can use SAME reception, text output, the display and keys.
The raw/voice PCM engine is a separate native serial service; this tab does not
expose PCM transmission or execute arbitrary Python, JavaScript or machine code.
Terminal output is read while an explicit applet operation is running; Studio
does not continuously drain a running applet in the background.
