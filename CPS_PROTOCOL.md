# Logical CPS protocol

## V6 named P25 trunking systems

The current candidate advertises `CPS HELLO DM32P25 6 256 2 revision CRC`.
GET/BEGIN/PUT/COMMIT/ABORT framing, revision checks, one-shot commits and the
120-byte line limit remain unchanged. V6 contains **499 records / 15,968 payload
bytes**. V5 remains 483 records, V4 387 and V1–3 35. Clients pin the negotiated
schema and never truncate a newer file for older firmware.

Keys 0–482 retain their V5 representation. Keys 483–498 hold eight named P25
Phase 1 systems, two records each. For system index `i=0..7`, key `483+2*i` is:

| Offset | Field |
| --- | --- |
| 0–11 | Name, 1–12 printable ASCII characters, NUL padded |
| 12 | Intent: 0 receive only, 1 experimental subscriber |
| 13 | Control count, 1–8 |
| 14–16 | WACN, little-endian 20-bit value |
| 17–18 | System ID, little-endian 12-bit value |
| 19–20 | NAC, little-endian 12-bit value |
| 21, 22 | RFSS and site, unsigned bytes |
| 23–25 | Radio ID override, little endian; zero inherits the global ID |
| 26–27 | Selected group talkgroup, little endian, 1–65535 |
| 28–31 | Reserved zero |

Key `484+2*i` contains eight little-endian 32-bit receive frequencies, primary
first and alternates in order. The first count entries must be unique and the
remaining entries zero. An absent system requires both records entirely zero.
Identity zero is a literal value, not a wildcard. Experimental subscriber intent
requires nonzero WACN/system ID and refuses an explicit reserved radio ID
`0xFFFFFF`; a zero override still inherits the global ID and runtime policy
checks that resolved identity. Storage does not grant RF access or qualification.

Global byte 28 selects 0 (off) or saved system 1–8. Byte 29 is the explicit
start-at-boot boolean, requiring a selected occupied system. Bytes 30–31 remain
zero. Runtime start/stop need not change this startup preference. Temporary
system frequencies and identities must never overwrite conventional channels
or the global radio ID.

V6 uses the same two 16-KiB settings banks: 128 bytes of header/fallback plus
15,968 payload bytes leaves a 288-byte selection journal per bank. Existing V1–5 snapshots
are projected with empty systems and startup off, without boot-time writes.
The next deliberate save atomically publishes V6 in the inactive bank. Older
files upgrade explicitly; V5 contacts, individual destinations, channels, zones
and scan references are retained. Future/unknown schemas remain read-only.

Ordinary active-VFO, selected-memory and selected-zone changes use up to nine
32-byte append records in that tail instead of rewriting the 499-record snapshot.
Each entry is bound to its parent snapshot revision, has a CRC, validates its
channel/zone references, and publishes its commit word last. Interrupted entries
are skipped. A full journal or an older storage layout falls back to the existing
atomic snapshot save. Channel edits and CPS commits still publish full snapshots.

`GET` and `HELLO` expose the effective selection and its logical payload CRC;
physical journal bytes are never part of the CPS payload. Selection appends do
not advance the snapshot revision, so clients must compare **both revision and
CRC** before uploading. Full snapshots fold the effective selection into GLOBAL.
Older V6 firmware does not understand this journal: it reads the last canonical
snapshot selection and disables settings writes while either bank has journal
entries. A single full snapshot leaves the previous bank's tail intact; clearing
both requires two full snapshot cycles. Use journal-aware firmware for normal
updates and settings changes.

In Studio, **Trunking** edits systems, primary/alternate controls, operating
intent, selected system and startup preference. Complete JSON export/import
includes these records; channel CSV continues to edit channels only. Review
shows system and startup changes. Phase 2 and encrypted voice are unsupported;
experimental subscriber mode is not a claim of RF interoperability.

