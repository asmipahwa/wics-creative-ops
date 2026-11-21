/**
 * sheets.js — reading and writing the Report Sheet.
 *
 * Tabs used in Sprint 1:
 *   Routing   — request type → owner + lead time (edited by you, read by the script)
 *   IntakeLog — one row per form submission the script processed (also our duplicate guard)
 *   RunLog    — one row per script run: did it work, and if not, why
 * (The `Tickets` tab arrives in Sprint 2 and is rebuilt from Asana by the hourly sync,
 *  which is why intake writes to its own IntakeLog instead.)
 */

var INTAKE_LOG_HEADERS = [
  'Logged at',
  'Form response ID',
  'Asana task ID',
  'Asana link',
  'Task name',
  'Request type',
  'Event',
  'Requestor',
  'Requestor email',
  'Owner',
  'Needed by',
  'Priority',
  'Section',
  'Rush',
  'Missing info',
  'Source',
  'Working folder',
];
var RUN_LOG_HEADERS = ['Time', 'Function', 'Status', 'Ticket ID', 'Details / error'];
var ROUTING_HEADERS = ['Request type', 'Owner name', 'Owner email (Asana)', 'Lead time (days)', 'Needs references?', 'Needs event date?'];

function reportSpreadsheet_() {
  return SpreadsheetApp.openById(getProp_(CONFIG.PROPS.REPORT_SHEET_ID, true));
}

/** Get a tab, creating it with a bold, frozen header row if it doesn't exist. */
function getOrCreateTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Routing tab → list of rule objects for findRoute(). */
function readRouting_() {
  var sh = reportSpreadsheet_().getSheetByName(CONFIG.TABS.ROUTING);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, ROUTING_HEADERS.length)
    .getValues()
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return {
        type: String(r[0]).trim(),
        ownerName: String(r[1]).trim(),
        ownerEmail: String(r[2]).trim(),
        leadDays: Number(r[3]),
        needsReferences: /^y/i.test(String(r[4])),
        needsEventDate: /^y/i.test(String(r[5])),
      };
    });
}

/** Has this form response already been turned into a task? (Idempotency guard.) */
function findIntakeByResponseId_(responseId) {
  var sh = reportSpreadsheet_().getSheetByName(CONFIG.TABS.INTAKE_LOG);
  if (!sh || sh.getLastRow() < 2) return null;
  var hit = sh
    .getRange(2, 2, sh.getLastRow() - 1, 1)
    .createTextFinder(responseId)
    .matchEntireCell(true)
    .findNext();
  if (!hit) return null;
  var row = sh.getRange(hit.getRow(), 1, 1, INTAKE_LOG_HEADERS.length).getValues()[0];
  return { taskGid: String(row[2]), taskUrl: row[3], row: hit.getRow() };
}

function appendIntakeLog_(values) {
  var sh = getOrCreateTab_(reportSpreadsheet_(), CONFIG.TABS.INTAKE_LOG, INTAKE_LOG_HEADERS);
  sh.appendRow(values);
}

/**
 * Record what happened. Never throws — a logging failure must not hide the
 * real error or break a working run.
 */
function logRun_(fn, status, ticketId, details) {
  try {
    var sh = getOrCreateTab_(reportSpreadsheet_(), CONFIG.TABS.RUN_LOG, RUN_LOG_HEADERS);
    sh.appendRow([new Date(), fn, status, ticketId || '', String(details || '').slice(0, 2000)]);
  } catch (e) {
    console.error('logRun_ failed: ' + e);
  }
}
