/**
 * logic.js — the "thinking" part of intake, with NO Google or Asana calls.
 *
 * WHY a separate file: these rules (is it complete? who owns it? is it a rush?)
 * are the decisions a coordinator makes by hand. Keeping them pure means they
 * can be unit-tested on a laptop with Jest, without a form, a Sheet or Asana.
 * Apps Script ignores the `module.exports` line at the bottom; Node uses it.
 */

// Answers that technically fill a required field but don't really give us anything.
var PLACEHOLDER_RE = /^(tbd|tba|n\/?a|none|no|nope|idk|not sure|-+|\.+|\?+|x)$/i;

/** Trim and turn null/undefined into ''. */
function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Checkbox and upload answers arrive as arrays; text may arrive as "a, b". */
function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value).split(',').map(clean).filter(Boolean);
}

/** Accept 'YYYY-MM-DD', 'M/D/YYYY' or a Date; return 'YYYY-MM-DD' or ''. */
function toIsoDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
  }
  var s = clean(value);
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + pad2(iso[2]) + '-' + pad2(iso[3]);
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return us[3] + '-' + pad2(us[1]) + '-' + pad2(us[2]);
  return '';
}

function pad2(n) {
  return ('0' + Number(n)).slice(-2);
}

/** Whole days from one ISO date to another (negative if `to` is earlier). */
function daysBetween(fromIso, toIso) {
  var a = fromIso.split('-').map(Number);
  var b = toIso.split('-').map(Number);
  var ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
  return Math.round(ms / 86400000);
}

function wordCount(text) {
  var t = clean(text);
  return t ? t.split(/\s+/).length : 0;
}

function isPlaceholder(text) {
  var t = clean(text);
  return t === '' || PLACEHOLDER_RE.test(t);
}

/**
 * Turn raw answers (keyed like `Q` in config.js) into one tidy request object.
 * WHY: every later step can trust the shape (dates are ISO, lists are arrays).
 */
function normalizeRequest(raw) {
  return {
    requestorName: clean(raw.requestorName),
    requestorEmail: clean(raw.requestorEmail).toLowerCase(),
    type: clean(raw.type) || 'Other',
    event: clean(raw.event) || 'General',
    eventDate: toIsoDate(raw.eventDate),
    description: clean(raw.description),
    channels: toList(raw.channels),
    neededBy: toIsoDate(raw.neededBy),
    copy: clean(raw.copy),
    references: clean(raw.references),
    uploads: toList(raw.uploads),
    sponsor: /^y/i.test(clean(raw.sponsor)),
    notes: clean(raw.notes),
  };
}

/**
 * Pick the routing rule for a request type from the Routing tab rows.
 * Falls back to the "Default" row, then to a built-in rule, so a typo in the
 * Sheet never stops a request from being created.
 */
function findRoute(type, routingRows) {
  var rows = routingRows || [];
  var wanted = clean(type).toLowerCase();
  var match = null;
  var fallback = null;
  for (var i = 0; i < rows.length; i++) {
    var rowType = clean(rows[i].type).toLowerCase();
    if (rowType === wanted) match = rows[i];
    if (rowType === 'default') fallback = rows[i];
  }
  var base = { ownerName: '', ownerEmail: '', leadDays: 5, needsReferences: false, needsEventDate: false };
  var route = Object.assign({}, base, fallback || {}, match || {});
  // A blank owner on the specific row should inherit the Default owner.
  if (!clean(route.ownerEmail) && fallback) {
    route.ownerName = fallback.ownerName;
    route.ownerEmail = fallback.ownerEmail;
  }
  route.leadDays = Number(route.leadDays) || base.leadDays;
  route.type = match ? match.type : type;
  return route;
}

/**
 * Spec §2.3: what's missing from a request? Returns plain-English items to
 * paste straight into the "Needs Info" email. Empty array = complete.
 */