Named-system runtime acquisition tries the primary and then saved alternates
in order. With multiple candidates, an empty candidate can advance after 450 ms
when at least 300 ms of contiguous, fresh recorder input contains no P25 sync or
accepted control metadata. Missing, stale or discontinuous input cannot shorten
the probe. P25 evidence and single-candidate systems retain the three-second
acquisition window; control loss also retains its three-second window. Lock requires fresh
site/network metadata matching the exact configured identity and candidate
carrier. Carrier changes discard the old attachment and require registration
again. These are firmware runtime actions, not new CPS commands or record fields.
The attached radio menu offers Resume, Log out and stop, and immediate Stop now.
Logout completion means a request was sent without network acknowledgment;
the five-second overall attempt falls back to local stop on failure.

## Earlier version details

This API programs the custom unified DM32 P25/DMR/FM firmware's settings. It contains no address-based reads/writes, calibration operations, firmware update or transmit command. The primary client is the [browser CPS](./README.md). The earlier CHIRP module remains historical integration code. Version3 is the production-functions candidate; it is not an installation claim. The installed `05c4965` baseline advertises version 2.

## Transport and identity

Normal application boot, 115200 baud, 8 data bits, no parity, one stop bit. Every command and reply is printable ASCII ending CRLF, at most **120 bytes including CRLF**. There is one bounded reply per command; there is no automatic write retry. Transactions, CRCs and record hex strings are emitted as uppercase hexadecimal. Indices and revisions are unsigned decimal. A transaction ID is exactly eight hexadecimal digits; the driver chooses a nonzero random 32-bit ID.

The candidate advertises version 3 with the same bounded geometry:

```text
CPS HELLO
CPS HELLO DM32P25 3 32 2 <revision> <CRC32>
```

The updated browser also accepts protocol 1/2 for existing firmware, pins the protocol for each connection and validates records under that version's rules. V1 cannot store DMR. V1/V2 cannot store nonzero V3 power/function fields; clients must refuse unsupported uploads before BEGIN. Older clients that accept only earlier protocols reject version 3 at HELLO. Model identity remains DM32P25 for continuity; it does not select the RF mode.

The firmware refuses CPS while PTT is held, transmit/preparation is active or an incompatible job owns the radio. Opening a CPS session pauses receive monitoring. Read sessions expire after three idle seconds; staged transactions abort after 60 idle seconds. COMMIT/ABORT close the transaction. The normal held-PTT boot guard and transmit permissions remain radio policy. HELLO during an active staged transaction is rejected rather than mixing the active revision with a staged checksum.

## Commands

| Request | Successful reply | Effect |
|---|---|---|
| `CPS HELLO` | `CPS HELLO DM32P25 3 32 2 rev crc` | Identify and obtain the active snapshot revision/CRC |
| `CPS GET i` | `CPS DATA i hex64` | Read one active 32-byte record, `i=0..34` |
| `CPS BEGIN tid rev` | `CPS OK BEGIN tid` | Check the active revision and stage a full copy of the active settings |
| `CPS PUT tid i hex64` | `CPS OK PUT tid i` | Validate one record and change only the staged snapshot |
| `CPS COMMIT tid crc` | `CPS OK COMMIT tid newrev crc` | Validate the whole snapshot and checksum, durably publish it atomically, then apply it |
| `CPS ABORT tid` | `CPS OK ABORT tid` | Discard staging; active settings remain unchanged |

Errors have the form `CPS ERR CODE`; the driver treats every such reply as a failure. BUSY/PTT errors grant no permission to bypass the radio state. Bad identity/version/geometry stops the host before BEGIN. BEGIN rejects a stale revision. Invalid records, transaction IDs, CRCs and references to empty selected memories cannot commit.

The client downloads all 35 records between two matching HELLO responses and verifies the CRC. Upload also checks the original download revision/CRC against HELLO, sends all 35 staged records, then sends COMMIT once. An unchanged upload performs no write. After COMMIT it verifies the acknowledgement and a new HELLO. A missing/invalid commit acknowledgement is uncertain because the radio may have committed; the host never repeats COMMIT and requires a fresh download.

