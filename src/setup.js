/**
 * setup.js — one-time setup functions you run by hand from the Apps Script editor.
 * Each is safe to re-run: it reuses anything it already created.
 *
 * Order (details in docs/SETUP.md):
 *   1. setupGoogleSide()        → Report Sheet + Routing tab, intake Form, Requests folder
 *   2. (paste ASANA_TOKEN + ASANA_WORKSPACE_GID into Script Properties; listAsanaWorkspaces() helps)
 *   3. setupAsanaTestProject()  → "[TEST] WiCS Creative Requests" board
 *   4. installFormTrigger()     → form submissions now run onFormSubmit
 *   5. runSmokeTests() + 3 real test submissions
 *   6. setupAsanaLiveProject() then useLiveMode()
 */

function setupGoogleSide() {
  var P = CONFIG.PROPS;

  // Report Sheet
  var ssId = getProp_(P.REPORT_SHEET_ID);
  var ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.create(CONFIG.REPORT_SHEET_NAME);
  setProp_(P.REPORT_SHEET_ID, ss.getId());
  var routing = ss.getSheetByName(CONFIG.TABS.ROUTING);
  if (!routing) {
    routing = getOrCreateTab_(ss, CONFIG.TABS.ROUTING, ROUTING_HEADERS);
    routing.getRange(2, 1, DEFAULT_ROUTING.length, ROUTING_HEADERS.length).setValues(DEFAULT_ROUTING);
    routing.autoResizeColumns(1, ROUTING_HEADERS.length);
    var yesNo = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No']).build();
    routing.getRange(2, 5, DEFAULT_ROUTING.length, 2).setDataValidation(yesNo);
    routing.getRange('H1').setValue('Fill in owner name + the email they use in Asana. Blank owner → Default row → you.');
  }
  getOrCreateTab_(ss, CONFIG.TABS.INTAKE_LOG, INTAKE_LOG_HEADERS);
  getOrCreateTab_(ss, CONFIG.TABS.RUN_LOG, RUN_LOG_HEADERS);
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // Intake Form
  var formId = getProp_(P.FORM_ID);
  var form = formId ? FormApp.openById(formId) : buildIntakeForm_(ss.getId());
  setProp_(P.FORM_ID, form.getId());

  // Requests working-folder root
  var folderId = getProp_(P.REQUESTS_FOLDER_ID);
  var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.createFolder(CONFIG.REQUESTS_FOLDER_NAME);
  setProp_(P.REQUESTS_FOLDER_ID, folder.getId());

  if (!getProp_(P.MODE)) setProp_(P.MODE, 'test');

  Logger.log('Report Sheet: ' + ss.getUrl());
  Logger.log('Form (edit):  ' + form.getEditUrl());
  Logger.log('Form (share): ' + form.getPublishedUrl());
  Logger.log('Requests folder: ' + folder.getUrl());
  Logger.log('Mode: ' + currentMode_());
}

/**
 * Build the intake form. Required fields per spec §2.2.
 * Not possible from Apps Script: a File upload question — add it by hand,
 * titled exactly "Reference files" (see SETUP.md).
 * Not possible in Forms: "date must be ≥ N days away" — the script handles that by flagging Rush.
 */
function buildIntakeForm_(spreadsheetId) {
  var form = FormApp.create(CONFIG.FORM_TITLE);
  form
    .setDescription(
      'Use this form for ALL WiCS marketing requests (posts, reels, posters, recaps, sponsor assets, merch). ' +
        'You\'ll get an email with your ticket ID, owner and due date. Please don\'t send requests by DM — they get lost.'
    )
    .setConfirmationMessage('Got it! Check your email for your ticket ID and due date.')
    .setAllowResponseEdits(false);

  form.addTextItem().setTitle(Q.requestorName).setRequired(true);
  form
    .addTextItem()
    .setTitle(Q.requestorEmail)
    .setHelpText('We\'ll send your confirmation and any questions here.')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().setHelpText('Please enter a valid email.').build())
    .setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.type).setChoiceValues(CONFIG.REQUEST_TYPES).setRequired(true);
  form.addTextItem().setTitle(Q.event).setHelpText('e.g. TryCATCH 2026, Mentorship Program. Write "General" if it isn\'t tied to an event.').setRequired(true);
  form.addDateItem().setTitle(Q.eventDate).setHelpText('Leave blank if not tied to an event.').setRequired(false);
  form
    .addParagraphTextItem()
    .setTitle(Q.description)
    .setHelpText('What is it, who is it for, what should it make people do? Aim for 15+ words.')
    .setRequired(true);
  form.addCheckboxItem().setTitle(Q.channels).setChoiceValues(CONFIG.CHANNELS).setRequired(true);
  form
    .addDateItem()
    .setTitle(Q.neededBy)
    .setHelpText('Lead times: Story 2 days · Post/Recap 3 · Reel/Event promo 7 · Poster/Sponsor asset 10 · Merch 21. Sooner = flagged as Rush.')
    .setRequired(true);
  form
    .addParagraphTextItem()
    .setTitle(Q.copy)
    .setHelpText('The exact words that should appear (title, date/time, location, links, CTA). Write "TBD" if not final yet.')
    .setRequired(true);
  form
    .addParagraphTextItem()
    .setTitle(Q.references)
    .setHelpText('Links to examples, photos, sponsor brand guidelines, etc. Write "none" if you have none.')
    .setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.sponsor).setHelpText('If yes, the partner may need to approve the asset before it goes out.').setChoiceValues(['Yes', 'No']).setRequired(true);
  form.addParagraphTextItem().setTitle(Q.notes).setRequired(false);

  // Raw responses also land in the Report Sheet as a backup.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  return form;
}

function setupAsanaTestProject() {
  var r = asanaSetupProject_('test');
  Logger.log('TEST project gid=' + r.projectGid + ' sections=' + JSON.stringify(r.sections));
}

function setupAsanaLiveProject() {
  var r = asanaSetupProject_('live');
  Logger.log('LIVE project gid=' + r.projectGid + ' sections=' + JSON.stringify(r.sections));
}

/** Point the form at onFormSubmit. Removes old copies first so a submission never runs twice. */
function installFormTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  var form = FormApp.openById(getProp_(CONFIG.PROPS.FORM_ID, true));
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('onFormSubmit trigger installed for: ' + form.getTitle());
}

function useTestMode() {
  setProp_(CONFIG.PROPS.MODE, 'test');
  Logger.log('Mode: test → tickets go to the [TEST] board.');
}

function useLiveMode() {
  activeProjectGidFor_('live'); // throws if the live board isn't set up yet
  setProp_(CONFIG.PROPS.MODE, 'live');
  Logger.log('Mode: LIVE → tickets go to the real WiCS Creative Requests board.');
}

function activeProjectGidFor_(mode) {
  return getProp_(asanaProjectKey_(mode), true);
}

/** Print what's configured (never prints the token itself). */
function checkSetup() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).sort().forEach(function (k) {
    var v = k === CONFIG.PROPS.ASANA_TOKEN ? '(set, hidden)' : props[k].length > 80 ? props[k].slice(0, 80) + '…' : props[k];
    Logger.log(k + ' = ' + v);
  });
  Logger.log('Triggers: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
}