function checkCompleteness(req, route, minWords) {
  var missing = [];
  var min = minWords || 15;
  if (wordCount(req.description) < min) {
    missing.push('A fuller description of what you need (at least ' + min + ' words: what it is, who it is for, key details)');
  }
  if (isPlaceholder(req.copy)) {
    missing.push('The key copy / text that should appear on the asset');
  }
  if (route && route.needsReferences && isPlaceholder(req.references) && req.uploads.length === 0) {
    missing.push('Reference links or files (examples, brand assets, photos) — this request type is design-heavy');
  }
  if (route && route.needsEventDate && !req.eventDate) {
    missing.push('The event date');
  }
  if (!req.neededBy) {
    missing.push('The date you need this by');
  }
  return missing;
}

/** Is the needed-by date shorter than the lead time for this type? */
function assessTiming(neededByIso, todayIso, leadDays) {
  if (!neededByIso) return { daysUntilDue: null, rush: false };
  var days = daysBetween(todayIso, neededByIso);
  return { daysUntilDue: days, rush: days < leadDays };
}

/**
 * Simple, explainable priority:
 *   P1 = rush or due within 3 days, P2 = sponsor involved or due within a week, P3 = everything else.
 */
function priorityFor(timing, sponsor) {
  var d = timing.daysUntilDue;
  if (timing.rush || (d !== null && d <= 3)) return 'P1';
  if (sponsor || (d !== null && d <= 7)) return 'P2';
  return 'P3';
}

/** "Reel – TryCATCH 2026 – 30-second recap of the hackathon…" (scannable on a board card). */
function buildTaskName(req) {
  var words = clean(req.description).split(/\s+/).slice(0, 7).join(' ');
  var name = req.type + ' – ' + req.event + (words ? ' – ' + words : '');
  return name.length > 120 ? name.slice(0, 117) + '...' : name;
}

/**
 * Task description. WHY structured "Label: value" lines: Asana's free plan has
 * no custom fields, so this text IS our field storage. sync.js parses it back.
 */
function buildTaskNotes(req, ctx) {
  var lines = [
    'Requestor: ' + req.requestorName + (req.requestorEmail ? ' <' + req.requestorEmail + '>' : ''),
    'Request type: ' + req.type,
    'Event: ' + req.event,
    'Event date: ' + (req.eventDate || '—'),
    'Channel(s): ' + (req.channels.join(', ') || '—'),
    'Needed by: ' + (req.neededBy || '—'),
    'Priority: ' + ctx.priority,
    'Rush: ' + (ctx.rush ? 'Yes (needed in ' + ctx.daysUntilDue + ' days, lead time is ' + ctx.leadDays + ')' : 'No'),
    'Sponsor/partner involved: ' + (req.sponsor ? 'Yes' : 'No'),
    'Owner (routing): ' + (ctx.ownerName || ctx.ownerEmail || 'unassigned → you'),
    'Requested date: ' + ctx.requestedDate,
    'Delivered date: ' + (ctx.deliveredDate || ''),
    'Asset link: ' + (ctx.assetLink || ''),
    'Working folder: ' + (ctx.folderUrl || '—'),
    '',
    "— What's needed —",
    req.description || '—',
    '',
    '— Key copy —',
    req.copy || '—',
    '',
    '— References —',
    req.references || '—',
  ];
  if (req.uploads.length) lines.push('Uploaded files: ' + req.uploads.join(' '));
  if (req.notes) lines.push('', '— Notes —', req.notes);
  if (ctx.missing && ctx.missing.length) {
    lines.push('', '— MISSING INFO (requestor emailed) —');
    ctx.missing.forEach(function (m) {
      lines.push('• ' + m);
    });
  }
  lines.push('', 'source: ' + ctx.source, 'form_response_id: ' + ctx.responseId);
  return lines.join('\n');
}

/** "TryCATCH 2026" → "TryCATCH2026"; "event promo" → "EventPromo". Keeps names Drive-safe. */
function slugPart(text) {
  return clean(text)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');
}

/** Working-folder name following the naming convention: YYYY-MM-DD_Event_Type_ID. */
function requestFolderName(req, responseId) {
  var shortId =
    clean(responseId)
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(-6) || 'NOID';
  return [req.neededBy || 'NoDate', slugPart(req.event) || 'General', slugPart(req.type) || 'Other', shortId].join('_');
}

/** Retry only on "slow down" (429) and server errors (5xx). Other errors are our fault — don't hammer. */
function shouldRetry(status) {
  return status === 429 || status >= 500;
}

