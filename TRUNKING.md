# Program a P25 trunking system

Use firmware supporting logical CPS V6. Its codeplug has 256 channels, 16 zones,
16 scan lists, 96 contacts and eight named trunking systems. A system can hold
one primary and seven alternate control frequencies for one exact site.

1. Read and save the radio's existing codeplug. Opening an older file preserves
   its schema; choose **Upgrade codeplug** explicitly to add trunking systems.
2. Open **Trunking → Add system**. Name the system and enter its control
   frequencies in MHz, primary first. Do not enter traffic channels as alternates
   unless they are also valid control channels for that site.
3. Enter **WACN, System ID and NAC in hexadecimal**. Enter **RFSS, Site, radio ID
   override and selected talkgroup in decimal**. All network/site identities are
   exact matches: zero is a literal value, not a search wildcard.
4. Leave **Do not affiliate (receive only)** checked to listen and follow the
   selected talkgroup without registering, affiliating or transmitting. It is
   checked by default for new systems and blocks trunked PTT requests too.
   Uncheck it for **Experimental subscriber** operation: registration, group
   affiliation and granted group voice. Subscriber mode requires nonzero WACN
   and System ID. A zero radio ID override inherits the shared ID from Radio
   settings; that inheritance does not enable transmission in receive-only mode.
5. Select the saved system. Enable **Start selected system at boot** if desired.
   Review and write the codeplug. Selecting/editing a system does not immediately
   start it from the browser.
6. On the radio choose **OK → Operating → P25 trunking → Start selected system**,
   or restart with that system selected and its start-at-boot preference saved.

The radio searches the primary and alternates, locks fresh matching site and
network metadata, then registers and affiliates when subscriber mode is selected.
It holds the receiver during requests and calls, follows accepted voice grants
and returns to control afterward. Empty candidates can be skipped after 450 ms;
the ordinary acquisition window is three seconds. Genuine P25 evidence allows
up to 12 seconds to acquire the required matching site/network metadata and
channel map. Valid control traffic keeps an established lock alive, while site
and network identity must still be refreshed within 30 seconds. Brief sync by
itself does not establish a lock. Control loss causes reacquisition; the control
list is not a roaming list.

Receive-only systems also recover from a recorder gap or failed receive setup.
Recovery first retries the same candidate, then advances through its saved
controls with bounded delays. Stopping the system, changing the selected system
or programming a codeplug cancels pending retries. Recovery never registers,
affiliates or enables PTT transmission.

For outgoing subscriber calls hold PTT while waiting for a grant. Begin speaking
when the red transmit light indicates the microphone call is active; release to
end it. A waiting/grant indication by itself does not prove microphone RF has
started. An idle attached session offers Resume, Log out and stop, or Stop now
from the radio's OK menu.

Registration, affiliation, granted group voice and incoming talkgroup following
have worked in the local lab. Exact RF access-slot timing and wider system
interoperability remain unqualified. This is a Phase 1 experimental subscriber
implementation; Phase 2, encrypted voice and automatic site roaming are not
implemented. Save the known-working codeplug before changing systems.

Codeplug programming takes over the current receiver and stops its active
trunking session. Saved system/startup settings remain stored. Applets require
their own radio ownership; stop trunking from the radio before entering applet
management. The browser never transmits just because a system draft was edited.
