/**
 * docs.js — creates the team wiki and the meeting-notes template as Google Docs.
 *
 * The text lives in the repo (docs/wiki/wiki.md, templates/meeting-notes.md) and is
 * converted to HTML by `npm run build:html` (→ src/wiki.html, src/meeting_notes.html).
 * Google converts that HTML into a real Google Doc on upload — which only needs the
 * "files this app creates" Drive permission, not access to all your Docs.
 * Re-running updates the same Doc instead of making a new one.
 */

function createWikiDoc() {
  var html = fillPlaceholders_(HtmlService.createHtmlOutputFromFile('wiki').getContent());
  var url = upsertGoogleDoc_('WIKI_DOC_ID', 'WiCS Marketing — Team Wiki', html);
  Logger.log(
    'Wiki: ' +
      url +
      '\nTip: in the Doc, Insert → Table of contents → "With blue links" for a clickable TOC. Share it with the marketing team (Viewer or Commenter).',
  );
}

function createMeetingNotesTemplate() {
  var html = HtmlService.createHtmlOutputFromFile('meeting_notes').getContent();
  var url = upsertGoogleDoc_('MEETING_TEMPLATE_DOC_ID', 'WiCS Marketing — Meeting Notes TEMPLATE', html);
  Logger.log('Meeting-notes template: ' + url + '\nFor each meeting: File → Make a copy.');
}

function upsertGoogleDoc_(propKey, title, html) {
  var blob = Utilities.newBlob(html, 'text/html', title + '.html');
  var id = getProp_(propKey);
  if (id) {
    Drive.Files.update({ name: title }, id, blob, { fields: 'id' });
  } else {
    id = Drive.Files.create({ name: title, mimeType: 'application/vnd.google-apps.document' }, blob, { fields: 'id' }).id;
    setProp_(propKey, id);
  }
  return 'https://docs.google.com/document/d/' + id + '/edit';
}

/** Real links are filled in here, inside your Drive — they never appear in the public repo. */
function fillPlaceholders_(html) {
  var ss = reportSpreadsheet_();
  var tabUrl = function (name) {
    var sh = ss.getSheetByName(name);
    return sh ? ss.getUrl() + '#gid=' + sh.getSheetId() : ss.getUrl();
  };
  var formId = getProp_(CONFIG.PROPS.FORM_ID);
  var lib = getProp_('SANDBOX_ROOT_ID');
  var live = getProp_('ASANA_PROJECT_GID_LIVE');
  var values = {
    FORM_URL: formId ? FormApp.openById(formId).getPublishedUrl() : '#',
    DASHBOARD_URL: tabUrl('Dashboard'),
    SEARCH_URL: tabUrl('Search'),
    LIBRARY_URL: lib ? 'https://drive.google.com/drive/folders/' + lib : '#',
    BOARD_URL: live ? 'https://app.asana.com/0/' + live + '/board' : '#',
  };
  return html.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, function (m, k) {
    return values[k] !== undefined ? values[k] : m;
  });
}

/**
 * Before sharing the finished library with the team: rename the sandbox root from
 * "WiCS Marketing (Sandbox)" to "WiCS Marketing (Library)". Only ever touches the
 * sandbox root this script created.
 */
function publishLibraryName() {
  var id = getProp_('SANDBOX_ROOT_ID', true);
  Drive.Files.update({ name: 'WiCS Marketing (Library)' }, id, null, { fields: 'id' });
  Logger.log('Renamed. Share it from Drive with the marketing team as Viewer or Commenter: https://drive.google.com/drive/folders/' + id);
}
