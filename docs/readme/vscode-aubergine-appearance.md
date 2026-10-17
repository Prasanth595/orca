# Plan: make claude-orcastra look identical to the VS Code aubergine setup

Goal: every surface of the app (chrome, terminal, editor, diffs, chat, markdown) paints with the same
colors and fonts as the author's VS Code workstation theme: Monokai token colors under a
`workbench.colorCustomizations` aubergine palette (`#300a24` surfaces, `#c0c0c0` text, `#0b61e2`
accent, `#5c5b59` borders, the green-in-the-red-slot ANSI quirk).

## What exists today

| Layer | Stock Orca mechanism | Gap |
| --- | --- | --- |
| Terminal | catalog in `src/shared/terminal-themes/`, custom themes via Warp/Ghostty import (`terminalCustomThemes`, `terminalThemeDark: 'custom:<id>'`), per-color `terminalColorOverrides` | works; palette must be re-imported per profile, and the plugin route (`contributes.terminalThemes`) is rejected by the strict manifest schema |
| App chrome | `theme: system/dark/light` toggles `.dark` over tokens in `src/renderer/src/assets/main.css`; `leftSidebarAppearanceMode: match-terminal` derives only the left sidebar from terminal colors | no custom app theme, no accent setting; titlebar/status bar read an undefined `--bg-titlebar` hook; window background hard-coded `#0a0a0a` in three `src/main/window/*` files |
| Editor + diffs | Monaco, always `'vs' / 'vs-dark'` (six call sites), no `defineTheme` | Monokai token colors never reach the editor |
| Chat code blocks | Shiki with `light-plus` / `dark-plus` (`lib/syntax-highlighting/syntax-highlighter.ts`) | Shiki accepts VS Code theme JSON directly; nothing loads one |
| Markdown preview / rich editor | highlight.js with hard-coded GitHub-palette `.hljs-*` hex rules in `markdown-preview.css`, `rich-markdown-editor.css` | not tokenised |
| Fonts | `appFontFamily` (Geist), `terminalFontFamily`, `editorFontFamily` (empty = follow terminal) | just settings; the VS Code font family was never captured |

Prior attempts in `claude-dbx/theme/`: the Warp YAML imports fine (terminal only, loses selection
colors); the plugin manifest fails validation (`terminalThemes` is not a contribution kind);
`superset-aubergine.json` is a palette note nothing reads; `scripts/orca-theme-sync.py` writes valid
settings keys but must rewrite the profile store with the app quit.

## Phase 0 — capture the source of truth (workstation, no code)

Everything downstream converts from ONE file: `resources/themes/aubergine/vscode-theme.json`, a
complete VS Code color theme = Monokai's shipped theme JSON with the user's
`workbench.colorCustomizations` (and any `[Monokai]`-scoped block) merged over its `colors`.

Collect on the workstation:

1. `~/.vscode-server/data/User/settings.json` and the client `settings.json`: `workbench.colorTheme`,
   the full `workbench.colorCustomizations` block (keys carry alpha such as `#80808055`),
   `editor.tokenColorCustomizations` if any, `editor.fontFamily`, `editor.fontSize`, `editor.lineHeight`,
   `editor.fontLigatures`, `terminal.integrated.fontFamily`, cursor style and blink.
2. The theme JSON of the active theme from the client install:
   `…/resources/app/extensions/theme-monokai/themes/monokai-color-theme.json`.
3. Output: the merged theme JSON plus a `fonts.json` (`ui`, `editor`, `terminal`, sizes).

Deliverable: `config/scripts/import-vscode-theme.mjs` (JSONC-aware, alpha-aware; composites alpha
over `editor.background`) that writes the two files. Unit test on a fixture.

## Phase 1 — terminal: Aubergine as a built-in catalog theme (PR 1)

- Add `src/shared/terminal-themes/aubergine.ts` exporting an xterm `ITheme` built from the
  `terminal.*` keys (the 16 ANSI colors, `terminal.foreground/background`,
  `terminalCursor.foreground` → `cursor`, `terminalCursor.background` → `cursorAccent`,
  `terminal.selectionBackground/Foreground`). Register it in `index.ts` so it appears as
  "Aubergine" in the picker like Monokai or Dracula, with no import and no profile rewrite.
- Fork defaults in `src/shared/default-global-settings.ts`: `terminalThemeDark: 'Aubergine'`,
  `terminalDividerColorDark: '#5c5b59'`, `terminalFontSize: 13.5`, `terminalLineHeight: 1.2`,
  `terminalClipboardOnSelect: true`, `terminalMinimumContrastRatio: 1`.
- Keep `terminal.ansiRed = #15f306` exactly as configured (identical means identical); note it in the
  theme file's one-line comment.
- Verify: `pnpm test src/shared/terminal-theme-selection.test.ts`, OSC 10/11 answers, mobile push.

