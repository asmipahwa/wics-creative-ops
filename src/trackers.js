/**
 * trackers.js — Vendors + Approvals tabs, and the idle-ticket "still needed?" check.
 *
 * Vendors  = outside suppliers (printers, merch, photographers): what's due, is it late, is it paid.
 * Approvals = sponsor/partner sign-off on assets (WiCS's version of licensor approval):
 *             rounds of feedback until Approved. Form requests marked "sponsor involved"
 *             add a row here automatically.
 */

var VENDOR_HEADERS = [
  'Vendor',
  'Deliverable',
  'Linked ticket',
  'Ordered',
  'Due',
  'Status',
  'Invoice #',
  'Amount',
  'Paid?',
  'Notes',
  'Flag',
];
var APPROVAL_HEADERS = [
  'Asset',
  'Sponsor / partner',
  'Linked ticket',
  'Submitted',
  'Reviewer',
  'Round #',
  'Feedback summary',
  'Status',
  'Next follow-up',
  'Flag',
];

function setupTrackerTabs() {
  var ss = reportSpreadsheet_();
  var rows = 300;

  var v = getOrCreateTab_(ss, 'Vendors', VENDOR_HEADERS);
  v.getRange(2, 6, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Ordered', 'In production', 'Delivered', 'Cancelled']).build(),
  );
  v.getRange(2, 9, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No']).build());
  v.getRange(2, 4, rows, 2).setNumberFormat('yyyy-mm-dd');
  v.getRange(2, 8, rows, 1).setNumberFormat('$#,##0.00');
  v.getRange(2, 11, rows, 1).setFormulas(
    range_(rows).map(function (r) {
      return [
        '=IF(A' +
          r +
          '="","",IF(AND(E' +
          r +
          '<>"",E' +
          r +
          '<TODAY(),F' +
          r +
          '<>"Delivered",F' +
          r +
          '<>"Cancelled"),"🔴 Overdue",IF(AND(F' +
          r +
          '="Delivered",I' +
          r +
          '<>"Yes",H' +
          r +
          '<>""),"💸 Unpaid","")))',
      ];
    }),
  );

  var a = getOrCreateTab_(ss, 'Approvals', APPROVAL_HEADERS);
  a.getRange(2, 8, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Not yet submitted', 'Submitted', 'Changes requested', 'Approved']).build(),
  );
  a.getRange(2, 4, rows, 1).setNumberFormat('yyyy-mm-dd');
  a.getRange(2, 9, rows, 1).setNumberFormat('yyyy-mm-dd');
  a.getRange(2, 10, rows, 1).setFormulas(
    range_(rows).map(function (r) {
      return ['=IF(A' + r + '="","",IF(H' + r + '="Approved","✅",IF(AND(I' + r + '<>"",I' + r + '<=TODAY()),"⏰ Follow up today","")))'];
    }),
  );
  [v, a].forEach(function (sh) {
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains('Overdue')
        .setBackground('#f4c7c3')
        .setRanges([sh.getRange('A2:K' + (rows + 1))])
        .build(),
    ]);
  });
  Logger.log('Vendors + Approvals tabs ready. Add only vendors WiCS really uses.');
}

function range_(n) {
  var out = [];
  for (var i = 2; i < n + 2; i++) out.push(i);
  return out;
}

/** Called by intake when "sponsor involved" = Yes. Never blocks intake if it fails. */
function appendApprovalRow_(taskName, event, taskUrl) {
  var sh = reportSpreadsheet_().getSheetByName('Approvals');
  if (!sh) return;
  var next = sh.getRange('A:A').getValues().filter(String).length + 1;
  sh.getRange(next, 1, 1, 9).setValues([[taskName, event + ' (fill in sponsor)', taskUrl, '', '', 1, '', 'Not yet submitted', '']]);
}

/**
 * Weekly: open tickets nobody has touched for 14+ days → ask the requestor if it's still
 * needed. If they were asked 7+ days ago and nothing happened since → flag for archive
 * (listed in the weekly summary; a human decides).
 */
function checkIdleTickets() {
  var projectGid = activeProjectGid_();
  var today = todayIso_();
  var tasks = asanaListProjectTasks_(projectGid, TASK_FIELDS + ',modified_at');
  var asked = [],
    flagged = [];
  tasks.forEach(function (task) {
    var t = ticketFromTask(task, projectGid, today);
    var meta = parseTaskNotes(task.notes);
    var modified = task.modified_at ? Utilities.formatDate(new Date(task.modified_at), CONFIG.TIMEZONE, 'yyyy-MM-dd') : '';
    var action = idleAction(t.open, modified, meta.idleCheckSent, today);
    if (action === 'ask' && meta.requestorEmail) {
      MailApp.sendEmail({
        to: meta.requestorEmail,
        subject: 'Still needed? WiCS Marketing request: ' + t.name,
        htmlBody:
          '<p>Hi ' +
          escapeHtml_(meta.requestor || 'there') +
          ',</p><p>Your request <b>' +
          escapeHtml_(t.name) +
          '</b> (ticket ' +
          t.id +
          ") hasn't moved in two weeks. Is it still needed, and is the due date (" +
          (t.due || 'none') +
          ") still right?</p><p>Just reply to this email. If we don't hear back in a week, we'll close it — you can always submit it again.</p><p>— WiCS Marketing</p>",
        name: 'WiCS Marketing',
      });
      asanaUpdateTask_(t.id, { notes: setNoteField(task.notes || '', 'Idle check sent', today) });
      asked.push(t);
    } else if (action === 'flag') {
      flagged.push(t);
    }
  });
  logRun_('checkIdleTickets', 'ok', '', asked.length + ' asked "still needed?", ' + flagged.length + ' flagged for archive');
  return { asked: asked, flagged: flagged };
}