## Canonical payload and checksum

The logical payload is exactly **1120 bytes**: 35 records × 32 bytes in index order. Indices 0–31 are memories 1–32, index 32 is VFO A, 33 is VFO B and 34 is global settings. All integer fields are little endian. CRC is standard CRC-32/IEEE, polynomial `0xEDB88320`, initial `0xFFFFFFFF`, final XOR `0xFFFFFFFF`, over these 1120 bytes only. Flash-bank metadata, legacy preference records, CHIRP's image header and CHIRP metadata are excluded.

Empty channel/VFO records are all zero. An occupied record uses the following layout:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Receive frequency in Hz |
| 4 | 4 | Transmit frequency in Hz; retained even for receive-only profiles |
| 8 | 2 | P25 NAC, 0–0xFFF |
| 10 | 2 | P25 transmit talkgroup, 1–65535 |
| 12 | 1 | Flags below |
| 13 | 1 | Scan membership bits 0–3; remaining bits zero |
| 14 | 12 | Printable ASCII name, zero padded; no nonzero byte after a zero |
| 26 | 2 | FM transmit tone word |
| 28 | 2 | FM receive tone word |
| 30 | 1 | FM squelch, 0–9 |
| 31 | 1 | V3 calibrated power index, 0–8; zero in V1/V2 |

Flags: bit 0 occupied; bit 1 FM; bits2–3 receive filter; bit 4 receive only; bit 5 wide FM; bit 6 DMR (V2/V3); bit 7 zero. FM and DMR bits are mutually exclusive. With neither mode bit set, the channel is P25. Wide mode is valid only for FM. Both tone words must be zero for P25 and DMR.

P25/FM retain their exact V1 byte layout above. DMR replaces bytes 8–11 with:

| Offset | Size | DMR field |
|---|---|---|
| 8 | 3 | Destination ID, little endian, 1–0xFFFFFF |
| 11 | 1 | Bits 0–3 color code (0–15); bit 4 timeslot (0=1, 1=2); bit 5 private call (0=group); bit 6 repeater/hotspot framing (0=direct); bit 7 zero |
| 26–29 | 4 | Unused, zero |
| 30 | 1 | Canonical unused squelch value, 5 |
| 31 | 1 | V3 calibrated power index, 0–8; zero in V1/V2 |

DMR source ID uses the existing global 24-bit ID. Direct/repeater framing is explicit and is not derived from equal RX/TX frequencies. A simplex hotspot may require repeater framing. Power indices0–8 use the board's labels L−, L, L+, L++, M, M+, M++, H− and H. They select factory-calibrated drive settings, not measured watt values; old index 0 remains the same minimum setting.

Filter bits are `0=NAC/all talkgroups`, `1=PROM`, `2=NAC+TG`, `3=invalid` for P25. For DMR they mean `0=configured CC/all destinations`, `1=any CC/all destinations on the selected timeslot`, `2=configured CC+destination`. DMR PROM does not monitor both timeslots. PROM does not enable encrypted voice decoding.

Tone words use their top two bits for type: `0=none`, `1=CTCSS`, `2=DCS`, `3=inverse DCS`. None requires value zero. CTCSS's low 14 bits are tenths of Hz, 600–2600 inclusive. DCS's low bits are the 9-bit code value, 1–511: the familiar octal code `023` is stored as decimal 19. CHIRP converts its octal-looking decimal representation automatically.

Storage validates frequencies structurally from 100 to 520 MHz; the driver advertises the DM32 board's 136–174 and 400–480 MHz ranges. Radio tuning and transmit permission also enforce board bands. This storage envelope does not grant out-of-band operation.