/** Wait time before retry #attempt: Asana's Retry-After if given, else 1s, 2s, 4s… capped at 32s. */
function backoffMs(attempt, retryAfterSeconds) {
  var ra = Number(retryAfterSeconds);
  if (ra > 0) return ra * 1000;
  return Math.min(1000 * Math.pow(2, attempt), 32000);
}

// ───────────────────────── Sprint 2: backfill, sync, report ─────────────────────────

var PIPELINE_SECTIONS = ['Intake', 'Needs Info', 'In Progress', 'In Review', 'Approved / Scheduled', 'Delivered', 'Archived'];
var DONE_SECTIONS = ['Delivered', 'Archived'];

/** Map a free-typed status ("delivered", "in progress", "done") to a board column, or '' if unknown. */
function normalizeStatus(status) {
  var s = clean(status).toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  var aliases = {
    done: 'Delivered',
    posted: 'Delivered',
    published: 'Delivered',
    complete: 'Delivered',
    completed: 'Delivered',
    wip: 'In Progress',
    'in-progress': 'In Progress',
    review: 'In Review',
    approved: 'Approved / Scheduled',
    scheduled: 'Approved / Scheduled',
    'needs info': 'Needs Info',
    new: 'Intake',
    todo: 'Intake',
    'to do': 'Intake',
    cancelled: 'Archived',
    canceled: 'Archived',
  };
  if (aliases[s]) return aliases[s];
  for (var i = 0; i < PIPELINE_SECTIONS.length; i++) {
    if (PIPELINE_SECTIONS[i].toLowerCase() === s) return PIPELINE_SECTIONS[i];
  }
  return '';
}

/**
 * Check one backfill row before it goes to Asana. Returns a list of problems
 * (empty = OK). WHY strict: backfilled requests are the evidence behind
 * "tracked 40+ requests", so each one must have real dates, a type and an owner.
 */
function validateBackfillRow(row, validTypes) {
  var errors = [];
  if (!toIsoDate(row.requested_date)) errors.push('requested_date missing/invalid');
  if (!clean(row.type)) errors.push('type missing');
  else if (validTypes && validTypes.indexOf(clean(row.type)) === -1)
    errors.push('type "' + clean(row.type) + '" not one of the request types');
  if (!clean(row.event)) errors.push('event missing (use "General")');
  if (!clean(row.description)) errors.push('description missing');
  if (!clean(row.owner)) errors.push('owner missing');
  if (!normalizeStatus(row.status)) errors.push('status "' + clean(row.status) + '" not recognised');
  if (clean(row.delivered_date) && !toIsoDate(row.delivered_date)) errors.push('delivered_date invalid');
  if (normalizeStatus(row.status) === 'Delivered' && !toIsoDate(row.delivered_date))
    errors.push('status is Delivered but delivered_date is empty');
  if (clean(row.due_date) && !toIsoDate(row.due_date)) errors.push('due_date invalid');
  return errors;
}

