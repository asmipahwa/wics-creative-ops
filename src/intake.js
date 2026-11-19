/**
 * intake.js — what happens the moment someone submits the request form.
 *
 *   form answers → tidy request → completeness check → routing (owner + lead time)
 *   → Drive working folder → Asana task (Intake or Needs Info column)
 *   → IntakeLog row → confirmation email → RunLog row
 */

/** Installable trigger target (installed by installFormTrigger in setup.js). */
function onFormSubmit(e) {
  var response = e.response;
  return processSubmission(answersFromFormResponse_(response), response.getId(), 'form');
}

/**
 * The whole intake pipeline, separate from the form event so smoke tests and
 * re-runs can call it directly. Returns a summary of what it did.
 */
function processSubmission(raw, responseId, source) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // two submissions at once must not both pass the duplicate check
  try {
    // 1. Idempotency: the same response never becomes two tickets.
    var existing = findIntakeByResponseId_(responseId);
    if (existing) {
      logRun_('processSubmission', 'skipped (already processed)', existing.taskGid, 'response ' + responseId);
      return { duplicate: true, taskGid: existing.taskGid, taskUrl: existing.taskUrl };
    }

    // 2. Decide: complete? who owns it? rush?
    var req = normalizeRequest(raw);
    var route = findRoute(req.type, readRouting_());
    var today = todayIso_();
    var timing = assessTiming(req.neededBy, today, route.leadDays);
    var missing = checkCompleteness(req, route, CONFIG.MIN_DESCRIPTION_WORDS);
    var priority = priorityFor(timing, req.sponsor);
    var sectionName = missing.length ? 'Needs Info' : 'Intake';

    // 3. Working folder in Drive (so the ticket can link to it).
    var folder = createRequestFolder_(req, responseId);

    // 4. Asana ticket.
    var name = buildTaskName(req);
    var notes = buildTaskNotes(req, {
      priority: priority,
      rush: timing.rush,
      daysUntilDue: timing.daysUntilDue,
      leadDays: route.leadDays,
      sponsor: req.sponsor,
      ownerName: route.ownerName,
      ownerEmail: route.ownerEmail,
      requestedDate: today,
      folderUrl: folder.getUrl(),
      missing: missing,
      source: source,
      responseId: responseId,
    });
    var tags = ['type: ' + req.type, 'source: ' + source, priority];
    if (timing.rush) tags.push('Rush');
    if (missing.length) tags.push('Needs Info');
    if (req.sponsor) tags.push('Sponsor');

    var task = asanaCreateTask_({
      name: name,
      notes: notes,
      assignee: route.ownerEmail || 'me',
      dueOn: req.neededBy,
      tags: tags,
      sectionName: sectionName,
    });

    // 5. Log it immediately — this row is what prevents duplicates on a re-run.
    appendIntakeLog_([
      new Date(), responseId, task.gid, task.url, name, req.type, req.event, req.requestorName,
      req.requestorEmail, task.assigneeName, req.neededBy, priority, sectionName,
      timing.rush ? 'Yes' : 'No', missing.join(' | '), source, folder.getUrl(),
    ]);

    // 6. Tell the requestor. A failed email shouldn't undo a created ticket, so it's caught separately.
    try {
      sendConfirmationEmail_(req, {
        taskGid: task.gid,
        taskUrl: task.url,
        taskName: name,
        ownerName: task.assigneeName || route.ownerName,
        priority: priority,
        timing: timing,
        leadDays: route.leadDays,
        missing: missing,
      });
    } catch (mailErr) {
      logRun_('sendConfirmationEmail_', 'error', task.gid, mailErr.stack || String(mailErr));
    }

    logRun_('processSubmission', 'ok', task.gid, sectionName + (timing.rush ? ', rush' : '') + (task.assigneeFellBack ? ', owner not in Asana → assigned to you' : ''));
    return { duplicate: false, taskGid: task.gid, taskUrl: task.url, section: sectionName, missing: missing, rush: timing.rush, priority: priority };
  } catch (err) {
    logRun_('processSubmission', 'error', '', 'response ' + responseId + ': ' + (err.stack || err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** FormResponse → {requestorName: …, type: …} using the question titles in Q. */
function answersFromFormResponse_(response) {
  var titleToKey = {};
  Object.keys(Q).forEach(function (k) {
    titleToKey[Q[k].toLowerCase()] = k;
  });
  var raw = {};
  response.getItemResponses().forEach(function (ir) {
    var key = titleToKey[ir.getItem().getTitle().trim().toLowerCase()];
    if (!key) return; // a question we don't know about — ignore rather than crash
    var value = ir.getResponse();
    if (key === 'uploads') {
      value = [].concat(value).map(function (id) {
        return 'https://drive.google.com/open?id=' + id;
      });
    }
    raw[key] = value;
  });
  return raw;
}
