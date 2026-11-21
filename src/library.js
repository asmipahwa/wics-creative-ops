/**
 * library.js — the Drive asset library (Sprint 3).
 *
 * SAFETY, in layers:
 *  1. Google-enforced: this project can READ your Drive (drive.readonly) but can only
 *     CHANGE files it created itself (drive.file). The original WiCS folder was not
 *     created by this script, so Google refuses any change to it — even if this code had a bug.
 *  2. Code guard: every move/rename first proves the file sits inside the sandbox
 *     (checkInSandbox in library_logic.js, unit-tested) and refuses otherwise.
 *  3. Never delete. Restructuring = move + rename only.
 *  4. Dry run first (Plan tab) → you approve (approvePlan) → apply → every change in UndoLog
 *     → undoRestructure() reverses it.
 *
 * Steps (run in order; see docs/LIBRARY.md):
 *   surveyOriginal → copyToSandbox → inventorySandbox → proposeRestructure → (review) →
 *   approvePlan → applyRestructure → rebuildIndex → setupSearchTab
 */

var FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
var LIB_TIME_BUDGET_MS = 5 * 60 * 1000;
var SKIP_MIME = [
  'application/vnd.google-apps.shortcut',
  'application/vnd.google-apps.site',
  'application/vnd.google-apps.map',
  'application/vnd.google-apps.fusiontable',
];
var DRIVE_OPTS = { supportsAllDrives: true, includeItemsFromAllDrives: true };

var COPYLOG_HEADERS = [
  'Original ID',
  'Copy ID',
  'Kind',
  'Original path',
  'Name',
  'MIME type',
  'Size (bytes)',
  'Original created',
  'Original modified',
  'Status',
  'Note',
];
var INDEX_HEADERS = [
  'File ID',
  'Name',
  'Folder',
  'Event',
  'Asset type',
  'Channel',
  'Date',
  'Version',
  'Tags',
  'Kind',
  'Size (KB)',
  'Original created',
  'Original modified',
  'Link',
  'Follows convention?',
];
var PLAN_HEADERS = [
  'File ID',
  'Current folder',
  'Current name',
  'New folder',
  'New name',
  'Event',
  'Asset type',
  'Channel',
  'Date',
  'Date from',
  'Note',
  'Apply?',
  'Status',
];
var UNDO_HEADERS = ['Time', 'File ID', 'Action', 'Old name', 'Old parent IDs', 'New name', 'New parent ID', 'Undone at'];

// ───────────────────────── setup ─────────────────────────

/** Events / Sponsors keyword tabs (you edit them), plus the log tabs. */
function setupLibraryTabs() {
  var ss = reportSpreadsheet_();
  var ev = getOrCreateTab_(ss, 'Events', [
    'Keyword (lowercase, as it appears in folder/file names)',
    'Event / program name',
    'Kind (event or program)',
  ]);
  ev.getRange('E1').setValue(
    'One row per event/program. proposeRestructure suggests rows from your folder names — edit them, then re-run it.',
  );
  ev.getRange(2, 3, 300, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['event', 'program']).build());
  var sp = getOrCreateTab_(ss, 'Sponsors', ['Keyword (lowercase)', 'Sponsor / partner name']);
  sp.getRange('D1').setValue('Only sponsors/partners WiCS really works with.');
  ['CopyLog', 'Index', 'Plan', 'UndoLog'].forEach(function (n, i) {
    getOrCreateTab_(ss, n, [COPYLOG_HEADERS, INDEX_HEADERS, PLAN_HEADERS, UNDO_HEADERS][i]);
  });
  Logger.log('Library tabs ready. Next: put the WiCS folder link in Script Property SOURCE_FOLDER_ID, then run surveyOriginal.');
}

