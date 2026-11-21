/**
 * sync.js — Asana is the source of truth; the Sheet is the reporting view.
 *
 * Hourly: pull every task on the board → rebuild the `Tickets` tab, which all the
 * Dashboard formulas read. WHY rebuild instead of patching rows: whatever people
 * changed in Asana (moved cards, reassigned, new due dates) always wins, and the
 * Sheet can never drift out of date.
 *
 * Weekly: tasks Delivered 14+ days ago move to Archived (spec §3.3).
 */

var TICKET_HEADERS = [
  'Task ID', 'Task', 'Type', 'Event', 'Requestor', 'Owner', 'Status', 'Priority', 'Rush', 'Source',
  'Requested', 'Due', 'Delivered', 'Days open', 'Open?', 'Month', 'Asana link',
];
var TASK_FIELDS = 'name,notes,completed,completed_at,created_at,due_on,assignee.name,memberships.project.gid,memberships.section.name,permalink_url';

/** Fetch all tasks, stamp missing Delivered dates in Asana, return ticket objects. */
function fetchTickets_() {
  var projectGid = activeProjectGid_();
  var today = todayIso_();
  var tasks = asanaListProjectTasks_(projectGid, TASK_FIELDS);
  return tasks.map(function (task) {
    if (task.completed_at) {
      task._completedLocal = Utilities.formatDate(new Date(task.completed_at), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    var t = ticketFromTask(task, projectGid, today);
    // First time we see a card in Delivered/Archived: write the date into Asana so it's permanent.
    if (t.needsDeliveredStamp) {
      try {
        asanaUpdateTask_(t.id, { notes: setNoteField(task.notes || '', 'Delivered date', t.delivered), completed: true });
      } catch (e) {
        logRun_('syncTickets', 'warn', t.id, 'could not stamp delivered date: ' + e.message);
      }
    }
    return t;
  });
}

function syncTickets() {
  try {
    var tickets = fetchTickets_();
    writeTicketsTab_(tickets);
    var ss = reportSpreadsheet_();
    var dash = ss.getSheetByName('Dashboard');
    if (dash) dash.getRange('B2').setValue(new Date());
    logRun_('syncTickets', 'ok', '', tickets.length + ' tickets (' + currentMode_() + ')');
    return tickets;
  } catch (err) {
    logRun_('syncTickets', 'error', '', err.stack || String(err));
    throw err;
  }
}

function writeTicketsTab_(tickets) {
  var ss = reportSpreadsheet_();
  var sh = getOrCreateTab_(ss, 'Tickets', TICKET_HEADERS);
  var rows = tickets
    .sort(function (a, b) {
      return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
    })
    .map(function (t) {
      return [
        t.id, t.name, t.type, t.event, t.requestor, t.owner, t.status, t.priority, t.rush ? 'Yes' : '', t.source,
        isoToDate_(t.requested), isoToDate_(t.due), isoToDate_(t.delivered), t.daysOpen, t.open, t.month, t.link,
      ];
    });
  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, TICKET_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@'); // IDs as text so lookups match
    sh.getRange(2, 1, rows.length, TICKET_HEADERS.length).setValues(rows);
    sh.getRange(2, 11, rows.length, 3).setNumberFormat('yyyy-mm-dd');
  }
}

/** Weekly: Delivered for 14+ days → Archived column. Keeps the board focused on live work. */
function archiveDelivered() {
  var today = todayIso_();
  var moved = 0;
  fetchTickets_().forEach(function (t) {
    if (shouldArchive(t, today, 14)) {
      asanaMoveToSection_(t.id, 'Archived');
      moved++;
    }
  });
  logRun_('archiveDelivered', 'ok', '', moved + ' moved to Archived');
  return moved;
}

/** 'YYYY-MM-DD' → a Date at local midnight (what Sheets formulas expect), or '' . */
function isoToDate_(iso) {
  if (!iso) return '';
  var p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
