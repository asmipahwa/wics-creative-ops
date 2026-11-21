/**
 * config.js — every name, list and setting the system uses, in one place.
 *
 * WHY: if a section, form question or tab name lives in one place, renaming it
 * later is a one-line change instead of a hunt through every file.
 * Things the team should be able to change WITHOUT touching code (owners,
 * lead times) live in the `Routing` tab of the Report Sheet instead.
 */

var CONFIG = {
  TIMEZONE: 'America/Vancouver',
  ASANA_BASE: 'https://app.asana.com/api/1.0',
  PROJECT_NAME: 'WiCS Creative Requests',
  FORM_TITLE: 'WiCS Marketing – Creative Request',
  REPORT_SHEET_NAME: 'WiCS Creative Ops – Report',
  REQUESTS_FOLDER_NAME: 'WiCS Creative Requests – Working Folders',

  // Asana board columns, in pipeline order.
  SECTIONS: ['Intake', 'Needs Info', 'In Progress', 'In Review', 'Approved / Scheduled', 'Delivered', 'Archived'],

  REQUEST_TYPES: ['Instagram post', 'Reel', 'Story', 'Poster/Print', 'Event promo', 'Recap', 'Sponsor asset', 'Merch', 'Other'],

  CHANNELS: ['Instagram feed', 'Instagram Story', 'LinkedIn', 'Discord', 'Website', 'Email newsletter', 'Print / on campus', 'Other'],

  // A description shorter than this is "incomplete" (spec §2.3).
  MIN_DESCRIPTION_WORDS: 15,

  TABS: {
    ROUTING: 'Routing',
    INTAKE_LOG: 'IntakeLog',
    RUN_LOG: 'RunLog',
  },

  // Keys in Project Settings → Script Properties. Secrets ONLY live here.
  PROPS: {
    ASANA_TOKEN: 'ASANA_TOKEN',
    ASANA_WORKSPACE_GID: 'ASANA_WORKSPACE_GID',
    ASANA_TEAM_GID: 'ASANA_TEAM_GID', // only needed if your workspace is an "organization"
    MODE: 'MODE', // 'test' or 'live'
    REPORT_SHEET_ID: 'REPORT_SHEET_ID',
    FORM_ID: 'FORM_ID',
    REQUESTS_FOLDER_ID: 'REQUESTS_FOLDER_ID',
  },
};

// Form question titles. intake.js maps answers back to these keys, so the
// title text here MUST match the form exactly.
var Q = {
  requestorName: 'Your name',
  requestorEmail: 'Your email',
  type: 'Request type',
  event: 'Event or program',
  eventDate: 'Event date',
  description: 'What do you need?',
  channels: 'Channel(s)',
  neededBy: 'Needed-by date',
  copy: 'Key copy / text',
  references: 'Reference links',
  uploads: 'Reference files', // added by hand in the Forms UI (Apps Script can't create upload questions)
  sponsor: 'Is a sponsor or partner involved?',
  notes: 'Anything else?',
};

// Starting values for the Routing tab. Owner columns are blank on purpose:
// fill them in the Sheet. Blank owner → falls back to the "Default" row → then to you.
// Columns: type, owner name, owner email (must be an Asana workspace member),
//          lead time (days), needs references?, needs event date?
var DEFAULT_ROUTING = [
  ['Instagram post', '', '', 3, 'No', 'No'],
  ['Reel', '', '', 7, 'Yes', 'No'],
  ['Story', '', '', 2, 'No', 'No'],
  ['Poster/Print', '', '', 10, 'Yes', 'Yes'],
  ['Event promo', '', '', 7, 'Yes', 'Yes'],
  ['Recap', '', '', 3, 'No', 'Yes'],
  ['Sponsor asset', '', '', 10, 'Yes', 'No'],
  ['Merch', '', '', 21, 'Yes', 'No'],
  ['Other', '', '', 5, 'No', 'No'],
  ['Default', '', '', 5, 'No', 'No'],
];

/** Read a Script Property; throw a helpful error if a required one is missing. */
function getProp_(key, required) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !value) {
    throw new Error('Missing Script Property "' + key + '". See docs/SETUP.md.');
  }
  return value;
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/** 'test' unless you've explicitly switched to live — safer default. */
function currentMode_() {
  return getProp_(CONFIG.PROPS.MODE) === 'live' ? 'live' : 'test';
}

/** Today's date as YYYY-MM-DD in Vancouver time (not the server's time zone). */
function todayIso_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}
