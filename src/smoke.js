/**
 * smoke.js — live end-to-end check against the TEST Asana board.
 *
 * WHY: unit tests prove the rules; this proves the wiring (Asana token, sections,
 * Drive folder, email, logs) actually works. It refuses to run in live mode so
 * test tickets never land on the real board. Emails go to YOU, not to anyone else.
 * These are clearly-labelled TEST tickets and are NOT counted as real requests.
 */
function runSmokeTests() {
  if (currentMode_() !== 'test') throw new Error('runSmokeTests only runs in test mode. Run useTestMode() first.');
  var me = Session.getEffectiveUser().getEmail();
  var stamp = new Date().getTime();
  var inDays = function (n) {
    return Utilities.formatDate(new Date(Date.now() + n * 86400000), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  };

  var cases = [
    {
      label: 'complete, normal lead time → Intake, P3',
      raw: {
        requestorName: 'SMOKE TEST',
        requestorEmail: me,
        type: 'Instagram post',
        event: 'Smoke Test Event',
        description:
          'TEST ONLY. Announcement post for the smoke test event, aimed at first-year students, asking them to register before the deadline.',
        channels: ['Instagram feed'],
        neededBy: inDays(14),
        copy: 'Smoke Test Event — register by Friday!',
        references: 'none',
        sponsor: 'No',
      },
      expect: { section: 'Intake', rush: false },
    },
    {
      label: 'incomplete (short description, TBD copy, no refs for a reel) → Needs Info',
      raw: {
        requestorName: 'SMOKE TEST',
        requestorEmail: me,
        type: 'Reel',
        event: 'Smoke Test Event',
        description: 'TEST ONLY. Need a reel.',
        channels: ['Instagram feed'],
        neededBy: inDays(20),
        copy: 'TBD',
        references: 'none',
        sponsor: 'No',
      },
      expect: { section: 'Needs Info', rush: false },
    },
    {
      label: 'rush (poster due in 2 days, lead time 10) + sponsor → Rush, P1',
      raw: {
        requestorName: 'SMOKE TEST',
        requestorEmail: me,
        type: 'Poster/Print',
        event: 'Smoke Test Event',
        eventDate: inDays(5),
        description:
          'TEST ONLY. Printed poster for the smoke test event to put up around the engineering building, includes sponsor logo at the bottom.',
        channels: ['Print / on campus'],
        neededBy: inDays(2),
        copy: 'Smoke Test Event · Room 1234 · 6pm',
        references: 'https://example.com/ref',
        sponsor: 'Yes',
      },
      expect: { section: 'Intake', rush: true, priority: 'P1' },
    },
  ];

  var results = cases.map(function (c, i) {
    var id = 'smoke-' + stamp + '-' + i;
    var out = processSubmission(c.raw, id, 'form');
    var task = asanaGetTask_(out.taskGid);
    var section = task.memberships
      .map(function (m) {
        return m.section && m.section.name;
      })
      .filter(Boolean)[0];
    var ok =
      section === c.expect.section &&
      out.rush === c.expect.rush &&
      (!c.expect.priority || out.priority === c.expect.priority) &&
      !!task.due_on;
    return {
      label: c.label,
      ok: ok,
      section: section,
      rush: out.rush,
      priority: out.priority,
      due: task.due_on,
      assignee: task.assignee && task.assignee.name,
      id: id,
      url: out.taskUrl,
    };
  });

  // Idempotency: re-running the first submission must NOT create a second task.
  var again = processSubmission(cases[0].raw, results[0].id, 'form');
  results.push({ label: 're-run same response → no duplicate', ok: again.duplicate === true });

  results.forEach(function (r) {
    Logger.log(
      (r.ok ? 'PASS ' : 'FAIL ') +
        r.label +
        (r.url ? '  [' + r.section + ', ' + r.priority + ', due ' + r.due + ', ' + r.assignee + '] ' + r.url : ''),
    );
  });
  var failed = results.filter(function (r) {
    return !r.ok;
  }).length;
  logRun_('runSmokeTests', failed ? 'FAIL (' + failed + ')' : 'PASS', '', JSON.stringify(results).slice(0, 1900));
  if (failed) throw new Error(failed + ' smoke test(s) failed — see log above.');
}