/** SOURCE_FOLDER_ID may be a bare ID or a full Drive folder link. */
function sourceFolderId_() {
  var raw = getProp_('SOURCE_FOLDER_ID', true).trim();
  var m = raw.match(/folders\/([A-Za-z0-9_-]+)/) || raw.match(/id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : raw;
}

// ───────────────────────── Drive helpers ─────────────────────────

function listChildren_(folderId) {
  var out = [];
  var token = null;
  do {
    var res = Drive.Files.list(
      Object.assign(
        {
          q: "'" + folderId + "' in parents and trashed = false",
          fields: 'nextPageToken, files(id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink)',
          pageSize: 1000,
          pageToken: token,
        },
        DRIVE_OPTS,
      ),
    );
    out = out.concat(res.files || []);
    token = res.nextPageToken;
  } while (token);
  return out;
}

var parentsCache_ = {};
function getParents_(id) {
  if (!parentsCache_[id]) parentsCache_[id] = Drive.Files.get(id, { fields: 'parents', supportsAllDrives: true }).parents || [];
  return parentsCache_[id];
}

/** THE GUARD. Throws unless the file is inside the sandbox (and not in the original). */
function assertInSandbox_(fileId) {
  var r = checkInSandbox(fileId, getProp_('SANDBOX_ROOT_ID'), getProp_('ORIGINAL_ROOT_ID'), getParents_);
  if (!r.ok) throw new Error('SAFETY GUARD refused to touch ' + fileId + ': ' + r.reason);
}

/** Move + rename one file, after the guard, and record how to undo it. */
function moveAndRename_(fileId, newName, newParentId, action) {
  assertInSandbox_(fileId);
  var meta = Drive.Files.get(fileId, { fields: 'name,parents', supportsAllDrives: true });
  var oldParents = (meta.parents || []).join(',');
  var opts = { fields: 'id', supportsAllDrives: true };
  if (newParentId && oldParents !== newParentId) {
    opts.addParents = newParentId;
    opts.removeParents = oldParents;
  }
  Drive.Files.update(newName && newName !== meta.name ? { name: newName } : {}, fileId, null, opts);
  delete parentsCache_[fileId];
  getOrCreateTab_(reportSpreadsheet_(), 'UndoLog', UNDO_HEADERS).appendRow([
    new Date(),
    fileId,
    action,
    meta.name,
    oldParents,
    newName || meta.name,
    newParentId || oldParents,
    '',
  ]);
}

/** "01_Events/2026-27/TryCATCH/Final" → folder ID inside the sandbox, creating folders as needed. */
var pathCache_ = {};
function ensurePath_(path) {
  var rootId = getProp_('SANDBOX_ROOT_ID', true);
  if (!path) return rootId;
  if (pathCache_[path]) return pathCache_[path];
  var parentId = rootId;
  var sofar = '';
  path.split('/').forEach(function (part) {
    sofar = sofar ? sofar + '/' + part : part;
    if (pathCache_[sofar]) {
      parentId = pathCache_[sofar];
      return;
    }
    parentId = getOrCreateSubfolder_(parentId, part).id;
    pathCache_[sofar] = parentId;
  });
  return parentId;
}

/** Schedule `fn` to run again in ~1 minute (for jobs longer than Apps Script's 6-minute limit). */
function scheduleContinuation_(fn) {
  clearContinuation_(fn);
  ScriptApp.newTrigger(fn)
    .timeBased()
    .after(60 * 1000)
    .create();
}
function clearContinuation_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
}

function readTab_(name, headers) {
  var sh = getOrCreateTab_(reportSpreadsheet_(), name, headers);
  if (sh.getLastRow() < 2) return { sh: sh, rows: [] };
  return { sh: sh, rows: sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues() };
}

// ───────────────────────── 0. survey + sandbox copy ─────────────────────────

/** READ-ONLY look at the original: how many files, how big, which types. Changes nothing. */
function surveyOriginal() {
  var rootId = sourceFolderId_();
  var root = Drive.Files.get(rootId, { fields: 'id,name,mimeType', supportsAllDrives: true });
  if (root.mimeType !== FOLDER_MIME_TYPE) throw new Error('SOURCE_FOLDER_ID is not a folder.');
  var files = 0,
    folders = 0,
    bytes = 0,
    nonCopyable = 0;
  var types = {};
  var queue = [rootId];
  while (queue.length) {
    listChildren_(queue.shift()).forEach(function (f) {
      if (f.mimeType === FOLDER_MIME_TYPE) {
        folders++;
        queue.push(f.id);
      } else {
        files++;
        bytes += Number(f.size || 0);
        var t = f.mimeType.replace('application/vnd.google-apps.', 'google-');
        types[t] = (types[t] || 0) + 1;
        if (SKIP_MIME.indexOf(f.mimeType) !== -1) nonCopyable++;
      }
    });
  }
  var msg =
    '"' +
    root.name +
    '": ' +
    files +
    ' files in ' +
    folders +
    ' folders, ' +
    (bytes / 1073741824).toFixed(2) +
    ' GB' +
    ' (Google Docs/Sheets/Slides count as 0 GB). Shortcuts/other non-copyable: ' +
    nonCopyable +
    '.';
  Logger.log(msg);
  Logger.log('By type: ' + JSON.stringify(types));
  logRun_('surveyOriginal', 'ok', '', msg);
}

var SURVEY_HEADERS = [
  'Level',
  'Subfolder',
  'Link',
  'Parent link',
  'Files',
  'Creative files',
  'Video files',
  'GB',
  'Video GB',
  'Newest file',
  'Copy?',
];
var SURVEY_BIG_GB = 1; // folders bigger than this also get a row per subfolder

/**
 * READ-ONLY breakdown of the source folder → `Survey` tab. One row per subfolder
 * (level 1), plus one row per sub-subfolder (level 2) for any folder over 1 GB.
 * Changes nothing in Drive. The Copy? column (and the settings in M1:N2) decide what
 * copyToSandbox copies, so the sandbox fits in your storage. Your Copy? choices are kept on re-run.
 */
