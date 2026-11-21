/**
 * library_logic.js — pure rules for the Drive asset library (no Google calls),
 * so the safety guard, the naming convention and the folder proposal are unit-tested.
 */

var ASSET_TYPES = [
  'Poster',
  'Post',
  'Story',
  'Reel',
  'Video',
  'Photo',
  'Logo',
  'Banner',
  'Graphic',
  'Slides',
  'Doc',
  'Template',
  'Merch',
  'Other',
];
var CHANNELS_SHORT = ['IG', 'LI', 'Discord', 'Web', 'Print', 'Email', 'Gen'];

// YYYY-MM-DD_Event_AssetType_Channel_vNN(.ext)
var CONVENTION_RE = new RegExp(
  '^(\\d{4}-\\d{2}-\\d{2})_([A-Za-z0-9]+)_(' + ASSET_TYPES.join('|') + ')_(' + CHANNELS_SHORT.join('|') + ')_v(\\d{2,})(\\.[A-Za-z0-9]+)?$',
);

/** Does a name follow the convention? Returns the parsed parts, or null. */
function parseConventionName(name) {
  var m = String(name || '').match(CONVENTION_RE);
  if (!m) return null;
  return { date: m[1], event: m[2], assetType: m[3], channel: m[4], version: Number(m[5]), ext: m[6] ? m[6].slice(1) : '' };
}

/**
 * SAFETY GUARD (spec §0.3). Walk up from a file through its parents.
 * Allowed only if we reach the sandbox root. Refused if we hit the original
 * folder, run out of parents, or loop. `getParents(id)` returns parent IDs.
 */