/** The text we hash to spot a re-imported row (spec §3.2: date + type + event + description). */
function backfillKey(row) {
  return [toIsoDate(row.requested_date), clean(row.type), clean(row.event), clean(row.description)]
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Owner can be an email or a name from the Routing tab. Returns an email, or '' (→ assigned to you). */
function resolveOwnerEmail(owner, routingRows) {
  var o = clean(owner);
  if (o.indexOf('@') > 0) return o.toLowerCase();
  var rows = routingRows || [];
  for (var i = 0; i < rows.length; i++) {
    if (clean(rows[i].ownerName).toLowerCase() === o.toLowerCase() && clean(rows[i].ownerEmail)) return clean(rows[i].ownerEmail);
  }
  return '';
}

/** Read the "Label: value" lines our task descriptions use back into an object. First occurrence wins. */
function parseTaskNotes(notes) {
  var out = {};
  String(notes || '')
    .split('\n')
    .forEach(function (line) {
      var m = line.match(/^([A-Za-z][A-Za-z /()'_-]{0,40}):\s?(.*)$/);
      if (!m) return;
      var key = m[1].trim().toLowerCase();
      if (!(key in out)) out[key] = m[2].trim();
    });
  var requestor = (out['requestor'] || '').replace(/\s*<[^>]*>\s*$/, '');
  var emailMatch = (out['requestor'] || '').match(/<([^>]+@[^>]+)>/);
  return {
    requestor: requestor,
    type: out['request type'] || '',
    event: out['event'] || '',
    neededBy: toIsoDate(out['needed by']),
    priority: /^P[123]$/.test(out['priority'] || '') ? out['priority'] : '',
    rush: /^yes/i.test(out['rush'] || ''),
    requestedDate: toIsoDate(out['requested date']),
    deliveredDate: toIsoDate(out['delivered date']),
    assetLink: out['asset link'] || '',
    source: out['source'] || '',
    requestorEmail: emailMatch ? emailMatch[1] : '',
    idleCheckSent: toIsoDate(out['idle check sent']),
  };
}

/**
 * Spec: tickets idle 14+ days → "still needed?" email; no reply 7 days after → flag for archive.
 * "Idle" = Asana says nothing changed on the task. Returns 'ask', 'flag' or ''.
 */
function idleAction(ticketOpen, modifiedIso, idleCheckSentIso, todayIso) {
  if (!ticketOpen || !modifiedIso) return '';
  if (idleCheckSentIso) {
    // Our own stamp changes modified_at by a day at most; anything later means someone replied/acted.
    var touchedSince = daysBetween(idleCheckSentIso, modifiedIso) > 1;
    return !touchedSince && daysBetween(idleCheckSentIso, todayIso) >= 7 ? 'flag' : '';
  }
  return daysBetween(modifiedIso, todayIso) >= 14 ? 'ask' : '';
}

/** Replace (or append) one "Label: value" line in a description, leaving everything else untouched. */
function setNoteField(notes, label, value) {
  var text = String(notes || '');
  var re = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ':.*$', 'm');
  var line = label + ': ' + value;
  return re.test(text) ? text.replace(re, line) : line + '\n' + text;
}

/**
 * One Asana task → one row of the Tickets tab. `task._completedLocal` is the
 * completion date already converted to Vancouver time by the caller.
 * Also says whether the task still needs its Delivered date written into Asana.
 */
function ticketFromTask(task, projectGid, todayIso) {
  var meta = parseTaskNotes(task.notes);
  var section = '';
  (task.memberships || []).forEach(function (m) {
    if (m.project && m.project.gid === projectGid && m.section) section = m.section.name;
  });
  var isDone = DONE_SECTIONS.indexOf(section) !== -1 || !!task.completed;
  var completedIso = task._completedLocal || (task.completed_at ? String(task.completed_at).slice(0, 10) : '');
  var delivered = meta.deliveredDate || (isDone ? completedIso || todayIso : '');
  var requested = meta.requestedDate || (task.created_at ? String(task.created_at).slice(0, 10) : '');
  var due = task.due_on || meta.neededBy || '';
  return {
    id: String(task.gid),
    name: task.name || '',
    type: meta.type,
    event: meta.event,
    requestor: meta.requestor,
    owner: task.assignee ? task.assignee.name : '(unassigned)',
    status: section || (task.completed ? 'Delivered' : 'Intake'),
    priority: meta.priority,
    rush: meta.rush,
    source: meta.source || 'manual',
    requested: requested,
    due: due,
    delivered: delivered,
    daysOpen: requested ? daysBetween(requested, delivered || todayIso) : '',
    open: !isDone,
    month: requested ? requested.slice(0, 7) : '',
    link: task.permalink_url || '',
    needsDeliveredStamp: isDone && !meta.deliveredDate,
  };
}

function median(nums) {
  if (!nums.length) return null;
  var s = nums.slice().sort(function (a, b) {
    return a - b;
  });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Everything the weekly status update needs, computed from the ticket rows.
 * Mirrors the Dashboard formulas so the email and the Sheet always agree.
 */
function summarizeTickets(tickets, todayIso, spikeThreshold) {
  var open = tickets.filter(function (t) {
    return t.open;
  });
  var delivered = tickets.filter(function (t) {
    return t.delivered;
  });
  var dueIn = function (t) {
    return t.due ? daysBetween(todayIso, t.due) : null;
  };

  var byOwner = {};
  var byOwnerDay = {};
  open.forEach(function (t) {
    byOwner[t.owner] = (byOwner[t.owner] || 0) + 1;
    if (t.due) {
      var k = t.owner + '|' + t.due;
      (byOwnerDay[k] = byOwnerDay[k] || []).push(t.name);
    }
  });
  var spikes = Object.keys(byOwner)
    .filter(function (o) {
      return byOwner[o] > spikeThreshold;
    })
    .map(function (o) {
      return { owner: o, open: byOwner[o] };
    })
    .sort(function (a, b) {
      return b.open - a.open;
    });
  var conflicts = Object.keys(byOwnerDay)
    .filter(function (k) {
      return byOwnerDay[k].length >= 2;
    })
    .map(function (k) {
      var p = k.split('|');
      return { owner: p[0], due: p[1], tasks: byOwnerDay[k] };
    })
    .sort(function (a, b) {
      return a.due < b.due ? -1 : 1;
    });

  var cycle = delivered
    .filter(function (t) {
      return t.requested;
    })
    .map(function (t) {
      return daysBetween(t.requested, t.delivered);
    });
  var withDue = delivered.filter(function (t) {
    return t.due;
  });
  var onTime = withDue.filter(function (t) {
    return t.delivered <= t.due;
  }).length;
  var monday = (function () {
    var p = todayIso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var back = (d.getUTCDay() + 6) % 7;
    return daysBetween('1970-01-01', todayIso) - back;
  })();
  var inThisWeek = function (iso) {
    var n = daysBetween('1970-01-01', iso);
    return n >= monday && n < monday + 7;
  };

  return {
    total: tickets.length,
    fromForm: tickets.filter(function (t) {
      return t.source === 'form';
    }).length,
    fromBackfill: tickets.filter(function (t) {
      return t.source === 'backfill';
    }).length,
    open: open.length,
    delivered: delivered.length,
    overdue: open.filter(function (t) {
      var d = dueIn(t);
      return d !== null && d < 0;
    }),
    due48h: open.filter(function (t) {
      var d = dueIn(t);
      return d !== null && d >= 0 && d <= 2;
    }),
    dueThisWeek: open.filter(function (t) {
      return t.due && inThisWeek(t.due);
    }),
    createdThisWeek: tickets.filter(function (t) {
      return t.requested && inThisWeek(t.requested);
    }).length,
    deliveredThisWeek: delivered.filter(function (t) {
      return inThisWeek(t.delivered);
    }).length,
    byOwner: byOwner,
    spikes: spikes,
    conflicts: conflicts,
    medianCycleDays: median(cycle),
    onTimePct: withDue.length ? Math.round((100 * onTime) / withDue.length) : null,
  };
}

/** Delivered 14+ days ago and still in the Delivered column → move to Archived. */
function shouldArchive(ticket, todayIso, days) {
  return ticket.status === 'Delivered' && !!ticket.delivered && daysBetween(ticket.delivered, todayIso) >= (days || 14);
}

if (typeof module !== 'undefined') {
  module.exports = {
    clean: clean,
    toList: toList,
    toIsoDate: toIsoDate,
    pad2: pad2,
    daysBetween: daysBetween,
    wordCount: wordCount,
    isPlaceholder: isPlaceholder,
    normalizeRequest: normalizeRequest,
    findRoute: findRoute,
    checkCompleteness: checkCompleteness,
    assessTiming: assessTiming,
    priorityFor: priorityFor,
    buildTaskName: buildTaskName,
    buildTaskNotes: buildTaskNotes,
    slugPart: slugPart,
    requestFolderName: requestFolderName,
    shouldRetry: shouldRetry,
    backoffMs: backoffMs,
    normalizeStatus: normalizeStatus,
    validateBackfillRow: validateBackfillRow,
    backfillKey: backfillKey,
    resolveOwnerEmail: resolveOwnerEmail,
    parseTaskNotes: parseTaskNotes,
    setNoteField: setNoteField,
    ticketFromTask: ticketFromTask,
    median: median,
    summarizeTickets: summarizeTickets,
    shouldArchive: shouldArchive,
    idleAction: idleAction,
  };
}
