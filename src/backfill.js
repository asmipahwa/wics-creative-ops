/**
 * backfill.js — bring REAL past requests (from DMs, emails, old Drive files) into Asana.
 *
 * How: paste or import templates/backfill.csv into the `Backfill` tab of the Report Sheet,
 * then run importBackfill(). Each row becomes an Asana task tagged `source: backfill`
 * in the column matching its status, so the "40+ requests" count can always be split
 * honestly into form vs. backfill.
 *
 * Safe to re-run: each row's fingerprint (date + type + event + description) is stored
 * in IntakeLog, so a row already imported is skipped. Also resumable: it stops before
 * Apps Script's 6-minute limit and the next run carries on.
 */

var BACKFILL_HEADERS = [
  'requested_date', 'requestor', 'type', 'event', 'description', 'owner', 'due_date',
  'delivered_date', 'status', 'asset_link', 'import_result', 'asana_link',
];
var BACKFILL_TIME_BUDGET_MS = 5 * 60 * 1000;

/** Create the Backfill tab with headers and dropdowns (type, status). */
function setupBackfillTab() {
  var ss = reportSpreadsheet_();
  var sh = getOrCreateTab_(ss, 'Backfill', BACKFILL_HEADERS);
  var rows = 500;
  sh.getRange(2, 3, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.REQUEST_TYPES).setAllowInvalid(false).build()
  );
  sh.getRange(2, 9, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.SECTIONS).setAllowInvalid(true).build()
  );
  sh.getRange(2, 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 7, rows, 2).setNumberFormat('yyyy-mm-dd');
  sh.getRange(1, 11, 1, 2).setBackground('#eeeeee'); // filled in by the script
  sh.setColumnWidth(5, 360);
  Logger.log('Backfill tab ready: ' + ss.getUrl() + '#gid=' + sh.getSheetId());
}

function importBackfill() {
  var started = Date.now();
  var mode = currentMode_();
  var sh = reportSpreadsheet_().getSheetByName('Backfill');
  if (!sh || sh.getLastRow() < 2) throw new Error('Backfill tab is empty. Run setupBackfillTab(), then paste your rows.');
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, BACKFILL_HEADERS.length).getValues();
  var routing = readRouting_();
  var counts = { imported: 0, skipped: 0, errors: 0, remaining: 0 };

  for (var i = 0; i < values.length; i++) {
    var rowNum = i + 2;
    var row = {};
    BACKFILL_HEADERS.forEach(function (h, c) {
      row[h] = values[i][c];
    });
    if (!clean(row.description) && !row.requested_date) continue; // blank line

    if (Date.now() - started > BACKFILL_TIME_BUDGET_MS) {
      counts.remaining++;
      continue;
    }

    var problems = validateBackfillRow(row, CONFIG.REQUEST_TYPES);
    if (problems.length) {
      sh.getRange(rowNum, 11).setValue('FIX: ' + problems.join('; '));
      counts.errors++;
      continue;
    }

    var id = 'backfill-' + mode + '-' + sha1_(backfillKey(row));
    var existing = findIntakeByResponseId_(id);
    if (existing) {
      sh.getRange(rowNum, 11, 1, 2).setValues([['already imported (' + mode + ')', existing.taskUrl]]);
      counts.skipped++;
      continue;
    }

    try {
      var task = createBackfillTask_(row, id, routing);
      sh.getRange(rowNum, 11, 1, 2).setValues([['imported (' + mode + ')', task.url]]);
      counts.imported++;
    } catch (err) {
      sh.getRange(rowNum, 11).setValue('ERROR: ' + String(err.message || err).slice(0, 300));
      logRun_('importBackfill', 'error', '', 'row ' + rowNum + ': ' + (err.stack || err));
      counts.errors++;
    }
  }

  var msg = 'imported ' + counts.imported + ', already there ' + counts.skipped + ', need fixing ' + counts.errors +
    (counts.remaining ? ', NOT YET DONE ' + counts.remaining + ' (time limit — run importBackfill again)' : '');
  logRun_('importBackfill', counts.errors ? 'done with errors' : 'ok', '', mode + ': ' + msg);
  Logger.log(msg);
}

function createBackfillTask_(row, id, routing) {
  var req = normalizeRequest({
    requestorName: row.requestor,
    type: row.type,
    event: row.event,
    description: row.description,
    neededBy: row.due_date,
    copy: '(backfilled — see original message)',
    references: row.asset_link,
    sponsor: 'No',
  });
  var status = normalizeStatus(row.status);
  var requested = toIsoDate(row.requested_date);
  var delivered = toIsoDate(row.delivered_date);
  var ownerEmail = resolveOwnerEmail(row.owner, routing);
  var notes = buildTaskNotes(req, {
    priority: 'P3',
    rush: false,
    ownerName: clean(row.owner),
    requestedDate: requested,
    deliveredDate: delivered,
    assetLink: clean(row.asset_link),
    source: 'backfill',
    responseId: id,
  });
  var task = asanaCreateTask_({
    name: buildTaskName(req),
    notes: notes,
    assignee: ownerEmail || 'me',
    dueOn: req.neededBy || delivered || null,
    tags: ['type: ' + req.type, 'source: backfill'],
    sectionName: status,
  });
  if (DONE_SECTIONS.indexOf(status) !== -1) asanaUpdateTask_(task.gid, { completed: true });

  appendIntakeLog_([
    new Date(), id, task.gid, task.url, buildTaskName(req), req.type, req.event, req.requestorName, '',
    task.assigneeName, req.neededBy, 'P3', status, 'No', '', 'backfill', '',
  ]);
  return task;
}

function sha1_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, text, Utilities.Charset.UTF_8)
    .map(function (b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2);
    })
    .join('')
    .slice(0, 16);
}
