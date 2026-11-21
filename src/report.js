/**
 * report.js — the Dashboard and the weekly status email.
 *
 * WHY formulas (not script-computed numbers) on the Dashboard: anyone on the team
 * can click a cell and see exactly how a number is calculated, and the numbers
 * update the moment the hourly sync refreshes the Tickets tab.
 * Each formula is explained in docs/REPORT.md.
 *
 * Tickets columns: A id · B task · C type · D event · E requestor · F owner · G status ·
 * H priority · I rush · J source · K requested · L due · M delivered · N days open ·
 * O open? · P month · Q link
 */

var TK = 'Tickets!';
var MONDAY = '(TODAY()-WEEKDAY(TODAY(),2)+1)';

function setupDashboard() {
  var ss = reportSpreadsheet_();
  syncTickets(); // make sure Tickets exists and is current
  var tickets = ss.getSheetByName('Tickets');
  var dash = ss.getSheetByName('Dashboard') || ss.insertSheet('Dashboard', 0);
  dash.clear();
  dash.getCharts().forEach(function (c) { dash.removeChart(c); });

  var head = function (a1, text) { dash.getRange(a1).setValue(text).setFontWeight('bold').setFontSize(11).setBackground('#ede7f6'); };

  dash.getRange('A1').setValue('WiCS Marketing — Workload & Status').setFontSize(16).setFontWeight('bold');
  dash.getRange('A2').setValue('Last synced from Asana');
  dash.getRange('B2').setValue(new Date()).setNumberFormat('yyyy-mm-dd hh:mm');
  dash.getRange('A3').setValue('Spike threshold (max open tickets per owner) ✏️');
  dash.getRange('B3').setValue(5).setBackground('#fff2cc');

  // KPIs
  head('A5', 'Key numbers');
  var kpis = [
    ['Total requests tracked', '=COUNTA(' + TK + 'A2:A)'],
    ['  · from the form', '=COUNTIF(' + TK + 'J2:J,"form")'],
    ['  · backfilled (pre-form)', '=COUNTIF(' + TK + 'J2:J,"backfill")'],
    ['Delivered (intake → delivery)', '=COUNTIF(' + TK + 'G2:G,"Delivered")+COUNTIF(' + TK + 'G2:G,"Archived")'],
    ['Open', '=COUNTIF(' + TK + 'O2:O,TRUE)'],
    ['Overdue', '=COUNTIFS(' + TK + 'O2:O,TRUE,' + TK + 'L2:L,"<"&TODAY())'],
    ['Due in next 48 hours', '=COUNTIFS(' + TK + 'O2:O,TRUE,' + TK + 'L2:L,">="&TODAY(),' + TK + 'L2:L,"<="&TODAY()+2)'],
    ['Median cycle time (days, requested → delivered)', '=IFERROR(MEDIAN(FILTER(' + TK + 'M2:M-' + TK + 'K2:K,' + TK + 'M2:M<>"",' + TK + 'K2:K<>"")),"—")'],
    ['On-time delivery %', '=IFERROR(SUMPRODUCT((' + TK + 'M2:M<>"")*(' + TK + 'L2:L<>"")*(' + TK + 'M2:M<=' + TK + 'L2:L))/SUMPRODUCT((' + TK + 'M2:M<>"")*(' + TK + 'L2:L<>"")),"—")'],
  ];
  dash.getRange(6, 1, kpis.length, 2).setValues(kpis);
  dash.getRange('B14').setNumberFormat('0%');
  dash.getRange('B6:B14').setFontWeight('bold').setHorizontalAlignment('right');

  // By status
  head('A16', 'Tickets by status');
  CONFIG.SECTIONS.forEach(function (s, i) {
    dash.getRange(17 + i, 1, 1, 2).setValues([[s, '=COUNTIF(' + TK + 'G2:G,A' + (17 + i) + ')']]);
  });

  // Status lookup (XLOOKUP): by ticket ID, else by part of the name
  head('A25', 'Status lookup — type a ticket ID or part of its name ✏️');
  dash.getRange('B26').setBackground('#fff2cc');
  dash.getRange('A26').setValue('Ticket ID / name →');
  [['Status', 'G'], ['Owner', 'F'], ['Due', 'L'], ['Asana link', 'Q']].forEach(function (r, i) {
    var col = TK + '$' + r[1] + '$2:$' + r[1];
    dash.getRange(27 + i, 1, 1, 2).setValues([[r[0],
      '=IF($B$26="","",IFERROR(XLOOKUP(TO_TEXT($B$26),' + TK + '$A$2:$A,' + col + '),XLOOKUP("*"&$B$26&"*",' + TK + '$B$2:$B,' + col + ',"Not found",2)))']]);
  });
  dash.getRange('B29').setNumberFormat('yyyy-mm-dd');

  // Workload by owner + flags (QUERY)
  head('D5', 'Open tickets by owner');
  dash.getRange('D6').setFormula('=IFERROR(QUERY(' + TK + 'A1:Q,"select F, count(A) where O = true group by F order by count(A) desc label F \'Owner\', count(A) \'Open\'",1),"No open tickets")');
  head('D20', '⚠ Workload spikes (owner over threshold)');
  dash.getRange('D21').setFormula('=IFERROR(QUERY(QUERY(' + TK + 'A1:Q,"select F, count(A) where O = true group by F",1),"select Col1, Col2 where Col2 > "&$B$3&" label Col1 \'Owner\', Col2 \'Open\'",1),"None ✅")');
  head('D30', '⚠ Scheduling conflicts (same owner, 2+ due same day)');
  dash.getRange('D31').setFormula('=IFERROR(QUERY(QUERY(' + TK + 'A1:Q,"select F, L, count(A) where O = true and L is not null group by F, L",1),"select Col1, Col2, Col3 where Col3 >= 2 label Col1 \'Owner\', Col2 \'Due\', Col3 \'Deliverables\'",1),"None ✅")');

  // Date-based lists (FILTER)
  var cols = '{' + TK + 'B2:B,' + TK + 'F2:F,' + TK + 'L2:L,' + TK + 'G2:G}';
  var listHeader = [['Task', 'Owner', 'Due', 'Status']];
  [
    ['H', '🔴 Overdue', TK + 'L2:L<TODAY()'],
    ['M', '🟠 Due in next 48 hours', TK + 'L2:L>=TODAY(),' + TK + 'L2:L<=TODAY()+2'],
    ['R', '📅 Due this week (Mon–Sun)', TK + 'L2:L>=' + MONDAY + ',' + TK + 'L2:L<' + MONDAY + '+7'],
  ].forEach(function (l) {
    head(l[0] + '5', l[1]);
    dash.getRange(l[0] + '6').offset(0, 0, 1, 4).setValues(listHeader).setFontWeight('bold');
    dash.getRange(l[0] + '7').setFormula('=IFERROR(FILTER(' + cols + ',' + TK + 'O2:O=TRUE,' + TK + 'L2:L<>"",' + l[2] + '),"None ✅")');
    dash.getRange(l[0] + '7').offset(0, 2, 60, 1).setNumberFormat('yyyy-mm-dd');
  });

  // Highlight problems
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground('#f4c7c3').setRanges([dash.getRange('B11')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground('#fce8b2').setRanges([dash.getRange('B12')]).build(),
  ];
  dash.setConditionalFormatRules(rules);
  formatTicketsTab_(tickets);

  // Charts
  var cd = buildChartData_(ss);
  dash.insertChart(dash.newChart().asLineChart().addRange(cd.getRange('A1:C13'))
    .setOption('title', 'Requests created vs delivered per week').setOption('legend', { position: 'bottom' })
    .setPosition(36, 1, 0, 0).setOption('width', 520).setOption('height', 260).build());
  dash.insertChart(dash.newChart().asColumnChart().addRange(dash.getRange('D6:E18'))
    .setOption('title', 'Open tickets by owner').setOption('legend', { position: 'none' })
    .setPosition(36, 6, 0, 0).setOption('width', 480).setOption('height', 260).build());

  // Pivot: request type × month
  head('A52', 'Requests by type × month (pivot table)');
  var pivot = dash.getRange('A53').createPivotTable(tickets.getRange(1, 1, Math.max(tickets.getMaxRows(), 2), TICKET_HEADERS.length));
  pivot.addRowGroup(3);
  pivot.addColumnGroup(16);
  pivot.addPivotValue(1, SpreadsheetApp.PivotTableSummarizeFunction.COUNTA);
  pivot.addFilter(3, SpreadsheetApp.newFilterCriteria().whenCellNotEmpty().build());

  dash.setColumnWidth(1, 330);
  dash.setFrozenRows(3);
  addTicketFilterViews_(ss, tickets);
  Logger.log('Dashboard ready: ' + ss.getUrl() + '#gid=' + dash.getSheetId());
}

/** Colour rows on the Tickets tab: red overdue, amber due in 48h, grey done. */
function formatTicketsTab_(sh) {
  var range = sh.getRange('A2:Q' + sh.getMaxRows());
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($O2=TRUE,$L2<>"",$L2<TODAY())').setBackground('#f4c7c3').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($O2=TRUE,$L2<>"",$L2>=TODAY(),$L2<=TODAY()+2)').setBackground('#fce8b2').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$O2=FALSE').setFontColor('#999999').setRanges([range]).build(),
  ]);
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 320);
}