## Phase 2 — app chrome: an "Aubergine" color theme on the token layer (PR 2)

- New setting `appColorTheme: 'default' | 'aubergine'` (the existing `theme` stays the light/dark
  scheme). `use-document-appearance.ts` sets `data-app-theme="aubergine"` on `<html>`.
- In `main.css`, one block `.dark[data-app-theme='aubergine']` that redefines tokens only (no new
  component rules, so the design-system lint stays green). Mapping from VS Code ids:

  | VS Code | Orca token |
  | --- | --- |
  | `editor.background` | `--editor-surface`, `--background` |
  | `sideBar.background`, `activityBar.background` | `--sidebar`, `--worktree-sidebar` |
  | `titleBar.activeBackground`, `statusBar.background` | `--bg-titlebar` (define it; titlebar + status bar already read it) |
  | `panel.border`, `editorGroup.border` | `--border`, `--sidebar-border` |
  | `focusBorder`, `button.background` | `--ring`, `--primary`, `--sidebar-primary` |
  | `list.activeSelectionBackground` | `--accent` |
  | `editor.foreground` | `--foreground` |
  | `descriptionForeground` | `--muted-foreground` |
  | `gitDecoration.*`, `diffEditor.*` | the existing `--git-decoration-*` / `--diff-*` tokens |

  Status and git tokens keep VS Code's semantic colors; they must not derive from the ANSI slots
  (the red slot is green on this workstation).
- Window background: the three `backgroundColor` literals in `src/main/window/` read the theme's
  `editor.background` so there is no flash on launch.
- Sidebar: with the app theme active, `leftSidebarAppearanceMode` can stay `default`.
- Generate the block from `vscode-theme.json` with a small script
  (`config/scripts/render-app-theme-css.mjs --check`) so the CSS never drifts from the source file.

## Phase 3 — editor and diffs: Monokai in Monaco (PR 3)

- `src/renderer/src/lib/monaco-theme/aubergine.ts`: `monaco.editor.defineTheme('aubergine', …)` from
  `tokenColors` (scope → Monaco rule, last scope only, matching `textmate-token-provider.ts`) and
  `colors` (editor background, line highlight, selection, gutter, diff inserted/removed).
- Replace the six `'vs-dark'` sites (`MonacoEditor.tsx`, `DiffViewer.tsx`, `DiffSectionBody.tsx`,
  `IpynbCellEditor.tsx`, `MonacoCodeExcerpt.tsx`, `AutomationEditorPromptEditor.tsx`) with one
  `resolveMonacoTheme(isDark, appColorTheme)` helper.
- The converter is shared with Phase 4 and unit-tested against the fixture theme.

## Phase 4 — chat, markdown and other code surfaces (PR 4)

- Shiki: register the VS Code theme JSON as a third theme in `syntax-highlighter.ts` and pick it when
  `appColorTheme === 'aubergine'`; `NativeChatHighlightedCode.tsx` already paints per-token colors.
- Markdown preview and rich editor: turn the `.hljs-*` hex rules into `--hljs-*` variables defined in
  the token block, then fill them from the same scope mapping.
- Native chat: `nativeChatAppearance.matchTerminalInterface` already remaps chat tokens from the
  terminal theme; with Phase 2 it becomes optional.
- Mermaid reads `--background` / `--chart-*`, so it follows automatically.

## Phase 5 — fonts and defaults (PR 5)

- Fork defaults for `appFontFamily`, `terminalFontFamily`, `editorFontFamily` (empty, follow terminal)
  from `fonts.json`; `terminalCursorStyle` / `terminalCursorBlink` from the VS Code cursor settings.
- `appColorTheme: 'aubergine'` and `theme: 'dark'` as fork defaults so a fresh profile is already right.

## Verification

- Per `AGENTS.md`: launch with `ORCA_BACKGROUND_LAUNCH=1`, capture CDP screenshots of hidden
  renderers, never reveal windows. Compare against the VS Code screenshot swatch by swatch
  (titlebar, sidebar, editor, terminal, status bar, chat code block).
- Gates per phase: `pnpm run check:code-quality:changed`, `pnpm tc:web` (and `tc:node` for Phase 2
  window changes), the unit tests named above; `pnpm test` once before the final PR.
- Each phase is its own small PR into the fork's `main`, so an upstream `Sync fork` stays a clean
  merge: the only upstream files touched are `main.css` (one appended block), the six Monaco call
  sites, `syntax-highlighter.ts`, the two markdown CSS files and the three window files.

## Open inputs (workstation only)

1. `workbench.colorTheme` confirmed as Monokai, and the full `colorCustomizations` block.
2. `editor.fontFamily` / `terminal.integrated.fontFamily` (likely a Nerd Font; never recorded).
3. Whether `editor.background` is the aubergine `#300a24` or Monokai's `#272822` under it.
