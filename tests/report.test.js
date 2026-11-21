const L = require('../src/logic');

const TYPES = ['Instagram post', 'Reel', 'Poster/Print', 'Other'];

describe('normalizeStatus', () => {
  test('exact names, case-insensitive', () => {
    expect(L.normalizeStatus('in review')).toBe('In Review');
    expect(L.normalizeStatus('Approved / Scheduled')).toBe('Approved / Scheduled');
  });
  test('common aliases', () => {
    expect(L.normalizeStatus('done')).toBe('Delivered');
    expect(L.normalizeStatus('Posted')).toBe('Delivered');
    expect(L.normalizeStatus('wip')).toBe('In Progress');
    expect(L.normalizeStatus('cancelled')).toBe('Archived');
  });
  test('unknown → empty', () => {
    expect(L.normalizeStatus('maybe')).toBe('');
    expect(L.normalizeStatus('')).toBe('');
  });
});

describe('validateBackfillRow', () => {
  const good = {
    requested_date: '2026-09-01',
    requestor: 'Sam',
    type: 'Reel',
    event: 'TryCATCH',
    description: 'Recap reel',
    owner: 'Ari',
    due_date: '2026-09-10',
    delivered_date: '2026-09-09',
    status: 'Delivered',
    asset_link: '',
  };
  test('valid row', () => expect(L.validateBackfillRow(good, TYPES)).toEqual([]));
  test('Delivered needs a delivered date (no guessing)', () => {
    expect(L.validateBackfillRow({ ...good, delivered_date: '' }, TYPES).join()).toMatch(/delivered_date is empty/);
  });
  test('flags missing basics and bad type/status', () => {
    const errs = L.validateBackfillRow({ status: 'meh', type: 'Hologram' }, TYPES).join(' | ');
    expect(errs).toMatch(/requested_date/);
    expect(errs).toMatch(/Hologram/);
    expect(errs).not.toMatch(/owner/); // blank owner → Default owner
    expect(errs).toMatch(/status "meh"/);
  });
  test('accepts real Date objects from the Sheet', () => {
    expect(L.validateBackfillRow({ ...good, requested_date: new Date(2026, 8, 1) }, TYPES)).toEqual([]);
  });
});

describe('backfillKey', () => {
  test('same request with different spacing/case/date format → same key', () => {
    const a = L.backfillKey({ requested_date: '2026-09-01', type: 'Reel', event: 'TryCATCH', description: 'Recap  reel' });
    const b = L.backfillKey({ requested_date: '9/1/2026', type: 'reel', event: 'trycatch', description: 'recap reel' });
    expect(a).toBe(b);
  });
  test('different description → different key', () => {
    const a = L.backfillKey({ requested_date: '2026-09-01', type: 'Reel', event: 'X', description: 'one' });
    const b = L.backfillKey({ requested_date: '2026-09-01', type: 'Reel', event: 'X', description: 'two' });
    expect(a).not.toBe(b);
  });
});

describe('resolveOwnerEmail', () => {
  const routing = [{ ownerName: 'Ari', ownerEmail: 'ari@example.com' }];
  test('email passes through', () => expect(L.resolveOwnerEmail('Bo@Example.com', routing)).toBe('bo@example.com'));
  test('name looked up in Routing', () => expect(L.resolveOwnerEmail('ari', routing)).toBe('ari@example.com'));
  test('unknown name → blank (assigned to coordinator)', () => expect(L.resolveOwnerEmail('Zed', routing)).toBe(''));
});

describe('notes round-trip', () => {
  const req = L.normalizeRequest({
    requestorName: 'Sam',
    requestorEmail: 'sam@example.com',
    type: 'Reel',
    event: 'TryCATCH 2026',
    description: 'Recap: highlights from the day',
    neededBy: '2026-12-01',
    copy: 'Thanks!',
    references: 'none',
  });
  const notes = L.buildTaskNotes(req, {
    priority: 'P2',
    rush: true,
    daysUntilDue: 3,
    leadDays: 7,
    requestedDate: '2026-11-19',
    source: 'form',
    responseId: 'r1',
  });
  test('parseTaskNotes reads back what buildTaskNotes wrote', () => {
    expect(L.parseTaskNotes(notes)).toEqual({
      requestor: 'Sam',
      type: 'Reel',
      event: 'TryCATCH 2026',
      neededBy: '2026-12-01',
      priority: 'P2',
      rush: true,
      requestedDate: '2026-11-19',
      deliveredDate: '',
      assetLink: '',
      source: 'form',
      requestorEmail: 'sam@example.com',
      idleCheckSent: '',
    });
  });
  test('a "Label:" inside the description does not override header fields', () => {
    expect(L.parseTaskNotes(notes + '\nEvent: Something else').event).toBe('TryCATCH 2026');
  });
  test('setNoteField replaces just that line', () => {
    const updated = L.setNoteField(notes, 'Delivered date', '2026-11-30');
    expect(L.parseTaskNotes(updated).deliveredDate).toBe('2026-11-30');
    expect(updated.split('\n').length).toBe(notes.split('\n').length);
  });
  test('setNoteField adds the line to hand-made tasks', () => {
    expect(L.setNoteField('just text', 'Delivered date', '2026-11-30')).toBe('Delivered date: 2026-11-30\njust text');
  });
});

