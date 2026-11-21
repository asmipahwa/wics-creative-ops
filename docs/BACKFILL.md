# Backfilling past requests

Before the form existed, requests came in through DMs, group chats and email. Backfilling means logging those **real** past requests in Asana, so the board shows the team's actual history and not just what came in after the form launched.

## Honesty rules
- **Only real requests.** Every row must trace back to a real message, email or file you can point to. Never estimate or "round up" to reach a number.
- **Keep your evidence private.** For each row, screenshot or note where you found it, and keep that in a private `evidence/` folder in *your* Drive, not in GitHub.
- **Unknown stays blank.** If you don't know the exact delivered date, don't guess. Use the status *In Progress* or *Archived* instead of *Delivered*. The importer rejects `Delivered` rows that have no delivered date.
- Every backfilled ticket is tagged `source: backfill`, so the Dashboard always shows **form vs. backfill** separately.

## Where to look
Instagram DMs to the WiCS account · Discord marketing channel and DMs · Slack · WiCS email inbox · exec group chats · old Drive folders (a file named after an event usually means there was a request) · the Instagram grid itself (each post was a deliverable; the post date is its delivered date).

## Columns
| Column | What to put | Example |
|---|---|---|
| `requested_date` | When the person first asked (date of the DM/email) | 2026-09-03 |
| `requestor` | Who asked: name or role. Stays in your private Sheet, never in GitHub | Events Director |
| `type` | One of: Instagram post, Reel, Story, Poster/Print, Event promo, Recap, Sponsor asset, Merch, Other | Poster/Print |
| `event` | Event or program, or `General` | TryCATCH 2026 |
| `description` | One line on what was asked for | Poster for TryCATCH with schedule + sponsor logos |
| `owner` | Who made it: name from the Routing tab, or their Asana email | Asmi |
| `due_date` | When they needed it, if known | 2026-09-15 |
| `delivered_date` | When it was posted/sent. **Required if status is Delivered** | 2026-09-14 |
| `status` | Delivered, Archived (dropped/cancelled), In Progress, … | Delivered |
| `asset_link` | Link to the final file or post, if you have it | (Drive or IG link) |

## Steps
1. In Apps Script, run **`setupBackfillTab`**. A `Backfill` tab appears in the Report Sheet, with dropdowns for type and status.
2. Fill in rows directly. Alternatively, fill `templates/backfill.csv` in Excel or Numbers and import it with **File → Import → Upload → "Append to current sheet"**.
3. Make sure you're in **live mode** (`useLiveMode`), so the history goes on the real board.
4. Run **`importBackfill`**. Column K shows `imported`, `already imported` or `FIX: …` (what's wrong) for each row. Fix those rows and run it again. Re-running never creates duplicates.
