/**
 * drive.js — Drive work.
 *
 * SAFETY: this project's Drive permission is `drive.file`, meaning
 * "only files this script created". Google itself blocks the script from
 * reading or changing anything else in your Drive (including the WiCS Drive),
 * even if a line of code here were wrong. That's why we use the Drive API
 * (advanced service `Drive`) instead of DriveApp, which needs full-Drive access.
 *
 * Sprint 1: one working folder per request, inside the Requests folder, named by
 * the naming convention, with Briefs / WIP / Final subfolders.
 */

var FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Create a folder (optionally inside a parent) and return {id, url}. */
function createFolder_(name, parentId) {
  var meta = { name: name, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  var f = Drive.Files.create(meta, null, { fields: 'id' });
  return { id: f.id, url: 'https://drive.google.com/drive/folders/' + f.id };
}

/** Find a subfolder this script created, or create it. */
function getOrCreateSubfolder_(parentId, name) {
  var q = "name = '" + name.replace(/'/g, "\\'") + "' and '" + parentId + "' in parents and mimeType = '" + FOLDER_MIME + "' and trashed = false";
  var found = Drive.Files.list({ q: q, fields: 'files(id)', pageSize: 1 }).files;
  if (found && found.length) return { id: found[0].id, url: 'https://drive.google.com/drive/folders/' + found[0].id };
  return createFolder_(name, parentId);
}

function createRequestFolder_(req, responseId) {
  var rootId = getProp_(CONFIG.PROPS.REQUESTS_FOLDER_ID, true);
  if (currentMode_() === 'test') rootId = getOrCreateSubfolder_(rootId, '_TEST').id;
  var folder = createFolder_(requestFolderName(req, responseId), rootId);
  ['Briefs', 'WIP', 'Final'].forEach(function (n) {
    createFolder_(n, folder.id);
  });
  return folder;
}
