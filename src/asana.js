/**
 * asana.js — every call to the Asana REST API goes through here.
 *
 * WHY one wrapper: retries, the auth header and error messages are handled in
 * one place. Asana's free plan allows 150 requests/minute; if we exceed it,
 * Asana answers 429 + Retry-After and we wait exactly that long.
 *
 * Free-plan note: custom fields need Asana Starter (paid). So fields are stored
 * as TAGS (for filtering on the board) + structured lines in the task
 * description (see buildTaskNotes in logic.js).
 */

var ASANA_MAX_RETRIES = 5;

/** Call Asana. `body` is wrapped in {data: …} as Asana expects. Returns the `data` part. */
function asanaFetch_(method, path, body, wantFullResponse) {
  var token = getProp_(CONFIG.PROPS.ASANA_TOKEN, true);
  var options = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    muteHttpExceptions: true,
  };
  if (body) options.payload = JSON.stringify({ data: body });

  for (var attempt = 0; ; attempt++) {
    var res = UrlFetchApp.fetch(CONFIG.ASANA_BASE + path, options);
    var status = res.getResponseCode();
    if (status >= 200 && status < 300) {
      var text = res.getContentText();
      if (!text) return null;
      var json = JSON.parse(text);
      return wantFullResponse ? json : json.data;
    }
    if (shouldRetry(status) && attempt < ASANA_MAX_RETRIES) {
      var headers = res.getHeaders();
      Utilities.sleep(backoffMs(attempt, headers['Retry-After'] || headers['retry-after']));
      continue;
    }
    var err = new Error('Asana ' + method.toUpperCase() + ' ' + path + ' → ' + status + ': ' + res.getContentText().slice(0, 500));
    err.status = status;
    throw err;
  }
}

/** Run this once after pasting your token, to find your workspace (and team) IDs. */
function listAsanaWorkspaces() {
  var me = asanaFetch_('get', '/users/me?opt_fields=name,email,workspaces.name,workspaces.is_organization');
  Logger.log('Token belongs to: ' + me.name + ' <' + me.email + '>');
  me.workspaces.forEach(function (ws) {
    Logger.log('Workspace "' + ws.name + '"  gid=' + ws.gid + (ws.is_organization ? '  (organization → also set ASANA_TEAM_GID)' : ''));
    if (ws.is_organization) {
      var teams = asanaFetch_('get', '/users/me/teams?workspace=' + ws.gid + '&opt_fields=name');
      teams.forEach(function (t) {
        Logger.log('    Team "' + t.name + '"  gid=' + t.gid);
      });
    }
  });
}

/** Property keys differ for test vs live so the two boards never mix. */
function asanaProjectKey_(mode) {
  return 'ASANA_PROJECT_GID_' + mode.toUpperCase();
}
function asanaSectionsKey_(mode) {
  return 'ASANA_SECTIONS_' + mode.toUpperCase();
}

/**
 * Create the board with its status columns, and remember the IDs.
 * Safe to re-run: if the project already exists for this mode, it reuses it.
 */
function asanaSetupProject_(mode) {
  var existing = getProp_(asanaProjectKey_(mode));
  var projectGid = existing;
  if (!projectGid) {
    var payload = {
      name: (mode === 'test' ? '[TEST] ' : '') + CONFIG.PROJECT_NAME,
      workspace: getProp_(CONFIG.PROPS.ASANA_WORKSPACE_GID, true),
      default_view: 'board',
      notes: 'Marketing creative requests. Created by the WiCS intake script — submit new requests via the Google Form.',
    };
    var team = getProp_(CONFIG.PROPS.ASANA_TEAM_GID);
    if (team) payload.team = team;
    projectGid = asanaFetch_('post', '/projects', payload).gid;
    setProp_(asanaProjectKey_(mode), projectGid);
  }

  // Make sure every pipeline section exists (rename Asana's default "Untitled section" if present).
  var sections = asanaFetch_('get', '/projects/' + projectGid + '/sections?opt_fields=name');
  var byName = {};
  sections.forEach(function (s) {
    byName[s.name] = s.gid;
  });
  CONFIG.SECTIONS.forEach(function (name) {
    if (byName[name]) return;
    var untitled = sections.filter(function (s) {
      return /^untitled section$/i.test(s.name) && !s.used;
    })[0];
    if (untitled) {
      untitled.used = true;
      asanaFetch_('put', '/sections/' + untitled.gid, { name: name });
      delete byName[untitled.name]; // it's been renamed; don't keep the old name around
      byName[name] = untitled.gid;
    } else {
      byName[name] = asanaFetch_('post', '/projects/' + projectGid + '/sections', { name: name }).gid;
    }
  });
  setProp_(asanaSectionsKey_(mode), JSON.stringify(byName));
  return { projectGid: projectGid, sections: byName };
}

