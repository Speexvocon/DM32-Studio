# Build a DM32 applet: instructions for AI agents

Target the **DAPP v1 sandbox** supplied by the DM32 P25/DMR/FM firmware. Produce
an installable applet, not a firmware modification. Read this contract before
writing code. Do not assume Python, JavaScript, Lua, native ARM/C-SKY code,
arbitrary memory access or a general purpose operating system is available.

## Deliverables and workflow

Deliver a UTF-8 `.dappsrc` source file, its compiled `.dapp` package, a short
README explaining controls and permissions, and offline validation results.
Include any limitations. Never connect to a radio, install, start an applet or
transmit merely to compile or validate it.

Download and extract `applet-builder.zip` from Studio's Applets tab. Keep
`tools/dm32-applet.py` and `tools/dm32_applet.py` together. From the extracted
folder:

```text
python tools/dm32-applet.py compile examples/counter.dappsrc -o counter.dapp
python tools/dm32-applet.py inspect counter.dapp
```

Both commands work offline using only Python 3's standard library. Run them
against your own source and output. Return the compiler's package name,
permissions, byte count, instruction count and SHA-256. Do not hand-edit compiled
package bytes or invent opcodes. Studio and the radio independently validate the
package before accepting it. The package CRC detects corruption; it is not a
signature or proof that a package is trustworthy.

To install, the person using the radio opens Studio → Applets, connects,
refreshes the inventory, chooses the `.dapp` file and slot, and confirms Install.
Starting it is a separate explicit action. The radio's Back key always stops
the applet. No applet starts automatically at boot.

## Language

One statement per line. `#` begins a comment outside quoted strings. Labels are
case-insensitive identifiers followed by `:`. Use quoted printable ASCII text.
Every source needs a `name`, a `caps` declaration and at least one instruction.

```text
name "Counter"
caps serial display
title "One-second counter"
set r0 0

count:
print r0
add r0 1
wait 1000
goto count
```

`name` holds 1–23 printable ASCII characters. Declare only required permissions:
`same`, `serial`, `display`, `key`. `caps` alone is valid when none are needed.
Eight unsigned 32-bit registers, `r0`–`r7`, start at zero; addition wraps at
2^32. Values accept decimal or `0x` hexadecimal. There are no negative values,
floating-point values, arrays, strings in registers, functions or heap.

| Statement | Meaning / limits |
| --- | --- |
| `set r0 123` | Assign an unsigned 32-bit integer. |
| `add r0 1` | Add with unsigned wrap. |
| `goto label` | Jump to an existing instruction. |
| `if r0 == 1 goto label` | Conditional jump; `!=` is also available. |
| `wait 1000` | Wait 1–60000 milliseconds. |
| `yield` | Yield for at least one millisecond. |
| `title "Text"` | Set display text, at most 95 printable ASCII bytes; requires `display`. |
| `print "Text"` / `print r0` | Bounded serial output; requires `serial`. Text is at most 95 bytes. |
| `same 162550000` | Start native SAME metadata reception; requires `same`. Frequency is integer Hz. |
| `await confirmed 60000 r0` | Wait for matching event flags or timeout; register receives flags or zero. |
| `get r1 confirmed` | Read a numeric field; SAME fields require `same`, key field requires `key`. |
| `last` | Print the latest raw SAME header; requires `same serial`. |
| `show same` | Display the latest SAME summary; requires `same display`. |
| `end` | Finish and restore the normal radio context. |

`await` event names are `header`, `confirmed`, `eom`, `key`, `same` (any SAME
event) and `any` (SAME or key). Declare the corresponding permissions: `same`
requires `same`; `key` requires `key`; `any` requires both. The duration must be
1–60000 ms; destination register defaults to `r0` when omitted.

Fields: `event`, `originator`, `locations`, `purge`, `day`, `hour`, `minute`,
`confirmed`, `key`, `uptime_ms`, `headers`, `confirmations`, `eoms`,
`event_sequence`. `event` and `originator` contain three ASCII bytes packed with
the first byte least significant. Events are coalesced flags referencing the
latest header, not an unlimited queue or persistent alert history. Key values
are firmware logical action IDs, not ASCII or raw keypad scan codes; Back is
reserved for stopping and is never an applet-controlled override.

SAME accepts only 162400000, 162425000, 162450000, 162475000, 162500000,
162525000 and 162550000 Hz. A script cannot tune arbitrary frequencies through
this instruction. Use the included SAME Watch example for the confirmation
pattern: after `await confirmed`, read `confirmed` again before displaying the
latest header. An event flag can outlive the header state that triggered it.

## Scheduling and persistence

A package is at most **32768 bytes**, including its 64-byte header, eight-byte
instructions and string table. There are at most **4088 instructions**, and the
combined size limit still applies. Source input is limited to 256 KiB. Instruction
and branch boundaries, string ranges, register numbers, reserved fields and
permissions must all validate.

The VM executes at most 32 instructions per scheduler pass. Every loop should
contain `wait`, `yield` or `await`; a loop without them faults after 100000
instructions across passes. Do not approximate real-time sample processing with
busy loops. Registers and execution state are lost on stop/restart. Installed
packages persist in eight slots; a stopped script has no background thread.

Running an applet takes over the radio, pauses normal reception/scanning and
consumes PTT. It can retune only through the approved SAME service. Back, explicit
APP STOP, VM failure or a programming takeover restores the saved context;
scanning does not automatically restart. Package installation is separate from
execution and uses the inactive storage bank before commit.

## Features that require native firmware work

Do not promise transmitter access, raw/voice PCM frames, direct RF register
control, files/network, contact or codeplug writes, arbitrary flash access,
dynamic native modules, a second simultaneous receiver or an unsupported codec.
The **PCM engine** has separate native serial RAW and VOICE endpoints and a
different protocol; it is not a DAPP instruction or a permission grant. A request
for such a feature needs an explicit firmware/API extension instead of a fake
script implementation.

## Offline checks before delivery

Compile and inspect the output with the supplied tools. Validate both normal and
timeout/end paths by reading the control flow: every branch target must exist,
every loop must yield, events may time out, and every operation must have its
declared capability. Report features you could not exercise on actual hardware.
Do not claim successful weather decoding based only on compilation. Keep
personal radio IDs, contacts, codeplugs, backups and captured audio out of applet
packages and examples.

For optional CLI installation, install `pyserial` separately and use the CLI's
`--help`. Studio is the primary loading and management interface. Never operate
the browser and a separate serial terminal on the same cable simultaneously.