function surveyByFolder() {
  var started = Date.now();
  var rootId = sourceFolderId_();
  var sh = surveyTab_();
  var previous = {};
  readSurveyRows_().forEach(function (r) {
    previous[r.link] = r.copy;
  });
  var link = function (id) {
    return 'https://drive.google.com/drive/folders/' + id;
  };
  var blank = function () {
    return { files: 0, creative: 0, videoFiles: 0, bytes: 0, videoBytes: 0, newest: '' };
  };
  var count = function (t, f) {
    t.files++;
    t.bytes += Number(f.size || 0);
    if (isCreativeFile(f.mimeType, f.name)) t.creative++;
    if (isVideo(f.mimeType, f.name)) {
      t.videoFiles++;
      t.videoBytes += Number(f.size || 0);
    }
    if (f.modifiedTime > t.newest) t.newest = f.modifiedTime;
  };
  var row = function (level, name, id, parentId, t) {
    var l = id ? link(id) : '';
    return [
      level,
      name,
      l,
      parentId ? link(parentId) : '',
      t.files,
      t.creative,
      t.videoFiles,
      Math.round((t.bytes / 1073741824) * 100) / 100,
      Math.round((t.videoBytes / 1073741824) * 100) / 100,
      t.newest ? t.newest.slice(0, 10) : '',
      previous[l] || 'Yes',
    ];
  };

  var rows = [];
  var top = listChildren_(rootId);
  var loose = blank();
  top
    .filter(function (f) {
      return f.mimeType !== FOLDER_MIME_TYPE;
    })
    .forEach(function (f) {
      count(loose, f);
    });
  if (loose.files) rows.push(row(1, '(files directly in the source folder — always copied)', '', '', loose));

  var subs = top.filter(function (f) {
    return f.mimeType === FOLDER_MIME_TYPE;
  });
  for (var i = 0; i < subs.length; i++) {
    if (Date.now() - started > LIB_TIME_BUDGET_MS) {
      rows.push(['', '(stopped: time limit — ' + (subs.length - i) + ' folders not counted)', '', '', '', '', '', '', '', '', '']);
      break;
    }
    var l1 = subs[i];
    var total = blank();
    var perChild = {};
    var direct = blank();
    var children = listChildren_(l1.id);
    var queue = [];
    children.forEach(function (c) {
      if (c.mimeType === FOLDER_MIME_TYPE) {
        perChild[c.id] = { name: c.name, t: blank() };
        queue.push({ id: c.id, l2: c.id });
      } else {
        count(total, c);
        count(direct, c);
      }
    });
    while (queue.length) {
      var q = queue.shift();
      listChildren_(q.id).forEach(function (f) {
        if (f.mimeType === FOLDER_MIME_TYPE) queue.push({ id: f.id, l2: q.l2 });
        else {
          count(total, f);
          count(perChild[q.l2].t, f);
        }
      });
    }
    rows.push(row(1, l1.name, l1.id, '', total));
    if (total.bytes > SURVEY_BIG_GB * 1073741824) {
      if (direct.files) rows.push(row(2, '    ' + l1.name + ' / (loose files — copied with the folder)', '', l1.id, direct));
      Object.keys(perChild).forEach(function (id) {
        rows.push(row(2, '    ' + l1.name + ' / ' + perChild[id].name, id, l1.id, perChild[id].t));
      });
    }
  }

  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, SURVEY_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, SURVEY_HEADERS.length).setValues(rows);
    sh.getRange(2, 11, rows.length, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No']).build());
  }
  var msg = subs.length + ' subfolders surveyed (read-only). Set Copy? = No for anything to leave out, then run estimateCopy.';
  logRun_('surveyByFolder', 'ok', '', msg);
  Logger.log(msg);
  estimateCopy_();
}

