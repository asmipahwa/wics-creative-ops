# Sprint log

## Sprint 1: Intake (code written 2026-11-19; live setup pending)

**Built**
- `src/logic.js`: pure rules covering normalisation, completeness check, routing lookup, lead-time/rush, priority, task name/notes, folder naming, and retry policy. 21 Jest tests in `tests/logic.test.js`.
- `src/intake.js`: `onFormSubmit` → `processSubmission`. It takes a script lock, checks for a duplicate response ID, decides, creates the Drive folder, creates the Asana task in Intake or Needs Info, then writes the IntakeLog row, sends the email, and writes the RunLog row.
- `src/asana.js`: REST wrapper that retries on 429/5xx (honouring Retry-After, otherwise exponential backoff capped at 32s). It also handles project and section setup, tags, and task creation, and falls back to assigning you if the routed owner isn't in the workspace.
- `src/setup.js`: builds the Report Sheet, Routing tab, Form and Requests folder. It also covers the test/live boards, the trigger install, and mode switches.
- `src/smoke.js`: 3 live test cases plus an idempotency check against the TEST board.

**Decisions and deviations from the spec**
- **Plain JS, not TypeScript.** clasp 3 no longer compiles TS. Plain JS also lets Jest test the exact file that runs in Apps Script.
- **Tags + structured description instead of custom fields.** The Asana free plan has no custom fields.
- **Intake writes to `IntakeLog`, not `Tickets`.** In Sprint 2 the hourly sync rebuilds `Tickets` from Asana, so the two must stay separate. IntakeLog doubles as the duplicate guard.
- **One adaptive confirmation email.** The receipt also carries the "Needs Info" list and the rush warning, so requestors get one email instead of two.
- **File upload question is added by hand.** Apps Script can't create file-upload questions.
- **Lead-time rule is enforced by the script (Rush flag), not the form.** Forms can't validate a date relative to today.

**Not yet done (needs you)**: clasp login, the Asana token, running setup, smoke tests and 3 real test submissions, then switching to live. See `docs/SETUP.md`.

**Sprint 1 live status (2026-11-20):** setup done, 4/4 smoke tests passed, 3 real form submissions created cards and emails. Open item: confirm the 3 form cards landed in the expected columns (now visible on the Tickets tab after a sync).

## Sprint 2: Backfill + report (code written 2026-11-20)

**Built**
- `src/backfill.js`: `setupBackfillTab` and `importBackfill`. Validates each row, dedupes on a hash of date + type + event + description (per mode), places tasks in the right column, marks Delivered/Archived tasks complete, writes a result to each row, and is resumable within the 6-minute limit.
- `src/sync.js`: `syncTickets` pulls all tasks page by page and rebuilds the Tickets tab. It writes the Delivered date into Asana the first time a card reaches Delivered or Archived. `archiveDelivered` moves cards Delivered 14+ days ago to Archived.
- `src/report.js`: `setupDashboard` sets up KPIs, status counts, an XLOOKUP status lookup, owner workload, spike and conflict flags, overdue/48h/this-week lists, 2 charts, a type × month pivot, conditional formatting and 6 filter views. `sendWeeklySummary`, `weeklyJob` (Mondays 8am) and `installReportTriggers` (hourly sync) are here too.
- Pure logic in `logic.js` (status mapping, backfill validation, notes parsing, ticket rows, summary, spike and conflict detection), with 25 more Jest tests (46 total).
- Docs: `docs/BACKFILL.md` and `docs/REPORT.md` (every formula explained).

**Decisions**
- The Delivered date is stored in the Asana task description and stamped once. Asana's own completion date would be the import date for backfilled tasks, which would distort cycle time.
- A `Delivered` backfill row needs a real delivered date. The importer refuses to guess.
- The weekly email logic (`summarizeTickets`) mirrors the Dashboard formulas and is unit-tested.

**Deferred (nice-to-have, §0.5):** the idle-ticket "still needed?" emails.

## Sprint 3: Asset library + wiki (code written 2026-11-20, not yet run)
- `src/library_logic.js`: pure, unit-tested code covering the safety guard (`checkInSandbox`), the naming-convention parser, academic year, date-from-name, type/channel guessing, folder proposal and version dedupe.
- `src/library.js`: `surveyOriginal` (read-only), `copyToSandbox` (resumable, with CopyLog), `inventorySandbox`, `proposeRestructure` (suggests Events from real folder names), `approvePlan`, `applyRestructure` (guard plus UndoLog, archives emptied folders), `undoRestructure`, `setupSearchTab` with filter views, `checkNamingConvention` and `resetLibraryRehearsal`.
- **Safety model:** scopes are now `drive.readonly` + `drive.file`, so Google itself blocks changes to anything the script didn't create.
- **Bug caught by a unit test:** a legacy folder named "Old" was being sent to WIP. Removed "old" from the WIP keywords.
- `src/docs.js` turns `docs/wiki/wiki.md` and `templates/meeting-notes.md` (built to HTML with `npm run build:html`) into Google Docs, and fills in the real links inside Drive only.

## Sprint 4: Polish (2026-11-20)
- `src/trackers.js`: Vendors and Approvals tabs with flag formulas. Sponsor requests from the form add an Approvals row. `checkIdleTickets` sends "still needed?" after 14 idle days and flags no-reply after 7. Both feed into `weeklyJob`.
- ESLint, Prettier, a GitHub Actions CI workflow (lint, 76 Jest tests and a secrets scan) and a PR template.
- Docs: README, DESIGN, wiki, LIBRARY, and the results templates.