/** Last 12 weeks: requests created vs delivered (feeds the line chart). */
function buildChartData_(ss) {
  var sh = ss.getSheetByName('ChartData') || ss.insertSheet('ChartData');
  sh.clear();
  sh.getRange('A1:C1').setValues([['Week of', 'Created', 'Delivered']]);
  for (var i = 0; i < 12; i++) {
    var r = i + 2;
    sh.getRange(r, 1, 1, 3).setFormulas([[
      i === 0 ? '=' + MONDAY + '-77' : '=A' + (r - 1) + '+7',
      '=COUNTIFS(' + TK + '$K$2:$K,">="&A' + r + ',' + TK + '$K$2:$K,"<"&A' + r + '+7)',
      '=COUNTIFS(' + TK + '$M$2:$M,">="&A' + r + ',' + TK + '$M$2:$M,"<"&A' + r + '+7)',
    ]]);
  }
  sh.getRange('A2:A13').setNumberFormat('mmm d');
  return sh;
}

/**
 * Saved filter views on Tickets (Data → Filter views): each person can use one
 * without changing what everyone else sees. Needs the Sheets advanced service.
 */
function addTicketFilterViews_(ss, sh) {
  var sheetId = sh.getSheetId();
  var meta = Sheets.Spreadsheets.get(ss.getId(), { fields: 'sheets(properties.sheetId,filterViews(filterViewId,title))' });
  var requests = [];
  (meta.sheets || []).forEach(function (s) {
    if (s.properties.sheetId !== sheetId) return;
    (s.filterViews || []).forEach(function (fv) {
      requests.push({ deleteFilterView: { filterId: fv.filterViewId } });
    });
  });
  var range = { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: TICKET_HEADERS.length };
  var byDue = [{ dimensionIndex: 11, sortOrder: 'ASCENDING' }];
  var formula = function (col, f) {
    return [{ columnIndex: col, filterCriteria: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] } } }];
  };
  [
    ['Open tickets (by due date)', formula(14, '=$O2=TRUE'), byDue],
    ['Overdue', formula(11, '=AND($O2=TRUE,$L2<>"",$L2<TODAY())'), byDue],
    ['Due in 48 hours', formula(11, '=AND($O2=TRUE,$L2<>"",$L2>=TODAY(),$L2<=TODAY()+2)'), byDue],
    ['Rush requests', formula(8, '=$I2="Yes"'), byDue],
    ['Open by owner', formula(14, '=$O2=TRUE'), [{ dimensionIndex: 5, sortOrder: 'ASCENDING' }, byDue[0]]],
    ['Backfilled requests', formula(9, '=$J2="backfill"'), [{ dimensionIndex: 10, sortOrder: 'ASCENDING' }]],
  ].forEach(function (v) {
    requests.push({ addFilterView: { filter: { title: v[0], range: range, filterSpecs: v[1], sortSpecs: v[2] } } });
  });
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
}