/** The Survey tab, with its two copy settings in M1:N2. */
function surveyTab_() {
  var sh = getOrCreateTab_(reportSpreadsheet_(), 'Survey', SURVEY_HEADERS);
  if (sh.getRange(1, 1).getValue() !== 'Level') {
    sh.clear();
    sh.getRange(1, 1, 1, SURVEY_HEADERS.length).setValues([SURVEY_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!sh.getRange('M1').getValue()) {
    sh.getRange('M1:N2').setValues([
      ['Skip videos when copying? ✏️', 'No'],
      ['Skip files larger than (MB, blank = no limit) ✏️', ''],
    ]);
    sh.getRange('N1:N2').setBackground('#fff2cc');
    sh.getRange('N1').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No']).build());
    sh.getRange('M4:M7').setValues([
      ['Estimated copy size (GB)'],
      ['Estimated files'],
      ['Estimated creative files'],
      ['(run estimateCopy after changing Copy? or the settings)'],
    ]);
  }
  return sh;
}

function readSurveyRows_() {
  var sh = reportSpreadsheet_().getSheetByName('Survey');
  if (!sh || sh.getLastRow() < 2 || sh.getRange(1, 1).getValue() !== 'Level') return [];
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, SURVEY_HEADERS.length)
    .getValues()
    .filter(function (r) {
      return r[0] !== '';
    })
    .map(function (r) {
      return {
        level: r[0],
        name: r[1],
        link: r[2],
        parentLink: r[3],
        files: r[4],
        creative: r[5],
        videoFiles: r[6],
        gb: r[7],
        videoGb: r[8],
        copy: r[10],
      };
    });
}

function copySettings_() {
  var sh = reportSpreadsheet_().getSheetByName('Survey');
  if (!sh) return { skipVideos: false, maxFileMb: 0 };
  return { skipVideos: /^y/i.test(String(sh.getRange('N1').getValue())), maxFileMb: Number(sh.getRange('N2').getValue()) || 0 };
}

/** Folder IDs marked Copy? = No in the Survey tab. */
function excludedFolderIds_() {
  var ids = {};
  readSurveyRows_().forEach(function (r) {
    if (/^n/i.test(String(r.copy)) && r.link) ids[folderIdFromLink(r.link)] = true;
  });
  return ids;
}

/** Recalculate the estimate in the Survey tab (no Drive calls at all). */
function estimateCopy() {
  estimateCopy_();
}
function estimateCopy_() {
  var est = estimateCopy(readSurveyRows_(), copySettings_());
  var sh = surveyTab_();
  sh.getRange('N4:N6').setValues([[est.gb], [est.files], [est.creative]]);
  Logger.log('Estimated copy: ' + est.gb + ' GB, ' + est.files + ' files, ' + est.creative + ' creative.');
}

/**
 * Copy the original folder tree into "WiCS Marketing (Sandbox)" in My Drive.
 * Only READS the original. Resumable: CopyLog remembers what's done; if time runs
 * out it schedules itself to continue in a minute.
 */
function copyToSandbox() {
  var started = Date.now();
  var srcId = sourceFolderId_();
  var log = readTab_('CopyLog', COPYLOG_HEADERS);
  var sh = log.sh;

  var sandboxId = getProp_('SANDBOX_ROOT_ID');
  if (!sandboxId) {
    var src = Drive.Files.get(srcId, { fields: 'name', supportsAllDrives: true });
    sandboxId = createFolder_('WiCS Marketing (Sandbox)').id;
    setProp_('SANDBOX_ROOT_ID', sandboxId);
    setProp_('ORIGINAL_ROOT_ID', srcId);
    sh.appendRow([srcId, sandboxId, 'folder', src.name, src.name, FOLDER_MIME_TYPE, '', '', '', 'pending', 'root']);
    log = readTab_('CopyLog', COPYLOG_HEADERS);
  } else if (getProp_('ORIGINAL_ROOT_ID') !== srcId) {
    throw new Error('A sandbox already exists for a different source folder. Not mixing them.');
  }

  var state = {};
  var pending = [];
  log.rows.forEach(function (r, i) {
    state[r[0]] = true;
    if (r[2] === 'folder' && r[9] === 'pending') pending.push({ row: i + 2, origId: r[0], copyId: r[1], path: r[3] });
  });

  var excluded = excludedFolderIds_();
  var settings = copySettings_();
  var copied = 0;
  while (pending.length) {
    var folder = pending[0];
    var children = listChildren_(folder.origId);
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (state[c.id]) continue;
      if (Date.now() - started > LIB_TIME_BUDGET_MS) {
        scheduleContinuation_('continueSandboxCopy');
        logRun_('copyToSandbox', 'paused (time limit) — continues automatically', '', copied + ' copied this run');
        return;
      }
      var path = folder.path + '/' + c.name;
      var base = [c.id, '', '', path, c.name, c.mimeType, c.size || '', c.createdTime, c.modifiedTime];
      try {
        var skipWhy = c.mimeType === FOLDER_MIME_TYPE ? (excluded[c.id] ? 'Copy? = No in Survey tab' : '') : copySkipReason(c, settings);
        if (skipWhy) {
          base[2] = c.mimeType === FOLDER_MIME_TYPE ? 'folder' : 'file';
          sh.appendRow(base.concat(['skipped', skipWhy]));
        } else if (c.mimeType === FOLDER_MIME_TYPE) {
          var nf = createFolder_(c.name, folder.copyId);
          base[1] = nf.id;
          base[2] = 'folder';
          sh.appendRow(base.concat(['pending', '']));
          pending.push({ row: sh.getLastRow(), origId: c.id, copyId: nf.id, path: path });
        } else if (SKIP_MIME.indexOf(c.mimeType) !== -1) {
          base[2] = 'file';
          sh.appendRow(base.concat(['skipped', 'type cannot be copied']));
        } else {
          var cp = Drive.Files.copy({ name: c.name, parents: [folder.copyId] }, c.id, { supportsAllDrives: true, fields: 'id' });
          base[1] = cp.id;
          base[2] = 'file';
          sh.appendRow(base.concat(['copied', '']));
          copied++;
        }
      } catch (e) {
        base[2] = c.mimeType === FOLDER_MIME_TYPE ? 'folder' : 'file';
        sh.appendRow(base.concat(['error', String(e.message || e).slice(0, 300)]));
      }
      state[c.id] = true;
    }
    sh.getRange(folder.row, 10).setValue('done');
    pending.shift();
  }

  clearContinuation_('continueSandboxCopy');
  var final = readTab_('CopyLog', COPYLOG_HEADERS).rows;
  var n = function (status) {
    return final.filter(function (r) {
      return r[2] === 'file' && r[9] === status;
    }).length;
  };
  var msg =
    'Sandbox copy COMPLETE: ' +
    n('copied') +
    ' files copied, ' +
    n('skipped') +
    ' skipped, ' +
    n('error') +
    ' errors. Sandbox: https://drive.google.com/drive/folders/' +
    sandboxId;
  logRun_('copyToSandbox', 'done', '', msg);
  Logger.log(msg);
}

