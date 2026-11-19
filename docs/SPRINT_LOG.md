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