function checkInSandbox(fileId, sandboxRootId, originalRootId, getParents) {
  if (!sandboxRootId) return { ok: false, reason: 'sandbox root not set' };
  if (fileId === originalRootId) return { ok: false, reason: 'this IS the original folder' };
  if (fileId === sandboxRootId) return { ok: false, reason: 'refusing to move/rename the sandbox root itself' };
  var seen = {};
  var frontier = [fileId];
  for (var depth = 0; depth < 50 && frontier.length; depth++) {
    var next = [];
    for (var i = 0; i < frontier.length; i++) {
      var parents = getParents(frontier[i]) || [];
      for (var j = 0; j < parents.length; j++) {
        var p = parents[j];
        if (p === originalRootId) return { ok: false, reason: 'file is inside the ORIGINAL WiCS folder' };
        if (p === sandboxRootId) return { ok: true, reason: '' };
        if (!seen[p]) {
          seen[p] = true;
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  return { ok: false, reason: 'file is not inside the sandbox' };
}

/** Sept–Aug academic year: 2026-10-03 → "2026-27", 2026-04-01 → "2025-26". */
function academicYear(iso) {
  var y = Number(iso.slice(0, 4));
  var m = Number(iso.slice(5, 7));
  var start = m >= 9 ? y : y - 1;
  return start + '-' + String(start + 1).slice(2);
}

/** Pull a date out of a file name: 2026-11-08, 20261108, IMG_20261108_…, 11-08-2026. */
function dateFromName(name) {
  var s = String(name || '');
  var m = s.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (m && Number(m[2]) <= 12 && Number(m[3]) <= 31) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/(?:^|[^0-9])(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/);
  if (m) return m[3] + '-' + pad2(m[1]) + '-' + pad2(m[2]);
  return '';
}

function hasWord(text, words) {
  var t =
    ' ' +
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ') +
    ' ';
  return words.some(function (w) {
    return t.indexOf(' ' + w + ' ') !== -1;
  });
}

/** Best-guess asset type from the name, path and file type. */
function guessAssetType(name, path, mimeType) {
  var text = name + ' ' + path;
  var mime = String(mimeType || '');
  if (hasWord(text, ['logo', 'logos', 'wordmark'])) return 'Logo';
  if (hasWord(text, ['template', 'templates'])) return 'Template';
  if (hasWord(text, ['merch', 'shirt', 'tshirt', 'hoodie', 'sticker', 'stickers', 'tote'])) return 'Merch';
  if (hasWord(text, ['reel', 'reels', 'tiktok'])) return 'Reel';
  if (mime.indexOf('video/') === 0) return 'Video';
  if (hasWord(text, ['story', 'stories'])) return 'Story';
  if (hasWord(text, ['poster', 'posters', 'flyer', 'flyers'])) return 'Poster';
  if (hasWord(text, ['banner', 'banners', 'header', 'cover'])) return 'Banner';
  if (mime === 'application/vnd.google-apps.presentation' || /\.(pptx?|key)$/i.test(name)) return 'Slides';
  if (mime === 'application/vnd.google-apps.document' || /\.(docx?|txt|md)$/i.test(name)) return 'Doc';
  if (/^(img|dsc|dscf|pxl|photo)[_ -]?\d/i.test(name) || hasWord(text, ['photos', 'photo', 'pics', 'headshots'])) return 'Photo';
  if (hasWord(text, ['post', 'posts', 'carousel', 'ig', 'instagram'])) return 'Post';
  if (mime.indexOf('image/') === 0 || /\.(psd|ai|svg|fig|png|jpe?g|pdf)$/i.test(name)) return 'Graphic';
  return 'Other';
}

function guessChannel(name, path, assetType) {
  var text = name + ' ' + path;
  if (hasWord(text, ['linkedin', 'li'])) return 'LI';
  if (hasWord(text, ['discord'])) return 'Discord';
  if (hasWord(text, ['web', 'website', 'site'])) return 'Web';
  if (hasWord(text, ['newsletter', 'email'])) return 'Email';
  if (hasWord(text, ['print', 'printed']) || assetType === 'Poster') return 'Print';
  if (hasWord(text, ['instagram', 'ig', 'insta']) || ['Story', 'Reel', 'Post'].indexOf(assetType) !== -1) return 'IG';
  return 'Gen';
}

/** Match path/name against the Events (or Sponsors) tab: [{keyword, name}]. Longest keyword wins. */
function matchKeyword(text, rows) {
  var t =
    ' ' +
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ') +
    ' ';
  var best = null;
  (rows || []).forEach(function (r) {
    var k = clean(r.keyword)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (k && t.indexOf(' ' + k + ' ') !== -1 && (!best || k.length > best.k.length)) best = { k: k, name: r.name, kind: r.kind };
  });
  return best;
}

function existingVersion(name) {
  var m = String(name).match(/[_ -]v(\d{1,3})(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 1;
}

function extOf(name, mimeType) {
  if (String(mimeType || '').indexOf('application/vnd.google-apps.') === 0) return '';
  var m = String(name).match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Propose where a file should live and what it should be called.
 * file = {name, path, mimeType, originalCreated}; events/sponsors rows from the tabs.
 * Returns {folder, name, event, assetType, channel, date, dateSource, note}.
 * The human reviews every row in the Plan tab before anything moves.
 */
function proposeLocation(file, events, sponsors) {
  var text = file.path + ' ' + file.name;
  var already = parseConventionName(file.name);
  var date = (already && already.date) || dateFromName(file.name) || dateFromName(file.path);
  var dateSource = date ? 'name' : 'created';
  if (!date) date = toIsoDate(file.originalCreated) || '0000-00-00';
  var assetType = already ? already.assetType : guessAssetType(file.name, file.path, file.mimeType);
  var channel = already ? already.channel : guessChannel(file.name, file.path, assetType);
  var ev = matchKeyword(text, events);
  var sp = matchKeyword(text, sponsors);
  var eventSlug = ev ? slugPart(ev.name) : sp ? slugPart(sp.name) : 'General';
  var version = already ? already.version : existingVersion(file.name);
  var ext = extOf(file.name, file.mimeType);
  var isWip = hasWord(text, ['draft', 'drafts', 'wip', 'unused', 'rough', 'ideas']);
  var isBrief = assetType === 'Doc' && hasWord(text, ['brief', 'briefs', 'plan', 'copy', 'notes', 'outline']);

  var folder;
  if (
    ['Logo', 'Template'].indexOf(assetType) !== -1 ||
    hasWord(text, ['brand', 'branding', 'fonts', 'font', 'palette', 'colours', 'colors'])
  ) {
    folder = '00_Brand';
  } else if (sp && (!ev || hasWord(text, ['sponsor', 'sponsors', 'partner', 'partners']))) {
    folder =
      '03_Sponsors/' + slugPart(sp.name) + '/' + (hasWord(text, ['approval', 'approvals', 'feedback', 'signoff']) ? 'Approvals' : 'Assets');
  } else if (ev && ev.kind === 'program') {
    folder = '02_Programs/' + slugPart(ev.name) + '/' + (isWip ? 'WIP' : 'Final');
  } else if (ev && date !== '0000-00-00') {
    var sub = isBrief ? 'Briefs' : isWip ? 'WIP' : assetType === 'Photo' || hasWord(text, ['recap', 'recaps']) ? 'Recap' : 'Final';
    folder = '01_Events/' + academicYear(date) + '/' + slugPart(ev.name) + '/' + sub;
  } else if (['Post', 'Story', 'Reel'].indexOf(assetType) !== -1 && date !== '0000-00-00') {
    folder = '04_Social/' + date.slice(0, 7);
  } else {
    folder = '99_Archive';
  }

  var base = [date, eventSlug, assetType, channel, 'v' + pad2(Math.min(version, 99))].join('_');
  return {
    folder: folder,
    name: ext ? base + '.' + ext : base,
    event: ev ? ev.name : sp ? sp.name : 'General',
    assetType: assetType,
    channel: channel,
    date: date,
    dateSource: dateSource,
    note: date === '0000-00-00' ? 'no date found — please fill in' : folder === '99_Archive' ? 'could not classify — check' : '',
  };
}

/** Two files can't get the same name in one folder: bump v01 → v02 … instead of overwriting. */
function dedupeNames(proposals) {
  var used = {};
  return proposals.map(function (p) {
    var key = p.folder + '/' + p.name;
    var name = p.name;
    while (used[p.folder + '/' + name]) {
      name = name.replace(/_v(\d{2,})(\.[A-Za-z0-9]+)?$/, function (_, v, ext) {
        return '_v' + pad2(Number(v) + 1) + (ext || '');
      });
      if (name === p.name) break; // unexpected shape — leave it
    }
    used[p.folder + '/' + name] = true;
    used[key] = true;
    return Object.assign({}, p, { name: name });
  });
}

if (typeof module !== 'undefined') {
  // In Node (Jest), make logic.js helpers global, as they are in Apps Script. No `var` here on purpose:
  // redeclaring them would be confusing in Apps Script's shared global scope.
  Object.assign(global, require('./logic'));
  module.exports = {
    parseConventionName: parseConventionName,
    checkInSandbox: checkInSandbox,
    academicYear: academicYear,
    dateFromName: dateFromName,
    guessAssetType: guessAssetType,
    guessChannel: guessChannel,
    matchKeyword: matchKeyword,
    proposeLocation: proposeLocation,
    dedupeNames: dedupeNames,
  };
}
