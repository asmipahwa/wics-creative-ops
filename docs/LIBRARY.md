# Asset library: sandbox copy → restructure → searchable index

## Why the original WiCS Drive can't be harmed
1. **Google enforces it.** This script can *read* your Drive (`drive.readonly`), but can only *change* files it created itself (`drive.file`). The original WiCS files weren't created by it, so Google rejects any change to them, even if the code had a bug.
2. **A code guard on every move or rename.** `assertInSandbox_` walks up a file's parent folders and refuses unless it reaches the sandbox. It also refuses outright if it finds the original folder. This is unit-tested in `tests/library.test.js`.
3. **Nothing is ever deleted.** Folders left empty go to `99_Archive/_Old folders`.
4. **Dry run → your approval → apply → undo log.** `undoRestructure` reverses every change.

## Run order (Apps Script editor → `library.gs`)
**Rehearse first on a dummy folder.** Make a folder in your Drive with about 10 junk files in a couple of subfolders, and run steps 1–8 on it. Once you're happy, set `REHEARSAL_RESET_OK = yes` in Script Properties and run `resetLibraryRehearsal`. Then do it for real.

| # | Run | What happens | Changes anything? |
|---|---|---|---|
| 0 | `setupLibraryTabs` | Creates the Events, Sponsors, CopyLog, Index, Plan and UndoLog tabs | Sheet only |
| 1 | Script Property `SOURCE_FOLDER_ID` = the folder's link or ID | Tells the script which folder to read | — |
| 2 | `surveyOriginal` | Counts files, folders and GB in the original | **Nothing (read-only)** |
| 3 | `copyToSandbox` | Copies everything into **WiCS Marketing (Sandbox)** in My Drive. Resumes by itself after the 6-minute limit. Check `RunLog` for "COMPLETE" | Creates copies only |
| 4 | `inventorySandbox` | Lists every file in the **Index** tab and records the "before" % of names that follow the convention | Sheet only |
| 5 | `proposeRestructure` | 1st run: fills the **Events** tab with suggestions from your folder names. Edit them (fix names, delete non-events, mark programs) and add sponsors. 2nd run: fills the **Plan** tab | Sheet only |
| 6 | **You review the Plan tab** | Check the yellow columns (New folder / New name), the Note column (no date / couldn't classify), and Apply? = No for anything to leave alone | — |
| 7 | `approvePlan` → `applyRestructure` | Moves and renames sandbox files per the plan, logs each change to UndoLog, archives empty old folders, then refreshes the Index and the "after" % | **Sandbox only** |
| 8 | `setupSearchTab` | Search box + filter views | Sheet only |
| ↩ | `undoRestructure` | Reverses everything in UndoLog | Sandbox only |
| 9 | `publishLibraryName` | Renames the sandbox to **WiCS Marketing (Library)**. You then share it from Drive with the marketing team as **Viewer/Commenter** | Sandbox only |

## Folder map and naming convention
See `docs/wiki/wiki.md`. In short: `00_Brand · 01_Events/<YYYY-YY>/<Event>/{Briefs,WIP,Final,Recap} · 02_Programs · 03_Sponsors/<Sponsor>/{Assets,Approvals} · 04_Social/<YYYY-MM> · 99_Archive`, with names in the form `YYYY-MM-DD_Event_AssetType_Channel_vNN.ext`.

How the plan is guessed (`proposeLocation` in `src/library_logic.js`, unit-tested):
- **Date**: taken from the file name if present (`2026-11-08`, `20261108`, `IMG_20261108_…`). Otherwise it uses the *original* file's created date, recorded in CopyLog, because copies get a new date. The Plan's "Date from" column says which.
- **Event / sponsor**: keyword match against the Events and Sponsors tabs. The longest match wins.
- **Type / channel**: from words in the name or path (logo, reel, story, poster, draft…) and the file type.
- **Same name twice in one folder**: the version is bumped (v01 → v02). Nothing is ever overwritten.

## Weekly naming check
`weeklyJob` lists any file added to the library in the past 7 days that breaks the convention, in your Monday summary email.

## Numbers for your evidence
- Files in the library: `Index` row count, or the Search tab header.
- Naming convention before → after: Script Properties `LIB_PCT_BEFORE` and `LIB_PCT_LATEST`, also in `RunLog`.