describe('ticketFromTask', () => {
  const P = 'proj1';
  const base = {
    gid: 42,
    name: 'Reel – X',
    created_at: '2026-11-01T18:00:00Z',
    due_on: '2026-11-20',
    assignee: { name: 'Ari' },
    memberships: [
      { project: { gid: 'other' }, section: { name: 'Nope' } },
      { project: { gid: P }, section: { name: 'In Progress' } },
    ],
    notes: 'Request type: Reel\nEvent: X\nRequested date: 2026-10-30\nsource: form',
  };
  test('open task', () => {
    const t = L.ticketFromTask(base, P, '2026-11-19');
    expect(t).toMatchObject({
      id: '42',
      status: 'In Progress',
      open: true,
      requested: '2026-10-30',
      daysOpen: 20,
      month: '2026-10',
      delivered: '',
      needsDeliveredStamp: false,
    });
  });
  test('moved to Delivered without a date → uses completion date and asks for a stamp', () => {
    const t = L.ticketFromTask(
      { ...base, completed: true, _completedLocal: '2026-11-18', memberships: [{ project: { gid: P }, section: { name: 'Delivered' } }] },
      P,
      '2026-11-19',
    );
    expect(t).toMatchObject({ open: false, delivered: '2026-11-18', daysOpen: 19, needsDeliveredStamp: true });
  });
  test('hand-made task with no notes still works', () => {
    const t = L.ticketFromTask({ gid: 1, name: 'x', created_at: '2026-11-10T00:00:00Z', memberships: [] }, P, '2026-11-19');
    expect(t).toMatchObject({ source: 'manual', owner: '(unassigned)', status: 'Intake', requested: '2026-11-10', open: true });
  });
});

describe('summarizeTickets', () => {
  const today = '2026-11-19'; // a Thursday
  const t = (o) =>
    Object.assign(
      { name: 'T', owner: 'Ari', open: true, due: '', delivered: '', requested: '2026-11-01', source: 'form', status: 'Intake' },
      o,
    );
  const tickets = [
    t({ name: 'late', due: '2026-11-17' }),
    t({ name: 'tomorrow', due: '2026-11-20' }),
    t({ name: 'sunday a', due: '2026-11-22' }),
    t({ name: 'sunday b', due: '2026-11-22' }),
    t({ name: 'next week', due: '2026-11-25', owner: 'Bo' }),
    t({
      name: 'done on time',
      open: false,
      due: '2026-11-10',
      delivered: '2026-11-08',
      requested: '2026-11-01',
      source: 'backfill',
      status: 'Delivered',
    }),
    t({
      name: 'done late',
      open: false,
      due: '2026-11-10',
      delivered: '2026-11-12',
      requested: '2026-11-02',
      source: 'backfill',
      status: 'Delivered',
    }),
  ];
  const s = L.summarizeTickets(tickets, today, 3);

  test('counts', () => {
    expect(s).toMatchObject({ total: 7, fromForm: 5, fromBackfill: 2, open: 5, delivered: 2 });
  });
  test('overdue / 48h / this week', () => {
    expect(s.overdue.map((x) => x.name)).toEqual(['late']);
    expect(s.due48h.map((x) => x.name)).toEqual(['tomorrow']);
    expect(s.dueThisWeek.map((x) => x.name)).toEqual(['late', 'tomorrow', 'sunday a', 'sunday b']);
  });
  test('workload spike: Ari has 4 open > threshold 3, Bo does not', () => {
    expect(s.spikes).toEqual([{ owner: 'Ari', open: 4 }]);
  });
  test('scheduling conflict: Ari has 2 due on the same day', () => {
    expect(s.conflicts).toEqual([{ owner: 'Ari', due: '2026-11-22', tasks: ['sunday a', 'sunday b'] }]);
  });
  test('cycle time + on-time %', () => {
    expect(s.medianCycleDays).toBe(8.5); // 7 and 10 days
    expect(s.onTimePct).toBe(50);
  });
});

describe('shouldArchive', () => {
  test('Delivered 14+ days ago', () => {
    expect(L.shouldArchive({ status: 'Delivered', delivered: '2026-11-05' }, '2026-11-19')).toBe(true);
    expect(L.shouldArchive({ status: 'Delivered', delivered: '2026-11-06' }, '2026-11-19')).toBe(false);
    expect(L.shouldArchive({ status: 'In Review', delivered: '2026-01-01' }, '2026-11-19')).toBe(false);
  });
});

describe('idleAction (still-needed check)', () => {
  test('open and untouched 14+ days → ask', () => expect(L.idleAction(true, '2026-11-01', '', '2026-11-15')).toBe('ask'));
  test('13 days → nothing yet', () => expect(L.idleAction(true, '2026-11-02', '', '2026-11-15')).toBe(''));
  test('asked 7+ days ago, no activity since → flag for archive', () => {
    expect(L.idleAction(true, '2026-11-15', '2026-11-15', '2026-11-22')).toBe('flag');
  });
  test('asked, then someone updated the task → no flag', () => {
    expect(L.idleAction(true, '2026-11-18', '2026-11-15', '2026-11-22')).toBe('');
  });
  test('closed tickets are never chased', () => expect(L.idleAction(false, '2026-01-01', '', '2026-11-15')).toBe(''));
});
