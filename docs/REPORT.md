# The workload report: how every number is calculated

The **Tickets** tab is rebuilt from Asana every hour by `syncTickets`. Asana is the source of truth, and the Sheet is the view of it. Everything on the **Dashboard** is a formula that reads Tickets, so you can click any number and see how it was calculated.

**Tickets columns:** A ID · B Task · C Type · D Event · E Requestor · F Owner · G Status · H Priority · I Rush · J Source · K Requested · L Due · M Delivered · N Days open · O Open? · P Month · Q Asana link

## Formulas in plain English
| Where | Function | What it does |
|---|---|---|
| Total / form / backfill | `COUNTA`, `COUNTIF` | Counts rows. Counts rows where Source = "form" or "backfill" |
| Overdue | `COUNTIFS(O,TRUE, L,"<"&TODAY())` | Counts rows that match **all** conditions: still open **and** due before today |
| Due in 48h | `COUNTIFS(... L,">="&TODAY(), L,"<="&TODAY()+2)` | Same idea, with a date window |
| Median cycle time | `MEDIAN(FILTER(M-K, M<>""))` | For delivered tickets, delivered − requested, then the middle value. Median rather than average so one very slow ticket doesn't skew it |
| On-time % | `SUMPRODUCT(...)/SUMPRODUCT(...)` | Of delivered tickets that had a due date, the share delivered on or before it. SUMPRODUCT compares two columns row by row, which COUNTIFS can't |
| Overdue / 48h / this-week lists | `FILTER({B,F,L,G}, conditions)` | Returns the matching rows themselves, not just a count |
| Open by owner | `QUERY("select F, count(A) where O = true group by F")` | SQL-like grouping: one row per owner with their open count |
| Workload spikes | `QUERY(QUERY(...), "where Col2 > "&B3)` | Groups by owner, then keeps owners above the threshold in B3 (editable) |
| Scheduling conflicts | `QUERY(... group by F, L ...)` then `where Col3 >= 2` | Groups by owner **and** due date. Any pair with 2+ items means one person has two deliverables on the same day |
| Status lookup | `XLOOKUP(id, A, G, ...)` with a wildcard fallback | Finds the ticket by ID. If none matches, finds the first ticket whose name contains what you typed (`"*"&text&"*"`, match mode 2) |
| Tickets colours | Conditional formatting (custom formula) | Red = open and overdue, amber = due in 48h, grey = done |
| Type × month | Pivot table | Rows = request type, columns = month requested, values = count |
| Data → Filter views | Saved filter views | Open, Overdue, Due in 48h, Rush, Open by owner, Backfilled. Each person can filter without changing the view for everyone else |
| Chart data | `COUNTIFS(K,">="&week, K,"<"&week+7)` | Created vs. delivered per week for the last 12 weeks |

## Weekly status update
`sendWeeklySummary` runs the sync, then emails you the same numbers and flags (overdue, 48h, this week, spikes, conflicts, open by owner) with links to the Dashboard and the board. You can forward it to the exec team as-is. `weeklyJob` runs every Monday at 8am: it first archives tickets that have been Delivered for 14+ days, then sends the summary.

The email and the Dashboard use the same rules: the email's logic is `summarizeTickets` in `src/logic.js`, which is unit-tested. So the two always agree.