The global record is:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Shared digital source/radio ID, 1–0xFFFFFF |
| 4 | 1 | Shared P25/DMR digital microphone gain, 0–42 dB; analog FM uses its native gain |
| 5 | 2 | Screen timeout, 0–600 seconds; zero always on |
| 7 | 2 | Keypad light timeout, 0–600 seconds; zero always on |
| 9 | 1 | Active VFO, 0=A / 1=B |
| 10 | 1 | A selection, 0=VFO A / 1–32=memory |
| 11 | 1 | B selection, 0=VFO B / 1–32=memory |
| 12 | 1 | Active scan list, 0–3 |
| 13 | 1 | Owner TX inhibit, 0–1 |
| 14 | 2 | V3 transmit timeout in seconds: raw 0 means default 30; otherwise15–600 |
| 16 | 1 | V3 P1 action |
| 17 | 1 | V3 P2 action |
| 18 | 1 | V3 SK1 action |
| 19 | 1 | V3 SK2 action |
| 20 | 4 | V3 broadcast receiver frequency in kHz: raw 0 means 87500; otherwise65000–108000 on a 50-kHz grid |
| 24–31 | 8 | Reserved, zero |

V1/V2 require global bytes14–31 and channel byte 31 to remain zero. Effective defaults are applied on read without changing those bytes or the snapshot CRC. Raw TOT zero is a default encoding, **not an unlimited-transmit setting**. Action codes are:

| Code | Action |
|---|---|
| 0 | Default: P1=VFO/memory, P2=Radio status, SK1=Broadcast FM, SK2=A/B |
| 1 | None |
| 2 | VFO/memory |
| 3 | A/B |
| 4 | Scan start/stop |
| 5 | Cycle channel transmit power |
| 6 | Broadcast FM |
| 7 | Radio status |
| 8 | Keypad lock |

Selected memory references must point to occupied records. An unconfigured VFO may be zero. Active A/B selection uses one RF chain; it does not imply simultaneous reception. Independent transmit-cutoff enforcement remains firmware policy and cannot be disabled by a codeplug. Broadcast reception uses a separate receiver; storing its frequency does not make it a transmit channel.

## Persistence and verification scope

Storage reads V1/V2/V3 bank snapshots without writing or normalizing their raw default encodings. A deliberate save or upload writes V3 records to the inactive bank, preserving the original snapshot until the new bank header is durable. Every selected data record must match its bank version; mixed-version/torn data cannot publish a partial snapshot. Unknown future versions disable writes. Older firmware may read a prior supported bank or retained V1–V3 legacy preference-ring profile read-only; that fallback is not necessarily the latest channel database. Legacy preference-ring version 3 is a separate format from channel-bank version 3.

Staging may write the inactive settings bank, but the active bank remains authoritative until the complete snapshot's commit is durable. Aborted, interrupted and bad-CRC transactions must recover the previous whole snapshot after restart. The firmware owns bank layout, fallback and protected-region enforcement; none are exposed as CHIRP EEPROM addresses.

The browser's complete JSON codeplug wraps the canonical payload in a versioned
`DM32P25-CPS` envelope, version 3, with CRC and optional origin revision/CRC. Earlier files import under strict version-specific validation and retain their exact canonical bytes. A V1 envelope cannot contain DMR, and V1/V2 cannot contain V3 function/power data. File origin
metadata never qualifies a write; the connected client must first read the radio.
The earlier CHIRP `.img` format prefixes the logical payload with `DM32P25\0`,
protocol LE32 and payload length LE32, then uses CHIRP's metadata trailer. Neither
format is a stock firmware/codeplug dump, and the logical API has no raw-flash
capability.

Browser codec/transport tests and a bridge into the actual C parser/storage
exercise this API without hardware. Earlier CHIRP core/C-parser tests and a
real read-only CH340 download also passed. Physical browser GUI/read/write
qualification remains separate; simulated tests do not establish a hardware
upload pass. CHIRP qualification is no longer the primary workstream.
