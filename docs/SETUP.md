# Setup (Sprint 1: Intake)

About 20 minutes. Do every step with the Google account that will own the system.

## 1. Create the Apps Script project and push the code
```bash
npm install
npx clasp login                        # opens a browser; use your WiCS/SFU Google account
# Turn on the Apps Script API first: https://script.google.com/home/usersettings
npx clasp create-script --type standalone --title "WiCS Creative Ops" --rootDir src
mv src/.clasp.json .clasp.json 2>/dev/null; # clasp may write it into src/; it belongs in the repo root
npx clasp push
npx clasp open-script
```
`.clasp.json` holds your script ID. It's git-ignored so it never reaches the public repo.

## 2. Build the Google side
> **Drive safety:** the script only asks for `drive.file` ("only files this app creates"), not full Drive access. Google blocks it from reading or changing any other file in your Drive, including the WiCS Drive. It does ask for Forms and Sheets access, because it creates and writes to its own Form and Report Sheet.

In the Apps Script editor, pick **`setupGoogleSide`** and click **Run**, then approve the permissions. The log will show:
- **Report Sheet**: `Routing`, `IntakeLog` and `RunLog` tabs, plus a `Form Responses` tab as a raw backup
- **Form**: edit link and share link
- **Requests folder**: one working folder per ticket gets created here

Then, by hand:
1. **Routing tab:** fill in the owner name and **owner email** (the one they use in Asana) for each type, and fill the **Default** row with your own. Lead times and the "needs references / event date" columns can be edited at any time. No code change is needed.
2. **Form → add a File upload question:** in the Form editor, add a question → *File upload*, titled exactly **`Reference files`**, set to not required. Apps Script can't create this question type. Note: file upload makes respondents sign in to Google.

## 3. Connect Asana
1. Asana → profile photo → **My settings → Apps → Developer apps → Create new token**. Copy it.
2. Apps Script → ⚙️ **Project Settings → Script Properties → Add**:
   - `ASANA_TOKEN` = the token. **This is the only place it ever goes. Never put it in code, Git, chat or screenshots.**
3. Run **`listAsanaWorkspaces`**. Copy the workspace gid into a new property, `ASANA_WORKSPACE_GID`. If the log says *organization*, also add `ASANA_TEAM_GID`.
4. Run **`setupAsanaTestProject`**. A **[TEST] WiCS Creative Requests** board appears with the 7 pipeline columns.

> **Why tags rather than custom fields:** custom fields need Asana Starter (paid). The free Personal plan doesn't include them (checked on asana.com/pricing, Nov 2026). Each ticket gets tags (`type: Reel`, `source: form`, `P1`, `Rush`, `Needs Info`, `Sponsor`) so the board can be filtered. It also gets a structured description (`Requestor: …`, `Needed by: …`) that the Sprint 2 sync reads back into the Sheet.

## 4. Turn it on and test (still on the TEST board)
1. Run **`installFormTrigger`**.
2. Run **`runSmokeTests`**. It creates 3 clearly labelled TEST tickets (complete, incomplete, rush), checks each one's column, priority and due date, and confirms that re-running doesn't duplicate. It emails **you**. Look for `PASS` ×4 in the log.
3. Submit the **real form 3 times** yourself: one complete, one with copy = `TBD`, and one due in 2 days. Check that each produced an Asana card, a Drive folder, an `IntakeLog` row and a confirmation email.

## 5. Go live
Run **`setupAsanaLiveProject`**, then **`useLiveMode`**. From now on, real submissions go to **WiCS Creative Requests**. Run **`checkSetup`** at any time to see what's configured; it never prints the token.

## Troubleshooting
| Symptom | Look at |
|---|---|
| No ticket appeared | `RunLog` tab (error row), then Apps Script → **Executions** |
| Ticket assigned to you, not the owner | The owner's email in `Routing` isn't a member of the Asana workspace yet; invite them |
| `Missing Script Property` | That property from step 3 isn't set |
| Submitted twice, one ticket | Working as intended (idempotency guard on form response ID) |