function continueSandboxCopy() {
  copyToSandbox();
}

// ───────────────────────── 1. inventory ─────────────────────────

/** List every file in the sandbox → Index tab. Also records % following the naming convention. */
function inventorySandbox() {
  var rootId = getProp_('SANDBOX_ROOT_ID', true);
  var origDates = {};
  readTab_('CopyLog', COPYLOG_HEADERS).rows.forEach(function (r) {
    if (r[1]) origDates[r[1]] = [r[7], r[8]];
  });
  var rows = [];
  var queue = [{ id: rootId, path: '' }];
  while (queue.length) {
    var f = queue.shift();
    listChildren_(f.id).forEach(function (c) {
      var path = f.path ? f.path + '/' + c.name : c.name;
      if (c.mimeType === FOLDER_MIME_TYPE) {
        queue.push({ id: c.id, path: path });
        return;
      }
      var parsed = parseConventionName(c.name);
      var od = origDates[c.id] || [c.createdTime, c.modifiedTime];
      var tags = parsed
        ? [parsed.event, parsed.assetType, parsed.channel, academicYear(parsed.date), f.path.split('/')[0]]
        : [f.path.split('/')[0]];
      rows.push([
        c.id,
        c.name,
        f.path,
        parsed ? parsed.event : '',
        parsed ? parsed.assetType : '',
        parsed ? parsed.channel : '',
        parsed ? parsed.date : '',
        parsed ? 'v' + pad2(parsed.version) : '',
        tags.filter(Boolean).join(', ').toLowerCase(),
        c.mimeType.replace('application/vnd.google-apps.', 'google-').replace(/^(image|video|application|audio|text)\//, ''),
        c.size ? Math.round(Number(c.size) / 1024) : '',
        od[0] ? new Date(od[0]) : '',
        od[1] ? new Date(od[1]) : '',
        c.webViewLink,
        parsed ? 'Yes' : 'No',
      ]);
    });
  }
  var sh = getOrCreateTab_(reportSpreadsheet_(), 'Index', INDEX_HEADERS);
  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, INDEX_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, INDEX_HEADERS.length).setValues(rows);
    sh.getRange(2, 12, rows.length, 2).setNumberFormat('yyyy-mm-dd');
  }
  var matching = rows.filter(function (r) {
    return r[14] === 'Yes';
  }).length;
  var pct = rows.length ? Math.round((100 * matching) / rows.length) : 0;
  if (!getProp_('LIB_PCT_BEFORE')) setProp_('LIB_PCT_BEFORE', pct + '% (' + matching + '/' + rows.length + ', ' + todayIso_() + ')');
  setProp_('LIB_PCT_LATEST', pct + '% (' + matching + '/' + rows.length + ', ' + todayIso_() + ')');
  var msg = rows.length + ' files in library; ' + pct + '% follow the naming convention.';
  logRun_('inventorySandbox', 'ok', '', msg);
  Logger.log(msg);
  return rows.length;
}

// ───────────────────────── 2–3. proposal + dry run ─────────────────────────

var GENERIC_FOLDER_WORDS =
  /^(photos?|pics|images?|final|finals|drafts?|wip|old|misc|assets?|graphics?|posters?|stories|story|posts?|reels?|videos?|templates?|logos?|branding|brand|marketing|social|instagram|ig|linkedin|copy|docs?|\d{4}(-\d{2,4})?|fall|spring|summer|winter|archive|backup|new folder|untitled.*)$/i;

/** Read Events/Sponsors tabs. If Events is empty, suggest rows from real folder names. */
function readKeywordTabs_() {
  var ss = reportSpreadsheet_();
  var evSh = ss.getSheetByName('Events');
  var spSh = ss.getSheetByName('Sponsors');
  var read = function (sh, n) {
    return sh && sh.getLastRow() > 1
      ? sh
          .getRange(2, 1, sh.getLastRow() - 1, n)
          .getValues()
          .filter(function (r) {
            return r[0] && r[1];
          })
      : [];
  };
  var events = read(evSh, 3).map(function (r) {
    return { keyword: r[0], name: r[1], kind: String(r[2] || 'event').toLowerCase() };
  });
  var sponsors = read(spSh, 2).map(function (r) {
    return { keyword: r[0], name: r[1], kind: 'sponsor' };
  });
  return { events: events, sponsors: sponsors, evSh: evSh };
}