/**
 * The weekly status update: sync → numbers + flags → email to you, ready to
 * forward to the exec team. This is what replaces chasing status in DMs.
 */
function sendWeeklySummary() {
  var ss = reportSpreadsheet_();
  var tickets = syncTickets();
  var dash = ss.getSheetByName('Dashboard');
  var threshold = (dash && Number(dash.getRange('B3').getValue())) || 5;
  var today = todayIso_();
  var s = summarizeTickets(tickets, today, threshold);
  var boardUrl = 'https://app.asana.com/0/' + activeProjectGid_() + '/board';

  var list = function (items, fmt) {
    return items.length ? '<ul>' + items.map(function (t) { return '<li>' + fmt(t) + '</li>'; }).join('') + '</ul>' : '<p style="color:#2e7d32">None ✅</p>';
  };
  var task = function (t) { return escapeHtml_(t.name) + ' — ' + escapeHtml_(t.owner) + ', due ' + t.due + ' (' + t.status + ')'; };

  var html = [
    '<h2 style="margin:0">WiCS Marketing — weekly status (' + today + ')</h2>',
    '<p><b>' + s.open + '</b> open · <b>' + s.createdThisWeek + '</b> new this week · <b>' + s.deliveredThisWeek + '</b> delivered this week · ' +
      '<b>' + s.total + '</b> tracked in total (' + s.fromForm + ' via form, ' + s.fromBackfill + ' backfilled) · ' +
      'median cycle time <b>' + (s.medianCycleDays === null ? '—' : s.medianCycleDays + ' days') + '</b> · on-time <b>' + (s.onTimePct === null ? '—' : s.onTimePct + '%') + '</b></p>',
    '<h3>🔴 Overdue (' + s.overdue.length + ')</h3>' + list(s.overdue, task),
    '<h3>🟠 Due in the next 48 hours (' + s.due48h.length + ')</h3>' + list(s.due48h, task),
    '<h3>📅 Due this week (' + s.dueThisWeek.length + ')</h3>' + list(s.dueThisWeek, task),
    '<h3>⚠ Workload spikes (more than ' + threshold + ' open)</h3>' + list(s.spikes, function (x) { return escapeHtml_(x.owner) + ': ' + x.open + ' open'; }),
    '<h3>⚠ Scheduling conflicts</h3>' + list(s.conflicts, function (c) { return escapeHtml_(c.owner) + ' has ' + c.tasks.length + ' due on ' + c.due + ': ' + c.tasks.map(escapeHtml_).join('; '); }),
    '<h3>Open by owner</h3>' + list(Object.keys(s.byOwner).map(function (o) { return { owner: o, n: s.byOwner[o] }; }), function (x) { return escapeHtml_(x.owner) + ': ' + x.n; }),
    '<p><a href="' + ss.getUrl() + '">Dashboard</a> · <a href="' + boardUrl + '">Asana board</a></p>',
  ].join('\n');

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'WiCS Marketing — weekly status (' + today + ')' + (currentMode_() === 'test' ? ' [TEST BOARD]' : ''),
    htmlBody: html,
    name: 'WiCS Creative Ops',
  });
  logRun_('sendWeeklySummary', 'ok', '', JSON.stringify({ open: s.open, overdue: s.overdue.length, spikes: s.spikes.length, conflicts: s.conflicts.length }));
}

/** Monday-morning job: archive old Delivered cards, then send the summary. */
function weeklyJob() {
  archiveDelivered();
  sendWeeklySummary();
}

/** Hourly sync + Monday 8am weekly job. Re-running replaces, never duplicates. */
function installReportTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncTickets', 'weeklyJob'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTickets').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('weeklyJob').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(CONFIG.TIMEZONE).create();
  Logger.log('Installed: hourly syncTickets, Monday 8am weeklyJob.');
}
