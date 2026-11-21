const L = require('../src/logic');

const routing = [
  { type: 'Reel', ownerName: 'Ari', ownerEmail: 'ari@example.com', leadDays: 7, needsReferences: true, needsEventDate: false },
  { type: 'Poster/Print', ownerName: '', ownerEmail: '', leadDays: 10, needsReferences: true, needsEventDate: true },
  {
    type: 'Default',
    ownerName: 'Coordinator',
    ownerEmail: 'coord@example.com',
    leadDays: 5,
    needsReferences: false,
    needsEventDate: false,
  },
];

const longDesc = 'A thirty second reel recapping the hackathon for first year students showing teams presenting and the winners on stage';

function req(overrides) {
  return L.normalizeRequest(
    Object.assign(
      {
        requestorName: ' Sam ',
        requestorEmail: 'Sam@Example.com ',
        type: 'Reel',
        event: 'TryCATCH 2026',
        description: longDesc,
        channels: ['Instagram feed'],
        neededBy: '2026-12-01',
        copy: 'TryCATCH 2026 — thank you!',
        references: 'https://example.com/ref',
        sponsor: 'No',
      },
      overrides,
    ),
  );
}

describe('normalizeRequest', () => {
  test('trims, lowercases email, parses dates and sponsor', () => {
    const r = req({ neededBy: '12/1/2026', sponsor: 'Yes', channels: 'Instagram feed, LinkedIn' });
    expect(r.requestorName).toBe('Sam');
    expect(r.requestorEmail).toBe('sam@example.com');
    expect(r.neededBy).toBe('2026-12-01');
    expect(r.sponsor).toBe(true);
    expect(r.channels).toEqual(['Instagram feed', 'LinkedIn']);
  });
  test('defaults blank type/event', () => {
    const r = L.normalizeRequest({});
    expect(r.type).toBe('Other');
    expect(r.event).toBe('General');
    expect(r.uploads).toEqual([]);
  });
});

describe('findRoute', () => {
  test('exact type match (case-insensitive)', () => {
    const r = L.findRoute('reel', routing);
    expect(r.ownerEmail).toBe('ari@example.com');
    expect(r.leadDays).toBe(7);
  });
  test('blank owner inherits Default owner but keeps own lead time', () => {
    const r = L.findRoute('Poster/Print', routing);
    expect(r.ownerEmail).toBe('coord@example.com');
    expect(r.leadDays).toBe(10);
    expect(r.needsEventDate).toBe(true);
  });
  test('unknown type falls back to Default row', () => {
    expect(L.findRoute('Hologram', routing).ownerEmail).toBe('coord@example.com');
  });
  test('empty routing still returns a usable rule', () => {
    const r = L.findRoute('Reel', []);
    expect(r.leadDays).toBe(5);
    expect(r.ownerEmail).toBe('');
  });
});

describe('checkCompleteness', () => {
  const reelRoute = L.findRoute('Reel', routing);
  test('complete request → nothing missing', () => {
    expect(L.checkCompleteness(req(), reelRoute, 15)).toEqual([]);
  });
  test('short description is flagged', () => {
    const m = L.checkCompleteness(req({ description: 'need a reel' }), reelRoute, 15);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/description/);
  });
  test('placeholder copy is flagged', () => {
    ['TBD', 'n/a', '-', ' ', '??'].forEach((copy) => {
      expect(L.checkCompleteness(req({ copy }), reelRoute, 15).join()).toMatch(/copy/);
    });
  });
  test('design-heavy type with no references is flagged, unless files uploaded', () => {
    expect(L.checkCompleteness(req({ references: 'none' }), reelRoute, 15).join()).toMatch(/Reference/);
    expect(L.checkCompleteness(req({ references: 'none', uploads: ['https://drive/x'] }), reelRoute, 15)).toEqual([]);
  });
  test('non-design type does not need references', () => {
    const postRoute = L.findRoute('Instagram post', routing);
    expect(L.checkCompleteness(req({ type: 'Instagram post', references: 'none' }), postRoute, 15)).toEqual([]);
  });
  test('event-tied type needs event date', () => {
    const posterRoute = L.findRoute('Poster/Print', routing);
    expect(L.checkCompleteness(req({ type: 'Poster/Print' }), posterRoute, 15).join()).toMatch(/event date/);
    expect(L.checkCompleteness(req({ type: 'Poster/Print', eventDate: '2026-12-05' }), posterRoute, 15)).toEqual([]);
  });
});

describe('timing + priority', () => {
  test('daysBetween crosses months', () => {
    expect(L.daysBetween('2026-11-28', '2026-12-02')).toBe(4);
    expect(L.daysBetween('2026-12-02', '2026-11-28')).toBe(-4);
  });
  test('rush when needed sooner than lead time', () => {
    expect(L.assessTiming('2026-11-25', '2026-11-19', 7)).toEqual({ daysUntilDue: 6, rush: true });
    expect(L.assessTiming('2026-11-26', '2026-11-19', 7)).toEqual({ daysUntilDue: 7, rush: false });
  });
  test('past date is a rush', () => {
    expect(L.assessTiming('2026-11-10', '2026-11-19', 3).rush).toBe(true);
  });
  test('priority rules', () => {
    expect(L.priorityFor({ rush: true, daysUntilDue: 30 }, false)).toBe('P1');
    expect(L.priorityFor({ rush: false, daysUntilDue: 3 }, false)).toBe('P1');
    expect(L.priorityFor({ rush: false, daysUntilDue: 6 }, false)).toBe('P2');
    expect(L.priorityFor({ rush: false, daysUntilDue: 20 }, true)).toBe('P2');
    expect(L.priorityFor({ rush: false, daysUntilDue: 20 }, false)).toBe('P3');
  });
});

describe('names + notes', () => {
  test('task name is scannable and capped at 120 chars', () => {
    expect(L.buildTaskName(req())).toBe('Reel – TryCATCH 2026 – A thirty second reel recapping the hackathon');
    expect(L.buildTaskName(req({ event: 'x'.repeat(200) })).length).toBe(120);
  });
  test('folder name follows YYYY-MM-DD_Event_Type_ID', () => {
    expect(L.requestFolderName(req({ type: 'Poster/Print' }), '2_ABCaBc123xyz')).toBe('2026-12-01_TryCATCH2026_PosterPrint_123xyz');
  });
  test('notes carry response id + source for idempotency and sync', () => {
    const notes = L.buildTaskNotes(req(), {
      priority: 'P2',
      rush: false,
      leadDays: 7,
      requestedDate: '2026-11-19',
      source: 'form',
      responseId: 'resp-1',
      missing: ['The event date'],
    });
    expect(notes).toMatch(/^Requestor: Sam <sam@example.com>/);
    expect(notes).toMatch(/form_response_id: resp-1$/);
    expect(notes).toMatch(/source: form/);
    expect(notes).toMatch(/MISSING INFO[\s\S]*• The event date/);
  });
});

describe('retry policy', () => {
  test('retries only 429 and 5xx', () => {
    expect(L.shouldRetry(429)).toBe(true);
    expect(L.shouldRetry(503)).toBe(true);
    expect(L.shouldRetry(400)).toBe(false);
    expect(L.shouldRetry(401)).toBe(false);
  });
  test('honours Retry-After, else exponential capped at 32s', () => {
    expect(L.backoffMs(0, '7')).toBe(7000);
    expect(L.backoffMs(0)).toBe(1000);
    expect(L.backoffMs(3)).toBe(8000);
    expect(L.backoffMs(10)).toBe(32000);
  });
});