function suggestEventsFromFolders_(evSh) {
  var names = {};
  readTab_('CopyLog', COPYLOG_HEADERS).rows.forEach(function (r) {
    if (r[2] !== 'folder' || r[10] === 'root') return;
    var depth = String(r[3]).split('/').length - 1;
    var name = String(r[4])
      .replace(/\b(20\d{2})(-\d{2,4})?\b/g, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    if (depth <= 3 && name && !GENERIC_FOLDER_WORDS.test(name)) names[name.toLowerCase()] = name;
  });
  var rows = Object.keys(names)
    .sort()
    .map(function (k) {
      return [k, names[k], 'event'];
    });
  if (rows.length) evSh.getRange(2, 1, rows.length, 3).setValues(rows);
  return rows.length;
}

/** Fill the Plan tab: proposed folder + name for every file. Moves NOTHING. */
function proposeRestructure() {
  var kw = readKeywordTabs_();
  if (!kw.events.length && kw.evSh) {
    var n = suggestEventsFromFolders_(kw.evSh);
    Logger.log(
      'Events tab was empty — suggested ' +
        n +
        ' rows from your folder names. Edit them (fix names, delete non-events, mark programs), then run proposeRestructure again.',
    );
    if (n) return;
  }
  var index = readTab_('Index', INDEX_HEADERS).rows;
  if (!index.length) throw new Error('Index is empty — run inventorySandbox first.');
  var copyDates = {};
  readTab_('CopyLog', COPYLOG_HEADERS).rows.forEach(function (r) {
    if (r[1]) copyDates[r[1]] = r[7];
  });

  var proposals = dedupeNames(
    index.map(function (r) {
      var p = proposeLocation(
        { name: r[1], path: r[2], mimeType: mimeFromKind_(r[9]), originalCreated: copyDates[r[0]] || r[11] },
        kw.events,
        kw.sponsors,
      );
      p.id = r[0];
      p.curFolder = r[2];
      p.curName = r[1];
      return p;
    }),
  );
  var rows = proposals.map(function (p) {
    var unchanged = p.folder === p.curFolder && p.name === p.curName;
    return [
      p.id,
      p.curFolder,
      p.curName,
      p.folder,
      p.name,
      p.event,
      p.assetType,
      p.channel,
      p.date,
      p.dateSource,
      p.note || (unchanged ? 'already in place' : ''),
      unchanged ? 'No' : 'Yes',
      '',
    ];
  });
  var sh = getOrCreateTab_(reportSpreadsheet_(), 'Plan', PLAN_HEADERS);
  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, PLAN_HEADERS.length).clearContent();
  sh.getRange(2, 1, rows.length, PLAN_HEADERS.length).setValues(rows);
  sh.getRange(2, 12, rows.length, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No']).build());
  sh.getRange(1, 4, 1, 2).setBackground('#fff2cc');
  setProp_('PLAN_APPROVED', 'no');
  var toCheck = rows.filter(function (r) {
    return r[10] && r[10] !== 'already in place';
  }).length;
  var msg =
    rows.length +
    ' files planned; ' +
    toCheck +
    ' flagged for your review (see Note column). Nothing has moved. ' +
    'Edit New folder / New name / Apply? as needed, then run approvePlan.';
  logRun_('proposeRestructure', 'ok', '', msg);
  Logger.log(msg);
}

function mimeFromKind_(kind) {
  var k = String(kind);
  if (k.indexOf('google-') === 0) return 'application/vnd.google-apps.' + k.slice(7);
  if (/^(png|jpe?g|gif|webp|heic|svg\+xml|tiff)$/.test(k)) return 'image/' + k;
  if (/^(mp4|quicktime|webm|x-msvideo)$/.test(k)) return 'video/' + k;
  return k;
}

/** Your explicit OK after reviewing the Plan tab. Nothing moves without it. */
function approvePlan() {
  var plan = readTab_('Plan', PLAN_HEADERS).rows;
  var n = plan.filter(function (r) {
    return r[11] === 'Yes' && !r[12];
  }).length;
  setProp_('PLAN_APPROVED', 'yes ' + new Date().toISOString());
  Logger.log('Plan approved: ' + n + ' files will be moved/renamed when you run applyRestructure.');
}

// ───────────────────────── 4. apply + undo ─────────────────────────

function applyRestructure() {
  if (!/^yes/.test(getProp_('PLAN_APPROVED') || '')) throw new Error('Plan not approved. Review the Plan tab, then run approvePlan.');
  var started = Date.now();
  var plan = readTab_('Plan', PLAN_HEADERS);
  var done = 0,
    errors = 0;
  for (var i = 0; i < plan.rows.length; i++) {
    var r = plan.rows[i];
    if (r[11] !== 'Yes' || r[12]) continue;
    if (Date.now() - started > LIB_TIME_BUDGET_MS) {
      scheduleContinuation_('continueApplyRestructure');
      logRun_('applyRestructure', 'paused (time limit) — continues automatically', '', done + ' moved this run');
      return;
    }
    try {
      moveAndRename_(r[0], String(r[4]).trim(), ensurePath_(String(r[3]).trim()), 'move+rename');
      plan.sh.getRange(i + 2, 13).setValue('applied ' + todayIso_());
      done++;
    } catch (e) {
      plan.sh.getRange(i + 2, 13).setValue('ERROR: ' + String(e.message || e).slice(0, 200));
      errors++;
    }
  }
  clearContinuation_('continueApplyRestructure');
  var archived = archiveEmptyOldFolders_();
  logRun_(
    'applyRestructure',
    errors ? 'done with errors' : 'done',
    '',
    done + ' files moved/renamed, ' + errors + ' errors, ' + archived + ' emptied old folders moved to 99_Archive/_Old folders',
  );
  inventorySandbox();
  Logger.log('Restructure complete. Naming convention before: ' + getProp_('LIB_PCT_BEFORE') + ' → after: ' + getProp_('LIB_PCT_LATEST'));
}

function continueApplyRestructure() {
  applyRestructure();
}

/** Old folders left empty by the move go to 99_Archive/_Old folders (moved, never deleted). Deepest first. */
function archiveEmptyOldFolders_() {
  var newTop = /^(00_Brand|01_Events|02_Programs|03_Sponsors|04_Social|99_Archive)$/;
  var folders = readTab_('CopyLog', COPYLOG_HEADERS)
    .rows.filter(function (r) {
      return r[2] === 'folder' && r[1] && r[10] !== 'root';
    })
    .sort(function (a, b) {
      return String(b[3]).split('/').length - String(a[3]).split('/').length;
    });
  var target = null,
    moved = 0;
  folders.forEach(function (r) {
    if (newTop.test(r[4])) return;
    var hasChildren =
      Drive.Files.list({ q: "'" + r[1] + "' in parents and trashed = false", fields: 'files(id)', pageSize: 1 }).files.length > 0;
    if (hasChildren) return;
    target = target || ensurePath_('99_Archive/_Old folders');
    try {
      moveAndRename_(r[1], null, target, 'archive empty old folder');
      moved++;
    } catch (e) {
      logRun_('archiveEmptyOldFolders_', 'error', '', r[1] + ': ' + e.message);
    }
  });
  return moved;
}

/** Reverse every change in UndoLog, newest first. Resumable. */
function undoRestructure() {
  var started = Date.now();
  var log = readTab_('UndoLog', UNDO_HEADERS);
  for (var i = log.rows.length - 1; i >= 0; i--) {
    var r = log.rows[i];
    if (r[7]) continue;
    if (Date.now() - started > LIB_TIME_BUDGET_MS) {
      scheduleContinuation_('undoRestructure');
      return;
    }
    assertInSandbox_(r[1]);
    var opts = { fields: 'id', supportsAllDrives: true };
    if (String(r[4]) !== String(r[6])) {
      opts.addParents = String(r[4]);
      opts.removeParents = String(r[6]);
    }
    Drive.Files.update(String(r[3]) !== String(r[5]) ? { name: String(r[3]) } : {}, r[1], null, opts);
    delete parentsCache_[r[1]];
    log.sh.getRange(i + 2, 8).setValue(new Date());
  }
  clearContinuation_('undoRestructure');
  var plan = readTab_('Plan', PLAN_HEADERS);
  plan.rows.forEach(function (r, i) {
    if (/^applied/.test(r[12])) plan.sh.getRange(i + 2, 13).setValue('undone');
  });
  setProp_('PLAN_APPROVED', 'no');
  logRun_('undoRestructure', 'done', '', 'all changes reversed');
  inventorySandbox();
}

// ───────────────────────── 5. index + search ─────────────────────────

function rebuildIndex() {
  inventorySandbox();
  setupSearchTab();
}

/** Search tab: type in B1 → QUERY over name, event, tags and folder. Plus filter views on Index. */
function setupSearchTab() {
  var ss = reportSpreadsheet_();
  var sh = ss.getSheetByName('Search') || ss.insertSheet('Search', 1);
  sh.clear();
  sh.getRange('A1').setValue('🔎 Search the asset library →').setFontWeight('bold');
  sh.getRange('B1').setBackground('#fff2cc').setNote('Type any word: event (trycatch), type (poster), channel (ig), year (2026-27)…');
  sh.getRange('D1').setFormula('="Library: "&COUNTA(Index!A2:A)&" files · "&COUNTIF(Index!O2:O,"Yes")&" follow the naming convention"');
  var q = 'LOWER(SUBSTITUTE($B$1,"\'",""))';
  var cond = ['B', 'D', 'I', 'C']
    .map(function (c) {
      return 'lower(' + c + ') contains \'"&' + q + '&"\'';
    })
    .join(' or ');
  sh.getRange('A3').setFormula(
    '=IF($B$1="","Type a word in B1 to search.",IFERROR(QUERY(Index!A1:O,"select B, D, E, F, G, C, N where ' +
      cond +
      " order by G desc label B 'File', D 'Event', E 'Type', F 'Channel', G 'Date', C 'Folder', N 'Link'\",1),\"No matches\"))",
  );
  sh.setColumnWidth(1, 360);
  sh.setFrozenRows(2);
  addIndexFilterViews_(ss);
  Logger.log('Search tab ready.');
}

function addIndexFilterViews_(ss) {
  var sh = ss.getSheetByName('Index');
  var sheetId = sh.getSheetId();
  var meta = Sheets.Spreadsheets.get(ss.getId(), { fields: 'sheets(properties.sheetId,filterViews(filterViewId))' });
  var requests = [];
  (meta.sheets || []).forEach(function (s) {
    if (s.properties.sheetId === sheetId)
      (s.filterViews || []).forEach(function (fv) {
        requests.push({ deleteFilterView: { filterId: fv.filterViewId } });
      });
  });
  var range = { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: INDEX_HEADERS.length };
  var f = function (col, formula) {
    return [{ columnIndex: col, filterCriteria: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] } } }];
  };
  [
    [
      'By event (newest first)',
      [],
      [
        { dimensionIndex: 3, sortOrder: 'ASCENDING' },
        { dimensionIndex: 6, sortOrder: 'DESCENDING' },
      ],
    ],
    ['Final assets only', f(2, '=REGEXMATCH($C2,"/Final$")'), [{ dimensionIndex: 6, sortOrder: 'DESCENDING' }]],
    [
      'Images & video',
      f(9, '=REGEXMATCH($J2,"^(png|jpe?g|gif|webp|heic|mp4|quicktime)$")'),
      [{ dimensionIndex: 6, sortOrder: 'DESCENDING' }],
    ],
    ['Not following convention', f(14, '=$O2="No"'), [{ dimensionIndex: 2, sortOrder: 'ASCENDING' }]],
  ].forEach(function (v) {
    var spec = { title: v[0], range: range, sortSpecs: v[2] };
    if (v[1].length) spec.filterSpecs = v[1];
    requests.push({ addFilterView: { filter: spec } });
  });
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
}

