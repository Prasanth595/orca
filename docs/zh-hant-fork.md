# zh-Hant Fork (TW199501/orca)

This fork carries a Traditional Chinese (Taiwan) UI for personal use. Upstream `stablyai/orca` has no zh-Hant locale yet. These rules apply on every machine, macOS and Windows alike. Branch rules live in [`BRANCHING.md`](../BRANCHING.md) (ELF team branching rules, type 1 contribution fork); read it first.

## Branches

- `main` mirrors `upstream/main` (stablyai/orca). Only fast-forward it, never commit to it.
- `dev` is `main` plus the zh-Hant catalog, fork tooling, and fixes. Changes land through PRs from `feat/`, `fix/`, `docs/`, `chore/`, or `test/` branches cut from `origin/dev`.
- `release` only fast-forwards to `origin/dev`. Never commit to it, build fixes included. Builds come from here.

## Sync flow

1. `git fetch upstream main`, list `git log --oneline origin/main..upstream/main`, fast-forward `main` to `upstream/main`, and push `main` to `origin`.
2. Merge `main` into `dev`. Push `dev` directly only when the merge has no conflicts; otherwise resolve it on `merge/conflict-<YYYYMMDD>` and open a PR into `dev`.
3. On a `fix/` branch from `origin/dev`, fix `src/renderer/src/i18n/locales/zh-Hant.json` and open a PR into `dev`:
   - Remove keys that `en.json` no longer has.
   - Fix `{{placeholder}}` mismatches.
   - Translate new keys.
   - Run `pnpm run verify:localization-catalogs` and `pnpm test src/renderer/src/i18n/`.
4. `node config/scripts/zh-hant-sync-release.mjs` lists the commits `origin/dev` brings in, fast-forwards `release` to `origin/dev`, and pushes `release` only. It stops if `release` cannot fast-forward. Add `--no-push` for a dry run, or `--build-mac` to also package the macOS app for the host arch into a cleaned `dist/`.

`pnpm` keeps re-adding `@pnpm/exe` to `pnpm-lock.yaml`. Never commit that change. The sync script restores it automatically.

## Builds and releases

- Builds are for the user's own machines only. There is no GitHub Release and no public distribution.
- Do not point the auto-updater or the electron-builder `owner` at the fork. The user still wants official updates, and an official update overwriting a test build is expected.
- On macOS, use `--build-mac`. A plain `pnpm build:mac` fails on x64 because only host-arch native modules are installed.
- On Windows, `git switch release`, then run, in order:
  1. `pnpm install`
  2. `pnpm install --frozen-lockfile` inside `mobile/`. It is a separate pnpm project, and the mobile web bundle resolves React Native and Expo from it.
  3. `node config/scripts/build-windows-agent-hook.mjs`. This needs `cargo`; packaging fails without `orca-agent-hook.exe`.
  4. `pnpm build:win`

  The installer lands in `dist\orca-windows-setup.exe`.

## zh-Hant wording (Taiwan)

- Use Taiwan terms, not mainland or s2t-converted ones. `src/renderer/src/i18n/zh-hant-simplified-character-guard.test.ts` blocks the known bad ones.
- Fixed choices:

  | English            | zh-Hant       |
  | ------------------ | ------------- |
  | agent              | 智慧體 (kept) |
  | session            | 工作階段      |
  | pull request       | Pull Request  |
  | cloud              | 雲端          |
  | tab                | 分頁          |
  | terminal           | 終端機        |
  | local              | 本機          |
  | repository         | 儲存庫        |
  | build              | 建置          |
  | auth token         | 權杖          |
  | usage or LLM token | token         |
  | Jump to            | 跳至          |

  A table row is 列 and a column is 欄.

- Never translate proper or product names. Keep OpenAI, GitHub, Claude, Bitbucket Cloud, Orca Relay, Orca Mobile, Artifacts, and HTML in English.

## Upstream contributions

- Send bugs that also exist upstream to `stablyai/orca` as a small PR per fix. Cut `pr/<short-name>` from `main` (the `upstream/main` mirror), cherry-pick the `dev` commit onto it with `-x`, and keep one topic per branch. Open the upstream PR only after the user explicitly agrees.
- Upstream's PR template requires a linked issue for outside contributors, so open the issue first.
- Fill in `.github/pull_request_template.md` honestly. Say what was and was not manually tested.
- Keep fork-only files out of upstream PRs: this doc, `BRANCHING.md`, the `AGENTS.md` pointer to them, and `config/scripts/zh-hant-sync-release.mjs`.
