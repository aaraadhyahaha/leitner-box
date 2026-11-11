# Import format

Leitner Box imports cards from **JSONL**: UTF-8 text with one JSON object per line. Blank lines are skipped. If the first non-whitespace character of the file is `[`, the whole file is read as one JSON array of the same objects instead (element *i* is reported as line *i + 1*). You can import a file or pasted text, and you see a preview before anything is written: how many cards are valid, how many duplicates will be skipped, and every error with its line number. The whole import then commits in one transaction and is recorded as a batch, so you can delete it in one action later. New cards start in box 1 and are due today. Export writes the same format, so cards round-trip.

## Fields

| Field   | Type                        | Required | Notes |
|---------|-----------------------------|----------|-------|
| `front` | string                      | yes      | Must be non-empty after trimming. |
| `back`  | string                      | yes      | Must be non-empty after trimming. |
| `deck`  | string                      | no       | Deck name, matched case-insensitively. If missing, the card goes to the deck chosen at import: the current deck when importing from a deck view, otherwise the file name without its extension. |
| `tags`  | array of strings, or string | no       | A string is split on commas and whitespace. Inner whitespace inside a tag becomes `-`. |

Unknown fields are ignored.

## Markup in `front` and `back`

Examples are shown as they appear **inside a JSON string**, with backslashes doubled.

| Markup | Example in JSON | Renders as |
|--------|-----------------|------------|
| Inline math (KaTeX) | `"$\\frac{1}{2}mv^2$"` | The fraction ½mv² inline with the text. |
| Display math (KaTeX) | `"$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$"` | The integral centred on its own line. |
| Chemistry (mhchem) | `"\\ce{2H2 + O2 -> 2H2O}"` | A typeset equation with subscripts and a reaction arrow. Works bare or inside math (`"$\\ce{H2O}$"`). |
| Units (mhchem) | `"\\pu{9.81 m/s^2}"` | A number with correctly spaced units. Works bare or inside math. |
| SMILES structure | `"{{smiles:CCO}}"` | A 2D drawing of ethanol. |
| SMILES with caption | `"{{smiles:c1ccccc1|benzene}}"` | A 2D drawing of benzene with the caption "benzene" below it. |
| Literal dollar | `"\\$5"` | The text `$5`, not math. |
| Line break | `"line one\nline two"` | Two lines. |

Everything else is plain text: HTML is escaped and shown literally (`"<b>hi</b>"` shows the tags, not bold text). If any markup fails to render, the card shows an orange warning in its place; the card itself never breaks.

## Backslashes must be doubled

JSON uses the backslash for its own escapes, so every LaTeX backslash must be written as `\\`.

Wrong:

```json
{"front": "One half", "back": "$\frac{1}{2}$"}
```

Right:

```json
{"front": "One half", "back": "$\\frac{1}{2}$"}
```

`\f` is a JSON form-feed escape, so `"\frac"` silently becomes a form-feed character followed by `rac`.

Wrong:

```json
{"front": "Water", "back": "\ce{H2O}"}
```

Right:

```json
{"front": "Water", "back": "\\ce{H2O}"}
```

`\c` is not a JSON escape at all, so the whole line is rejected as `Invalid JSON`.

Wrong:

```json
{"front": "Speed", "back": "$v = 3\text{ m/s}$"}
```

Right:

```json
{"front": "Speed", "back": "$v = 3\\text{ m/s}$"}
```

`\t` is a JSON tab escape, so `"\text"` silently becomes a tab character followed by `ext`.

## Duplicates and errors

- **Duplicates are skipped, not errors.** A card is a duplicate when the same deck already has a card with the same front and back (compared after trimming and Unicode NFC normalisation), either in the database or earlier in the same file. Re-importing the same file is therefore safe and adds nothing.
- **Errors are reported per line; valid lines still import.** The messages are:

| Message | Meaning |
|---------|---------|
| `Invalid JSON` | The line is not valid JSON. |
| `Not an object` | The line is valid JSON but not an object. |
| `Missing front` | `front` is missing, not a string, or empty after trimming. |
| `Missing back` | `back` is missing, not a string, or empty after trimming. |
| `deck must be a string` | `deck` is present but not a string. |
| `tags must be an array of strings` | `tags` is neither a string nor an array of strings. |
| `Invalid JSON array` | The file starts with `[` but is not a valid JSON array. |

## Prompt for an AI agent

Copy this prompt, fill in the three placeholders, and save the agent's reply as a `.jsonl` file (or paste it into the import sheet).

```text
Generate <NUMBER> flashcards for the deck "<DECK NAME>" about:

<TOPIC OR SOURCE MATERIAL>

Output format (follow exactly):
- Output ONLY JSONL: one JSON object per line, nothing else. No code fence, no headings, no commentary before or after.
- Each line has the fields "deck", "front", "back" and optionally "tags".
- Set "deck" to "<DECK NAME>" on every line.
- Put exactly one fact on each card. The front is a short question or prompt; the back is the answer.
- Keep every front unique within the deck.
- Tags are an array of lowercase, hyphenated strings, e.g. ["organic-chemistry", "alcohols"].

Markup you may use inside "front" and "back":
- $...$ for inline math and $$...$$ for display math (LaTeX, rendered by KaTeX).
- \\ce{...} for chemical formulas and equations, \\pu{...} for physical units (mhchem).
- {{smiles:SMILES}} or {{smiles:SMILES|caption}} to draw a molecule as a 2D structure.
- \\$ for a literal dollar sign. Everything else is plain text; HTML is not rendered.
Use math, \\ce{...} and {{smiles:...}} wherever they fit the content.

Backslashes: this is JSON, so EVERY backslash must be doubled. Write \\frac, \\ce, \\text, \\sqrt, never \frac, \ce, \text, \sqrt. A single backslash either breaks the line or silently turns into a tab or form-feed character.

Example lines:
{"deck": "<DECK NAME>", "front": "Kinetic energy of a mass $m$ moving at speed $v$?", "back": "$E_k = \\frac{1}{2}mv^2$", "tags": ["mechanics", "energy"]}
{"deck": "<DECK NAME>", "front": "Balanced equation for the combustion of methane?", "back": "\\ce{CH4 + 2O2 -> CO2 + 2H2O}", "tags": ["chemistry", "combustion"]}
{"deck": "<DECK NAME>", "front": "Structure of ethanol?", "back": "{{smiles:CCO|ethanol}}", "tags": ["organic-chemistry", "alcohols"]}

Before you finish, re-read every line and check that it parses as a single valid JSON object, that every backslash is doubled, and that no front repeats.
```
