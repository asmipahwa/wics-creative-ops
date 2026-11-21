const L = require('../src/library_logic');

describe('SAFETY GUARD: checkInSandbox', () => {
  // A small fake Drive: id → parent ids
  const tree = {
    origFile: ['origSub'],
    origSub: ['ORIGINAL'],
    ORIGINAL: ['myDrive'],
    copyFile: ['copySub'],
    copySub: ['SANDBOX'],
    SANDBOX: ['myDrive'],
    stray: ['myDrive'],
    myDrive: [],
    loopA: ['loopB'],
    loopB: ['loopA'],
    multi: ['stray', 'copySub'],
  };
  const parents = (id) => tree[id] || [];
  const check = (id) => L.checkInSandbox(id, 'SANDBOX', 'ORIGINAL', parents);

  test('allows a file inside the sandbox', () => expect(check('copyFile').ok).toBe(true));
  test('REFUSES a file inside the original WiCS folder', () => {
    expect(check('origFile')).toEqual({ ok: false, reason: 'file is inside the ORIGINAL WiCS folder' });
  });
  test('REFUSES the original folder itself', () => expect(check('ORIGINAL').ok).toBe(false));
  test('REFUSES the sandbox root itself', () => expect(check('SANDBOX').ok).toBe(false));
  test('REFUSES a file elsewhere in My Drive', () => expect(check('stray').ok).toBe(false));
  test('REFUSES when the sandbox root is not configured', () => {
    expect(L.checkInSandbox('copyFile', '', 'ORIGINAL', parents).ok).toBe(false);
  });
  test('does not hang on a parent loop', () => expect(check('loopA').ok).toBe(false));
  test('a file with an original-folder parent anywhere is refused even if also in sandbox', () => {
    const t2 = Object.assign({}, tree, { both: ['origSub', 'copySub'] });
    expect(L.checkInSandbox('both', 'SANDBOX', 'ORIGINAL', (id) => t2[id] || []).ok).toBe(false);
  });
});

describe('naming convention', () => {
  test('parses a valid name', () => {
    expect(L.parseConventionName('2026-11-08_TryCATCH_Poster_IG_v02.png')).toEqual({
      date: '2026-11-08',
      event: 'TryCATCH',
      assetType: 'Poster',
      channel: 'IG',
      version: 2,
      ext: 'png',
    });
  });
  test('Google files have no extension', () => {
    expect(L.parseConventionName('2026-09-01_General_Doc_Gen_v01')).not.toBeNull();
  });
  test('rejects legacy names', () => {
    [
      'Final poster FINAL (2).png',
      'IMG_4432.jpg',
      '2026-11-08_Try CATCH_Poster_IG_v02.png',
      '2026-11-08_TryCATCH_Flyer_IG_v02.png',
    ].forEach((n) => expect(L.parseConventionName(n)).toBeNull());
  });
});

describe('dates', () => {
  test('academic year runs Sept → Aug', () => {
    expect(L.academicYear('2026-09-01')).toBe('2026-27');
    expect(L.academicYear('2027-08-31')).toBe('2026-27');
    expect(L.academicYear('2026-04-01')).toBe('2025-26');
  });
  test('dates in file names', () => {
    expect(L.dateFromName('IMG_20261108_1234.jpg')).toBe('2026-11-08');
    expect(L.dateFromName('poster 2026-11-08 final.png')).toBe('2026-11-08');
    expect(L.dateFromName('recap 11-8-2026.png')).toBe('2026-11-08');
    expect(L.dateFromName('IMG_4432.jpg')).toBe('');
  });
});

describe('guessing type + channel', () => {
  test('asset types', () => {
    expect(L.guessAssetType('WiCS logo white.png', '', 'image/png')).toBe('Logo');
    expect(L.guessAssetType('trycatch reel.mp4', '', 'video/mp4')).toBe('Reel');
    expect(L.guessAssetType('clip.mov', '', 'video/quicktime')).toBe('Video');
    expect(L.guessAssetType('IMG_4432.jpg', 'Events/x', 'image/jpeg')).toBe('Photo');
    expect(L.guessAssetType('schedule.png', 'Posters', 'image/png')).toBe('Poster');
    expect(L.guessAssetType('notes', '', 'application/vnd.google-apps.document')).toBe('Doc');
  });
  test('channels', () => {
    expect(L.guessChannel('x', 'LinkedIn', 'Graphic')).toBe('LI');
    expect(L.guessChannel('x', '', 'Story')).toBe('IG');
    expect(L.guessChannel('x', '', 'Poster')).toBe('Print');
    expect(L.guessChannel('x', '', 'Photo')).toBe('Gen');
  });
  test('longest keyword wins', () => {
    const rows = [
      { keyword: 'wics', name: 'General' },
      { keyword: 'wics hacks', name: 'WiCS Hacks' },
    ];
    expect(L.matchKeyword('Events/WiCS Hacks 2026/poster.png', rows).name).toBe('WiCS Hacks');
  });
});