function activeProjectGid_() {
  return getProp_(asanaProjectKey_(currentMode_()), true);
}

function activeSectionGid_(sectionName) {
  var map = JSON.parse(getProp_(asanaSectionsKey_(currentMode_()), true));
  if (!map[sectionName]) throw new Error('No Asana section "' + sectionName + '" — re-run setup.');
  return map[sectionName];
}

/** Find-or-create a tag by name, cached in Script Properties to save API calls. */
function asanaEnsureTag_(name) {
  var cacheKey = 'ASANA_TAGS';
  var cache = JSON.parse(getProp_(cacheKey) || '{}');
  if (cache[name]) return cache[name];
  var gid = asanaFetch_('post', '/tags', {
    name: name,
    workspace: getProp_(CONFIG.PROPS.ASANA_WORKSPACE_GID, true),
  }).gid;
  cache[name] = gid;
  setProp_(cacheKey, JSON.stringify(cache));
  return gid;
}

/**
 * Create the ticket and drop it into the right column.
 * If Asana rejects the assignee (e.g. owner hasn't joined the workspace yet),
 * retry assigned to the token owner so the request is never lost.
 */
function asanaCreateTask_(t) {
  var payload = {
    name: t.name,
    notes: t.notes,
    projects: [activeProjectGid_()],
    assignee: t.assignee || 'me',
    due_on: t.dueOn || null,
    tags: (t.tags || []).map(asanaEnsureTag_),
  };
  var task;
  var assigneeFellBack = false;
  try {
    task = asanaFetch_('post', '/tasks?opt_fields=gid,permalink_url,assignee.name', payload);
  } catch (err) {
    if (err.status === 400 && /assignee/i.test(err.message) && payload.assignee !== 'me') {
      payload.assignee = 'me';
      payload.notes =
        'NOTE: routed owner (' + t.assignee + ') is not in the Asana workspace yet — assigned to coordinator.\n\n' + payload.notes;
      task = asanaFetch_('post', '/tasks?opt_fields=gid,permalink_url,assignee.name', payload);
      assigneeFellBack = true;
    } else {
      throw err;
    }
  }
  asanaFetch_('post', '/sections/' + activeSectionGid_(t.sectionName) + '/addTask', { task: task.gid });
  return {
    gid: task.gid,
    url: task.permalink_url,
    assigneeName: task.assignee ? task.assignee.name : '',
    assigneeFellBack: assigneeFellBack,
  };
}

function asanaGetTask_(gid) {
  return asanaFetch_('get', '/tasks/' + gid + '?opt_fields=name,assignee.name,due_on,memberships.section.name,tags.name,notes');
}

/** All tasks in a project, following Asana's pages of 100 (next_page.offset). */
function asanaListProjectTasks_(projectGid, optFields) {
  var all = [];
  var offset = null;
  do {
    var path =
      '/projects/' +
      projectGid +
      '/tasks?limit=100&opt_fields=' +
      encodeURIComponent(optFields) +
      (offset ? '&offset=' + encodeURIComponent(offset) : '');
    var page = asanaFetch_('get', path, null, true);
    all = all.concat(page.data || []);
    offset = page.next_page ? page.next_page.offset : null;
  } while (offset);
  return all;
}

function asanaUpdateTask_(gid, fields) {
  return asanaFetch_('put', '/tasks/' + gid, fields);
}

function asanaMoveToSection_(taskGid, sectionName) {
  asanaFetch_('post', '/sections/' + activeSectionGid_(sectionName) + '/addTask', { task: taskGid });
}
