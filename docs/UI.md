# UI Specification (Tier 1)

macOS HIG applied to a web app. 1 pt = 1 CSS px. Every value below becomes a custom property in `src/styles/tokens.css`; components use tokens only. Tier 2 screens are added in T2.0.

## 1. Type

`--font-system: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable", system-ui, sans-serif`
`--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace`

Each text token holds `weight size/line-height` and is used as `font: var(--text-body) var(--font-system)`.

| Token | Value | Used for |
|---|---|---|
| `--text-large-title` | `400 26px/32px` | Due count in deck view |
| `--text-title1` | `400 22px/26px` | Empty-state title |
| `--text-title2` | `400 17px/22px` | Session complete |
| `--text-title3` | `400 15px/20px` | Alert title (weight 600 there) |
| `--text-headline` | `600 13px/16px` | Toolbar title, default button |
| `--text-body` | `400 13px/16px` | Everything by default |
| `--text-callout` | `400 12px/15px` | Secondary lines |
| `--text-subhead` | `600 11px/14px` | Sidebar section header, badges |
| `--text-footnote` | `400 10px/13px` | Box labels, key hints |
| `--text-card` | `400 17px/26px` | Card front and back |

## 2. Colour

| Token | Light | Dark |
|---|---|---|
| `--label` | `rgba(0,0,0,0.85)` | `rgba(255,255,255,0.85)` |
| `--label-secondary` | `rgba(0,0,0,0.50)` | `rgba(255,255,255,0.55)` |
| `--label-tertiary` | `rgba(0,0,0,0.26)` | `rgba(255,255,255,0.25)` |
| `--bg-content` | `#FFFFFF` | `#1E1E1E` |
| `--bg-sidebar` | `#F2F2F2` | `#2A2A2A` |
| `--bg-sheet` | `#F6F6F6` | `#323232` |
| `--bg-control` | `#FFFFFF` | `rgba(255,255,255,0.12)` |
| `--bg-control-pressed` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.20)` |
| `--fill-hover` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.07)` |
| `--fill-selected` | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.14)` |
| `--separator` | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.10)` |
| `--control-border` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.08)` |
| `--accent` (system blue) | `#007AFF` | `#0A84FF` |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` |
| `--red` | `#FF3B30` | `#FF453A` |
| `--green` | `#28CD41` | `#32D74B` |
| `--orange` | `#FF9500` | `#FF9F0A` |
| `--gray` | `#8E8E93` | `#98989D` |
| `--focus-ring` | `rgba(0,122,255,0.55)` | `rgba(10,132,255,0.65)` |
| `--backdrop` | `rgba(0,0,0,0.20)` | `rgba(0,0,0,0.45)` |
| `--shadow-sheet` | `0 12px 40px rgba(0,0,0,0.25)` | `0 12px 40px rgba(0,0,0,0.60)` |

Dark values apply under `@media (prefers-color-scheme: dark)`. `--shadow-sheet` is the only shadow, and only on alerts, sheets and popovers. No gradients.

`@media (prefers-contrast: more)`: `--label` is fully opaque, `--label-secondary` alpha 0.75, `--separator` and `--control-border` alpha 0.40, `--focus-ring` is solid `--accent`.

## 3. Space, size, shape

| Token | Value |
|---|---|
| `--s1` … `--s8` | `4px 8px 12px 16px 20px 24px 28px 32px` |
| `--sidebar-width` | `240px` |
| `--toolbar-height` | `52px` |
| `--row-height` | `28px` |
| `--control-height` | `28px` |
| `--answer-height` | `44px` |
| `--content-max` | `680px` (card column) |
| `--alert-width` | `260px` |
| `--radius-control` | `6px` |
| `--radius-row` | `5px` |
| `--radius-sheet` | `10px` |
| `--hairline` | `1px` |
| `--focus-width` | `3px` |
| `--icon` | `16px` (Lucide, stroke 1.5) |

## 4. Motion

`--dur-fast: 120ms`, `--dur-sheet: 220ms`, `--ease: cubic-bezier(0.2, 0, 0, 1)`. Only opacity and transform animate. Under `prefers-reduced-motion: reduce` both durations are `0ms`.

## 5. Base styles (`base.css`)

