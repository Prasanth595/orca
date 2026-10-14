# 分支規範：本 repo 為【第 1 種：貢獻型 fork】

> 完整規範：[分支規範：三種 repo 類型](https://linear.app/elf-express/document/分支規範三種-repo-類型貢獻型-fork私有-fork自有專案-128bf6e5e1f9)（Linear）
> 本檔只記錄這個 repo 的設定。人與 AI 動手前請先讀完本檔；zh-Hant 翻譯、建置與送上游的細節見 [`docs/zh-hant-fork.md`](./docs/zh-hant-fork.md)。

## 本 repo 資訊

| 項目                      | 值                                                     |
| ------------------------- | ------------------------------------------------------ |
| 類型                      | 第 1 種：貢獻型 fork（fork 原作者，會送 PR 回饋）      |
| 原作者 repo（`upstream`） | `stablyai/orca`                                        |
| 我們的 fork（`origin`）   | `TW199501/orca`                                        |
| 下游私有 fork             | 無                                                     |
| 上游貢獻規範              | [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md) |

## 遠端設定

```
git remote add upstream https://github.com/stablyai/orca.git
git remote -v
```

## 分支用途

| 分支                                        | 用途                                                | 可否提交             | 從哪裡更新          |
| ------------------------------------------- | --------------------------------------------------- | -------------------- | ------------------- |
| `main`                                      | 原作者 `main` 的鏡像，只用來同步                    | **不提交，只快轉**   | `upstream/main`     |
| `dev`                                       | `main` 加上 zh-Hant 語系、fork 工具與修正；整合測試 | 只能經由開發分支合併 | `main`              |
| `feat/`、`fix/`、`docs/`、`chore/`、`test/` | 開發                                                | 可以                 | 從 `dev` 開出       |
| `pr/xxx`                                    | 送給原作者的 PR，一個分支一個主題                   | 可以                 | 從 `main` 開出      |
| `release`                                   | 唯一的穩定版，本機建置都從這裡出                    | **不提交，只快轉**   | 測過的 `origin/dev` |

## 常用指令

同步原作者：

```
git fetch upstream
git log --oneline origin/main..upstream/main   # 先列出會帶進來的提交
git switch main
git merge --ff-only upstream/main
git push origin main
```

更新 dev（合併後另開 `fix/` 分支，依 `docs/zh-hant-fork.md` 修正 `zh-Hant.json`，跑過 `pnpm run verify:localization-catalogs` 與 `pnpm test src/renderer/src/i18n/` 後走 PR）：

```
git switch dev
git merge main
git push origin dev        # 沒有衝突才直接 push；有衝突改在 merge/conflict-<YYYYMMDD> 分支處理並走 PR
```

開發：

```
git fetch origin
git switch -c feat/e-<編號>-<短名> origin/dev
```

發佈（`dev` 測試通過後）：

```
node config/scripts/zh-hant-sync-release.mjs --no-push   # 先列出會帶進去的提交並在本機快轉
node config/scripts/zh-hant-sync-release.mjs             # 確認後快轉並推送 release
```

腳本等同於：

```
git fetch origin
git log --oneline origin/release..origin/dev
git switch release
git merge --ff-only origin/dev
git push origin release
```

送 PR 給原作者：

```
git switch -c pr/<短名> main
git cherry-pick -x <該主題的提交>       # 清單先給使用者確認；不 cherry-pick 合併提交
git push -u origin pr/<短名>
gh pr create --repo stablyai/orca --base main --head TW199501:pr/<短名>   # 使用者明確同意後才執行
```

## 分支保護設定建議

- **`main` 與 `release`**：禁止 force push、禁止刪除、只允許維護者 push。**不要**設「必須經過 Pull Request」：這兩條分支是在本機 `merge --ff-only` 後直接 push 的，GitHub 的 PR 合併會產生新提交或新 SHA，無法快轉。
- **`dev`**：禁止 force push、禁止刪除；開發分支（`feat/*`、`fix/*`、`docs/*`、`chore/*`、`test/*`、`merge/*`）一律經 PR 合併，維護者保留直接 push 權限，給沒有衝突的 `main` → `dev` 同步合併使用。

## 禁止事項

- 不在 `main`、`release` 上提交，也不 force push。建置用的修正也一樣，先經 PR 進 `dev`。
- 不把 `main` 當穩定版或建置來源。
- 不直接在 `dev` 上開發。
- 不從 `dev` 或開發分支直接對原作者開 PR；一個 `pr/` 分支只放一個主題。
- 未經使用者明確同意，不對原作者的 repo 開 PR、留言或推送任何東西。
- `--ff-only` 失敗、合併或 cherry-pick 有衝突時，停下來回報，不要自行處理。
