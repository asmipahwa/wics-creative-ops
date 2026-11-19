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
  return String(value)
    .split(',')
    .map(clean)
    .filter(Boolean);
}

/** Accept 'YYYY-MM-DD', 'M/D/YYYY' or a Date; return 'YYYY-MM-DD' or ''. */
function toIsoDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return (
      value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate())
    );
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
    missing.push(
      'A fuller description of what you need (at least ' + min + ' words: what it is, who it is for, key details)'
    );
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
    'Requestor: ' + req.requestorName + ' <' + req.requestorEmail + '>',
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
    'Delivered date: ',
    'Asset link: ',
    'Working folder: ' + (ctx.folderUrl || '—'),
    '',
    '— What\'s needed —',
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
  var shortId = clean(responseId).replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'NOID';
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

if (typeof module !== 'undefined') {
  module.exports = {
    clean: clean,
    toList: toList,
    toIsoDate: toIsoDate,
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
  };
}