- Reset: `box-sizing: border-box`, zero margins, `html, body, #app { height: 100% }`, `body { overflow: hidden; font: var(--text-body) var(--font-system); color: var(--label); background: var(--bg-content); -webkit-font-smoothing: antialiased }`. UI text is not selectable (`user-select: none`); card content and inputs are.
- Focus: `:focus-visible { outline: var(--focus-width) solid var(--focus-ring); outline-offset: 1px }`; never removed.
- `.btn`: height `--control-height`, padding `0 var(--s3)`, radius `--radius-control`, background `--bg-control`, border `--hairline solid --control-border`, `--text-body`. `.btn-primary`: background `--accent`, colour `--on-accent`, `--text-headline`, no border. `.btn-destructive`: colour `--red`. `.btn-toolbar`: no border or background until hover (`--fill-hover`); icon plus label. `.btn-large`: height `--answer-height`, min-width `140px`. Disabled: opacity 0.4. Pressed: `--bg-control-pressed`.
- `.empty-state`: centred column, `--text-title1` title in `--label-secondary`, `--text-body` line in `--label-tertiary`, optional button, gap `--s2`.
- Scrollbars: thin, thumb `--label-tertiary`, transparent track.

## 6. Screens (Tier 1)

**Window.** A CSS grid: `--sidebar-width` column and a flexible main column, full viewport height. No page header or footer; the page itself never scrolls. The main column is a toolbar row (`--toolbar-height`) above a scrolling content area.

**Sidebar.** Background `--bg-sidebar`, right border `--separator`, padding `--s2`. Section header "Decks" in `--text-subhead`, `--label-secondary`, padding `--s2`. Rows: `--row-height`, radius `--radius-row`, padding `0 --s2`, name truncated with an ellipsis, due badge on the right (`--text-subhead`, `--label-secondary`, tabular numbers). Hover `--fill-hover`; selected `--fill-selected`. The list is one tab stop; Up/Down move, Enter opens. Empty state: "No Decks".

**Toolbar.** Height `--toolbar-height`, padding `0 --s4`, bottom border `--separator`, background `--bg-content`. Left: title (`--text-headline`) with the subtitle under it (`--text-callout`, `--label-secondary`). Right: `.btn-toolbar` actions with `--s2` gaps.

**Home (no deck selected).** `.empty-state`: "No Deck Selected" / "Choose a deck in the sidebar." With no decks at all: "No Decks" / "Import a JSONL file to add cards." and an "Import…" button.

**Deck view.** Toolbar: deck name, "N cards", Import. Content, centred column of max `--content-max`, padding `--s8`: the due count in `--text-large-title` with "due today" under it in `--text-callout`, `--label-secondary`; a row of five equal cells separated by `--separator` hairlines, each with the count (`--text-title2`, tabular numbers) over "Box n" (`--text-footnote`, `--label-secondary`); then a `.btn-primary.btn-large` "Study". When nothing is due the button is disabled and the line reads "Nothing due today".

**Study view.** Toolbar: deck name, "N remaining", and a "Done" toolbar button. Content: a centred column of max `--content-max`, padding `--s8 --s6`. Front in `--text-card`. After reveal: a `--separator` hairline with `--s6` above and below, then the back. Bottom bar pinned to the content area, top border `--separator`, padding `--s4`, centred:
- Before reveal: one `.btn-large` "Show Answer" with the hint "Space".
- After reveal: `.btn-large` "Wrong" (label in `--red`) and `.btn-large` "Right" (label in `--green`), `--s3` apart, with hints "←" and "→" in `--text-footnote`, `--label-tertiary`. Neither is filled; colour is on the label only.
- Done: `.empty-state` "Session Complete" / "N cards reviewed." and a "Back to Deck" button. Nothing due: "Nothing Due".
Card content is selectable. A render warning is `--orange` text with a dotted underline and the error in its tooltip. A SMILES drawing sits on its own line, 240 × 180, with its caption below in `--text-callout`, `--label-secondary`.

**Alert.** A centred `<dialog>`, width `--alert-width`, background `--bg-sheet`, radius `--radius-sheet`, `--shadow-sheet`, padding `--s5`, backdrop `--backdrop`. Title in `--text-title3` at weight 600, centred; message in `--text-callout`, centred. Buttons are full width and stacked, the default button on top. With a Cancel button, Cancel is the default (focused, Enter); a destructive button is `.btn-destructive` and never focused on open. Esc cancels. It fades in over `--dur-fast`.