// ───────────────────────── 6. naming checker ─────────────────────────

/** Files added to the library in the last `days` days that break the convention (for the weekly digest). */
function checkNamingConvention(days) {
  var rootId = getProp_('SANDBOX_ROOT_ID');
  if (!rootId) return [];
  var since = new Date(Date.now() - (days || 7) * 86400000).toISOString();
  var bad = [];
  var queue = [{ id: rootId, path: '' }];
  while (queue.length) {
    var f = queue.shift();
    listChildren_(f.id).forEach(function (c) {
      var path = f.path ? f.path + '/' + c.name : c.name;
      if (c.mimeType === FOLDER_MIME_TYPE) queue.push({ id: c.id, path: path });
      else if (c.createdTime > since && !parseConventionName(c.name)) bad.push({ name: c.name, folder: f.path, link: c.webViewLink });
    });
  }
  logRun_('checkNamingConvention', 'ok', '', bad.length + ' new files break the convention');
  return bad;
}

// ───────────────────────── rehearsal reset ─────────────────────────

/**
 * After a REHEARSAL on a dummy folder: forget that sandbox so the real run starts clean.
 * Deletes nothing in Drive (the dummy sandbox folder stays — trash it yourself if you like);
 * it only clears the settings and the log tabs. Refuses if a real restructure was applied.
 */
function resetLibraryRehearsal() {
  var undo = readTab_('UndoLog', UNDO_HEADERS).rows.filter(function (r) {
    return !r[7];
  });
  var confirmed = getProp_('REHEARSAL_RESET_OK') === 'yes';
  if (!confirmed) {
    throw new Error(
      'Safety: set Script Property REHEARSAL_RESET_OK = yes to confirm this sandbox was only a rehearsal (' +
        undo.length +
        ' un-undone changes in UndoLog).',
    );
  }
  [
    'SANDBOX_ROOT_ID',
    'ORIGINAL_ROOT_ID',
    'LIB_PCT_BEFORE',
    'LIB_PCT_LATEST',
    'PLAN_APPROVED',
    'SOURCE_FOLDER_ID',
    'REHEARSAL_RESET_OK',
  ].forEach(function (k) {
    PropertiesService.getScriptProperties().deleteProperty(k);
  });
  var ss = reportSpreadsheet_();
  ['CopyLog', 'Index', 'Plan', 'UndoLog'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent();
  });
  Logger.log('Rehearsal cleared. Set SOURCE_FOLDER_ID to the REAL WiCS folder and start again with surveyOriginal.');
}