describe('proposeLocation', () => {
  const events = [
    { keyword: 'trycatch', name: 'TryCATCH', kind: 'event' },
    { keyword: 'mentorship', name: 'Mentorship Program', kind: 'program' },
  ];
  const sponsors = [{ keyword: 'acme', name: 'Acme Corp' }];
  const p = (name, path, mimeType, created) =>
    L.proposeLocation({ name, path, mimeType, originalCreated: created || '2026-10-01' }, events, sponsors);

  test('event photo → Events/<year>/<event>/Recap with convention name', () => {
    expect(p('IMG_20261108_1234.jpg', 'Old/TryCATCH/photos', 'image/jpeg')).toMatchObject({
      folder: '01_Events/2026-27/TryCATCH/Recap',
      name: '2026-11-08_TryCATCH_Photo_Gen_v01.jpg',
    });
  });
  test('drafts go to WIP, version kept', () => {
    expect(p('poster draft v3.png', 'TryCATCH/drafts', 'image/png', '2026-10-20')).toMatchObject({
      folder: '01_Events/2026-27/TryCATCH/WIP',
      name: '2026-10-20_TryCATCH_Poster_Print_v03.png',
      dateSource: 'created',
    });
  });
  test('logos → 00_Brand', () => expect(p('logo.svg', 'misc', 'image/svg+xml').folder).toBe('00_Brand'));
  test('sponsor approvals → 03_Sponsors/<Sponsor>/Approvals', () => {
    expect(p('acme feedback.pdf', 'Sponsors/Acme', 'application/pdf').folder).toBe('03_Sponsors/AcmeCorp/Approvals');
  });
  test('programs → 02_Programs', () =>
    expect(p('banner.png', 'Mentorship', 'image/png').folder).toBe('02_Programs/MentorshipProgram/Final'));
  test('unclassifiable → 99_Archive with a note', () => {
    const r = p('random.zip', 'stuff', 'application/zip');
    expect(r.folder).toBe('99_Archive');
    expect(r.note).toMatch(/could not classify/);
  });
  test('already-conventional names stay as they are', () => {
    expect(p('2026-11-08_TryCATCH_Poster_IG_v02.png', '01_Events/2026-27/TryCATCH/Final', 'image/png').name).toBe(
      '2026-11-08_TryCATCH_Poster_IG_v02.png',
    );
  });
  test('Google Docs get no extension', () => {
    expect(p('TryCATCH brief', 'TryCATCH', 'application/vnd.google-apps.document').name).toBe('2026-10-01_TryCATCH_Doc_Gen_v01');
  });
});

describe('dedupeNames', () => {
  test('same target name in same folder → version bump, never overwrite', () => {
    const out = L.dedupeNames([
      { folder: 'A', name: '2026-11-08_X_Photo_Gen_v01.jpg' },
      { folder: 'A', name: '2026-11-08_X_Photo_Gen_v01.jpg' },
      { folder: 'B', name: '2026-11-08_X_Photo_Gen_v01.jpg' },
    ]);
    expect(out.map((o) => o.name)).toEqual([
      '2026-11-08_X_Photo_Gen_v01.jpg',
      '2026-11-08_X_Photo_Gen_v02.jpg',
      '2026-11-08_X_Photo_Gen_v01.jpg',
    ]);
  });
});

describe('isCreativeFile', () => {
  test('counts images, video, PDFs, decks, design files', () => {
    expect(L.isCreativeFile('image/png', 'a.png')).toBe(true);
    expect(L.isCreativeFile('video/mp4', 'a.mp4')).toBe(true);
    expect(L.isCreativeFile('application/pdf', 'poster.pdf')).toBe(true);
    expect(L.isCreativeFile('application/vnd.google-apps.presentation', 'deck')).toBe(true);
    expect(L.isCreativeFile('application/octet-stream', 'poster.psd')).toBe(true);
  });
  test('does not count docs, sheets, forms, shortcuts', () => {
    expect(L.isCreativeFile('application/vnd.google-apps.document', 'notes')).toBe(false);
    expect(L.isCreativeFile('application/vnd.google-apps.spreadsheet', 'budget')).toBe(false);
    expect(L.isCreativeFile('application/vnd.google-apps.shortcut', 'x')).toBe(false);
  });
});
