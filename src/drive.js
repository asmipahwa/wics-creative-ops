/**
 * drive.js — Drive work.
 *
 * Sprint 1: one working folder per request, inside the Requests folder, named by
 * the naming convention, with Briefs / WIP / Final subfolders, so files for a
 * request have a home from day one instead of drifting into chat threads.
 *
 * (Sprint 3 adds the sandbox copy, inventory, restructure plan and undo log here.
 *  None of the Sprint 1 code touches the original WiCS Drive.)
 */

function createRequestFolder_(req, responseId) {
  var root = DriveApp.getFolderById(getProp_(CONFIG.PROPS.REQUESTS_FOLDER_ID, true));
  if (currentMode_() === 'test') root = getOrCreateSubfolder_(root, '_TEST');
  var folder = root.createFolder(requestFolderName(req, responseId));
  ['Briefs', 'WIP', 'Final'].forEach(function (n) {
    folder.createFolder(n);
  });
  return folder;
}

function getOrCreateSubfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
