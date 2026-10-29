import { describe, expect, it } from 'vitest';
import {
  LOG_LINE,
  chatsForDay,
  newestFirst,
  parseDigest,
  parseLog,
  parseLogLine,
  parseRecording,
  parseSession,
  parseThreadCard,
  readLinks,
  recordingName,
} from '@/common/dayModel';

/** The five "after" lines in the plan's before-and-after examples, as written there. */
const PLAN_EXAMPLES = [
  "- 08:54 The untethered SN1 ranked first for the SF mast and tether, 7.7 against 6 for v3.1, in Elon's five-step algorithm (5 branches, 3 critics). It carries two packs in its bay plus a dedicated 5 GHz access point. · [[Library/chats/sf-site-one|SF Site One]], [[.claude/apps/sketches/mast-tether-v4/index.html|mast-tether-v4 page]], [CODY-171](https://linear.app/parametricpbc/issue/CODY-171), [Algorithm README](https://github.com/parametricpbc/parametric-3d-sandbox/blob/claude/mk02-refresh-r4/cad/mk02-refresh/mast-tether-algorithm-20261027/README.md) · agent turn",
  '- 08:55 Linked the MK0.2 static neck in Onshape from HW-196 and CODY-206, and commented the import on both issues. The version is First article 2026-10-24, with Part Studios NECK, HEAD-50 and HEAD-level. · [[Library/chats/neck-simplification|Neck Simplification]], [HW-196](https://linear.app/parametricpbc/issue/HW-196), [CODY-206](https://linear.app/parametricpbc/issue/CODY-206), [Onshape static neck](https://cad.onshape.com/documents/d6f8436d2dd9559a9cc55d03/w/be2e066f0c8c8ddc44cc1e31) · 4 connector calls',
  '- 10:07 Meet sync saved Meeting with all Kigali Operators (08:59, 27 min) with Lucas Czajka, Nehemie and John Newsom speaking. The transcript is saved; Gemini had not written notes yet. · [[Library/recordings/2026-10-28 0859 Meeting with all Kigali Operators (Meet)|Kigali Operators meeting]], [Meet doc](https://docs.google.com/document/d/1cb5DqH0u8PB-4J-Jb1FXV9ImZ1C971YstU29oy-NxJc/edit), [Calendar event](https://www.google.com/calendar/event?eid=NmNxN2NpaWw5aGY5anJjYjYxNGhiZTEzZDUgY29keUBwYXJhbWV0cmljLmNvbXBhbnk) · routine run',
  "- 13:14 Filed SW-640 (batteries, no tether) and SW-641 (tether take-up) for Kyle and posted both in John Newsom's #sf-nest-1 thread. John had asked for the existing nest tether designs so Kyle could reference them. · [[Library/chats/sf-site-one|SF Site One]], [#sf-nest-1 post](https://parametricpbc.slack.com/archives/C0C9REKS9ED/p1793218439762429?thread_ts=1793217358.443159&cid=C0C9REKS9ED), [SW-640](https://linear.app/parametricpbc/issue/SW-640), [SW-641](https://linear.app/parametricpbc/issue/SW-641) · agent turn",
  '- 21:48 Set Opal to black and white only, per Cody: no accent colour anywhere, neutral callouts, text-coloured links. The spec is updated in opal 0dec6da, and the rule is recorded in the taste notes. · [[Instructions/taste|Taste]], [[Library/chats/opal-status|Opal status]], [opal 0dec6da](https://github.com/codyswain/opal/commit/0dec6da), [pages-first UX spec](https://github.com/codyswain/opal/blob/simplify/pages-first/docs/product/2026-10-28-pages-first-ux.md) · agent turn',
];

const shape = (line: string) => {
  const entry = parseLogLine(line);
  if (!entry) throw new Error(`Not a log line: ${line}`);
  return {
    time: entry.time,
    kind: entry.kind,
    start: entry.text.split(' ').slice(0, 4).join(' '),
    separated: entry.text.includes(' · '),
    links: entry.links.map((link) => `${link.external ? 'external' : 'vault'} ${link.label}`),
  };
};

describe('log lines', () => {
  it('parses the five examples in the plan with the plan regex', () => {
    for (const line of PLAN_EXAMPLES) expect(LOG_LINE.test(line), line).toBe(true);
    expect(PLAN_EXAMPLES.map(shape)).toEqual([
      { time: '08:54', kind: 'agent turn', start: 'The untethered SN1 ranked', separated: false, links: ['vault SF Site One', 'vault mast-tether-v4 page', 'external CODY-171', 'external Algorithm README'] },
      { time: '08:55', kind: '4 connector calls', start: 'Linked the MK0.2 static', separated: false, links: ['vault Neck Simplification', 'external HW-196', 'external CODY-206', 'external Onshape static neck'] },
      { time: '10:07', kind: 'routine run', start: 'Meet sync saved Meeting', separated: false, links: ['vault Kigali Operators meeting', 'external Meet doc', 'external Calendar event'] },
      { time: '13:14', kind: 'agent turn', start: 'Filed SW-640 (batteries, no', separated: false, links: ['vault SF Site One', 'external #sf-nest-1 post', 'external SW-640', 'external SW-641'] },
      { time: '21:48', kind: 'agent turn', start: 'Set Opal to black', separated: false, links: ['vault Taste', 'vault Opal status', 'external opal 0dec6da', 'external pages-first UX spec'] },
    ]);
    const meet = parseLogLine(PLAN_EXAMPLES[2]);
    expect(meet?.text).toBe('Meet sync saved Meeting with all Kigali Operators (08:59, 27 min) with Lucas Czajka, Nehemie and John Newsom speaking. The transcript is saved; Gemini had not written notes yet.');
    expect(meet?.links[0]).toEqual({ label: 'Kigali Operators meeting', target: 'Library/recordings/2026-10-28 0859 Meeting with all Kigali Operators (Meet)', external: false });
    expect(parseLogLine(PLAN_EXAMPLES[3])?.links[1].target).toBe('https://parametricpbc.slack.com/archives/C0C9REKS9ED/p1793218439762429?thread_ts=1793217358.443159&cid=C0C9REKS9ED');
  });

  it('reads a folded range, a line with no links and the singular kinds', () => {
    expect(parseLogLine('- 10:02-10:14 Moved three notes into the Library layout. · 3 connector calls')).toEqual({
      time: '10:02', until: '10:14', text: 'Moved three notes into the Library layout.', kind: '3 connector calls', links: [],
    });
    expect(parseLogLine('- 07:00 Ran the morning digest. · [[Library/digests/2026-10-29 digest|Digest]] · routine run')?.kind).toBe('routine run');
    expect(parseLogLine('- 07:01 Searched Gmail for Tom. · connector call')?.kind).toBe('connector call');
  });

  it('reads old lines with their inline links and no kind, with or without the dash after the time', () => {
    expect(parseLogLine('- 10:07 Google Meet notes from 08:59, 27 min: [[Library/recordings/2026-10-28 0859 Meeting with all Kigali Operators (Meet)|Meeting with all Kigali Operators]]')).toEqual({
      time: '10:07',
      until: null,
      text: 'Google Meet notes from 08:59, 27 min: Meeting with all Kigali Operators',
      kind: null,
      links: [{ label: 'Meeting with all Kigali Operators', target: 'Library/recordings/2026-10-28 0859 Meeting with all Kigali Operators (Meet)', external: false }],
    });
    expect(parseLogLine('- 00:05 — Refactored NameDialog to use the Dialog component in opal')).toMatchObject({
      text: 'Refactored NameDialog to use the Dialog component in opal', kind: null, links: [],
    });
    expect(parseLogLine('- 09:20 Edited [the digest](Library/digests/2026-10-28%20digest.md) and [[Robert Xu]]')?.links).toEqual([
      { label: 'the digest', target: 'Library/digests/2026-10-28 digest.md', external: false },
      { label: 'Robert Xu', target: 'Robert Xu', external: false },
    ]);
    expect(parseLogLine('## Activity Log')).toBeNull();
    expect(parseLogLine('- not a time')).toBeNull();
  });

  it('reads a log file past its frontmatter and sorts it newest first, later lines first on a tie', () => {
    const entries = parseLog([
      '---', 'written_by: ai', 'type: log', 'date: 2026-10-28', '---',
      '- 08:50 Second machine, written late. · agent turn',
      '- 06:38 Ran daily triage.',
      '- 08:50 Same minute, later in the file. · routine run',
      '',
    ].join('\n'));
    expect(entries.map((entry) => entry.text)).toEqual(['Second machine, written late.', 'Ran daily triage.', 'Same minute, later in the file.']);
    expect(newestFirst(entries).map((entry) => entry.text)).toEqual(['Same minute, later in the file.', 'Second machine, written late.', 'Ran daily triage.']);
  });

  it('marks markdown links with a URL scheme external and keeps labels in the text', () => {
    expect(readLinks('See [mail](mailto:a@b.c), [x](<Library/a b.md>) and ![[photo.png]]')).toEqual({
      text: 'See mail, x and photo.png',
      links: [
        { label: 'mail', target: 'mailto:a@b.c', external: true },
        { label: 'x', target: 'Library/a b.md', external: false },
        { label: 'photo.png', target: 'photo.png', external: false },
      ],
    });
  });
});

const card = (created: string, title = 'A thread', status = 'active') =>
  parseThreadCard(`---\nwritten_by: ai\ntype: thread\ntitle: ${title}\nstatus: ${status}\ncreated: "${created}"\nupdated: "2026-10-30 09:00"\n---\n\n# ${title}\n`);

const session = (started: string, last: string, body: string, tool = 'claude') =>
  parseSession(`---\ntype: thread-transcript\ntool: ${tool}\nstarted: "${started}"\nlast: "${last}"\n---\n\n# Title\n\n${body}`);

describe('chats', () => {
  it('reads message stamps, carrying the date to stamps that leave it out and skipping automated messages', () => {
    const read = session('2026-10-28 20:27', '2026-10-29 09:57', [
      '**Cody** · 2026-10-28 20:27', '', 'first', '',
      '> [!ai] Claude · 20:33', '> answer', '',
      '**Cody** · 22:04', '', 'second', '',
      '> [!ai] Automated message · 2026-10-29 00:43',
      '> [!ai] Automated message · 2026-10-28 23:07',
      '> [!ai] Claude · 2026-10-29 00:43',
      '**Cody** · 06:35',
      '> [!ai] Claude · 09:52',
      '> **Cody** · 10:00 is quoted, not a stamp',
      '> [!ai] Automated message · 2026-10-30 07:00',
      '> [!ai] Codex · 2026-10-31 08:00',
    ].join('\n'));
    expect(read.days).toEqual({
      '2026-10-28': { last: '22:04', prompts: 2 },
      '2026-10-29': { last: '09:52', prompts: 1 },
      '2026-10-31': { last: '08:00', prompts: 0 },
    });
    expect(read.tool).toBe('claude');
  });

  it("lists the threads created that day and the ones continued that day, newest activity first", () => {
    const date = '2026-10-28';
    const cards = [
      { thread: 'opal-status', path: '/V/Library/chats/opal-status.md', card: card('2026-10-28 20:27', 'Opal status') },
      { thread: 'model-training', path: '/V/Library/chats/model-training.md', card: card('2026-10-20 20:43', 'Model Training', 'pinned') },
      { thread: 'quiet', path: '/V/Library/chats/quiet.md', card: card('2026-10-28 16:20', 'Quiet', 'archived') },
      { thread: 'later', path: '/V/Library/chats/later.md', card: card('2026-10-25 10:00', 'Later') },
      { thread: 'not-a-thread', path: '/V/Library/chats/not-a-thread.md', card: parseThreadCard('---\ncreated: "2026-10-28 08:00"\n---\n') },
    ];
    const sessions = [
      { thread: 'opal-status', path: '/V/Library/chats/opal-status/a.md', session: session('2026-10-28 20:27', '2026-10-29 09:57', '**Cody** · 2026-10-28 20:27\n> [!ai] Claude · 23:07\n**Cody** · 2026-10-29 06:35') },
      { thread: 'model-training', path: '/V/Library/chats/model-training/a.md', session: session('2026-10-20 20:43', '2026-10-29 01:46', '**Cody** · 2026-10-20 20:43\n**Cody** · 2026-10-28 08:49\n**Cody** · 23:31') },
      { thread: 'model-training', path: '/V/Library/chats/model-training/b.md', session: session('2026-10-28 09:00', '2026-10-28 09:30', '**Cody** · 2026-10-28 09:00', 'codex') },
      // Updated later, but nothing happened in it on the day: the card's `updated` is not used.
      { thread: 'later', path: '/V/Library/chats/later/a.md', session: session('2026-10-25 10:00', '2026-10-30 09:00', '**Cody** · 2026-10-25 10:00\n**Cody** · 2026-10-30 09:00') },
      { thread: 'no-card', path: '/V/Library/chats/no-card/a.md', session: session('2026-10-28 12:00', '2026-10-28 12:10', '**Cody** · 2026-10-28 12:00', 'codex') },
    ];
    expect(chatsForDay(date, cards, sessions)).toEqual([
      { path: '/V/Library/chats/model-training.md', title: 'Model Training', status: 'pinned', tool: 'claude', isNew: false, created: '2026-10-20 20:43', last: '23:31', prompts: 3 },
      { path: '/V/Library/chats/opal-status.md', title: 'Opal status', status: 'active', tool: 'claude', isNew: true, created: '2026-10-28 20:27', last: '23:07', prompts: 1 },
      { path: '/V/Library/chats/quiet.md', title: 'Quiet', status: 'archived', tool: null, isNew: true, created: '2026-10-28 16:20', last: '16:20', prompts: 0 },
      { path: '/V/Library/chats/no-card/a.md', title: 'no-card', status: null, tool: 'codex', isNew: false, created: null, last: '12:00', prompts: 1 },
    ]);
    expect(chatsForDay('2026-10-29', cards, sessions).map((chat) => [chat.title, chat.last, chat.isNew])).toEqual([
      ['Opal status', '06:35', false],
    ]);
  });
});

describe('recordings', () => {
  it('reads the date, time and title from the file name', () => {
    expect(recordingName('2026-10-28 0859 Meeting with all Kigali Operators (Meet).md')).toEqual({ date: '2026-10-28', time: '08:59', title: 'Meeting with all Kigali Operators' });
    expect(recordingName('2026-10-22 1050 Operator Staffing and Robot Hardware.md')?.title).toBe('Operator Staffing and Robot Hardware');
    expect(recordingName('2026-10-15 124448 IMG_4601.jpg')).toBeNull();
  });

  const meet = (summary: string) => [
    '---', 'written_by: ai', 'source: meet', 'title: "Meeting with all Kigali Operators"', 'recorded_at: 2026-10-28T08:59:00-07:00', 'duration_min: 27',
    'speakers: ["Lucas Czajka", "Nehemie Nzayisingiza"]', 'attendees: ["nehemie@parametric.company", "cody@parametric.company"]', '---',
    '# Meeting with all Kigali Operators', '',
    'Met 2026-10-28, 08:59 to 09:26 (27 min), on Google Meet. Day: [[Library/logs/2026-10-28 log|2026-10-28]]', '',
    'Google: [Notes by Gemini](https://docs.google.com/document/d/1cb5/edit?usp=drivesdk), [calendar event](https://www.google.com/calendar/event?eid=NmNx)', '',
    '## Summary', '', summary, '', '## Transcript', '', '**[09:00:14] Lucas Czajka:** Hey', '',
  ].join('\n');

  it('reads a Meet note: source, duration, people, header links, and whether the summary has text', () => {
    expect(parseRecording(meet('_Gemini has not written notes for this meeting yet._'))).toEqual({
      title: 'Meeting with all Kigali Operators',
      source: 'meet',
      durationMin: 27,
      speakers: ['Lucas Czajka', 'Nehemie Nzayisingiza'],
      attendees: ['nehemie@parametric.company', 'cody@parametric.company'],
      hasSummary: false,
      links: [
        { label: 'Notes by Gemini', target: 'https://docs.google.com/document/d/1cb5/edit?usp=drivesdk', external: true },
        { label: 'calendar event', target: 'https://www.google.com/calendar/event?eid=NmNx', external: true },
      ],
    });
    expect(parseRecording(meet("A summary wasn't produced for this meeting because there wasn't enough conversation in a supported language.\n\nIf the meeting was transcribed, you can review the transcript.")).hasSummary).toBe(false);
    expect(parseRecording(meet('[Kyle Haynes](mailto:kyle@parametric.company) [John Newsom](mailto:john@parametric.company)\n\nThe team agreed to ship the rig.')).hasSummary).toBe(true);
  });

  it('reads a Pocket note with a long summary and no speakers', () => {
    const pocket = parseRecording([
      '---', 'source: pocket', 'title: "Operator Staffing and Robot Hardware"', 'duration_min: 20', 'speakers: []', '---',
      '# Operator Staffing and Robot Hardware', '', 'Recorded on Pocket. Day: [[Library/logs/2026-10-22 log|2026-10-22]]', '',
      '## Summary', '', 'The strategy centers on the San Francisco operator role.', '', '### Operational Pivot', 'More.', '', '## Action items', '- Do it',
    ].join('\n'));
    expect(pocket).toMatchObject({ source: 'pocket', durationMin: 20, speakers: [], attendees: [], hasSummary: true, links: [] });
  });
});

describe('digests', () => {
  const noEmoji = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/\p{Extended_Pictographic}/u);

  it('takes the Top 3 as the top group and sorts Also worth doing by its priority words', () => {
    const digest = parseDigest([
      '---', 'written_by: ai', '---',
      '# Digest, Thu 2026-10-29 (scheduled, 07:00)', '',
      '## Yesterday', '', '- Tom Compas agreed the offer terms.', '',
      '## Top 3', '',
      "1. **Orrick at 2:00: get answers on Tom's 409A price and early exercise.** Tom's wait ([CODY-209](https://codys-mac-mini-1.tail51bb4a.ts.net/map#card=cody-209)) expires at 5pm.",
      '2. **Tell Richard Hurley that Friday 2:00pm PT works.** He asked "let me know if that works for y\'all?"',
      '3. **Give John the NUC or Mac Mini answer.** `due 0d`', '',
      '## Also worth doing', '',
      '1. Urgent: [SW-619](https://linear.app/parametricpbc/issue/SW-619), mount the 4 torsos. `due 0d`.',
      '2. High: grant Sol access to the Onshape static-neck document.',
      '3. Medium: RSVP to Said Aram\'s call, Fri Oct 30 11:00.',
      '4. Low: Steven Peng asked about a summer 2027 internship. [Email](https://mail.google.com/mail/u/0/#all/1a18)',
      '5. Read the Capacity thread again.', '',
      '## People', '', '- **Sunada Chakravarthy** (Capacity): chased Tommy.', '',
      '```md', '## Not a section', '```',
    ].join('\n'));
    expect(digest.title).toBe('Digest, Thu 2026-10-29 (scheduled, 07:00)');
    expect(digest.sections).toEqual(['Yesterday', 'Top 3', 'Also worth doing', 'People']);
    expect(digest.groups).toEqual([
      {
        level: 'top',
        items: [
          { text: "Orrick at 2:00: get answers on Tom's 409A price and early exercise. Tom's wait (CODY-209) expires at 5pm.", replyDrafted: false },
          { text: 'Tell Richard Hurley that Friday 2:00pm PT works. He asked "let me know if that works for y\'all?"', replyDrafted: false },
          { text: 'Give John the NUC or Mac Mini answer. due 0d', replyDrafted: false },
        ],
      },
      { level: 'high', items: [{ text: 'SW-619, mount the 4 torsos. due 0d.', replyDrafted: false }, { text: 'Grant Sol access to the Onshape static-neck document.', replyDrafted: false }] },
      { level: 'medium', items: [{ text: "RSVP to Said Aram's call, Fri Oct 30 11:00.", replyDrafted: false }, { text: 'Read the Capacity thread again.', replyDrafted: false }] },
      { level: 'low', items: [{ text: 'Steven Peng asked about a summer 2027 internship. Email', replyDrafted: false }] },
    ]);
    noEmoji(digest);
  });

  it('groups an older digest by its priority emoji, without the emoji, and reads folded callout titles', () => {
    const digest = parseDigest([
      '---', 'written_by: ai', '---',
      '# Digest, Wed 2026-10-28 (run 07:30, scheduled)', '',
      '- 🔴 Central processes the Oct 30 payroll at 2:00 PM today.',
      '- 🔴 AWS ALB authentication certificates are due today.',
      '- 🟡 11:00 Lucas 1:1: 750 Zipline boxes made in Kigali for $2,246.',
      '- 🟡 Sourish (PI) has been quiet on the teleop samples for 29 days. (reply drafted)',
      '- ⚪ Tom Compas said at 7:11 he will answer on the offer this morning.', '',
      '> [!note]- **Yesterday**: seven 1:1s set deployment-plan measures',
      '> - 🔴 Inside a callout, so not a top item.', '',
      '> [!note]- **The work** — SW-611 is 9 days past its build date', '',
      '> [!note]- Skills here', '',
    ].join('\n'));
    expect(digest.sections).toEqual(['Yesterday', 'The work', 'Skills here']);
    expect(digest.groups).toEqual([
      { level: 'high', items: [{ text: 'Central processes the Oct 30 payroll at 2:00 PM today.', replyDrafted: false }, { text: 'AWS ALB authentication certificates are due today.', replyDrafted: false }] },
      { level: 'medium', items: [{ text: '11:00 Lucas 1:1: 750 Zipline boxes made in Kigali for $2,246.', replyDrafted: false }, { text: 'Sourish (PI) has been quiet on the teleop samples for 29 days.', replyDrafted: true }] },
      { level: 'low', items: [{ text: 'Tom Compas said at 7:11 he will answer on the offer this morning.', replyDrafted: false }] },
    ]);
    noEmoji(digest);
  });

  it('gives a digest with only sections no groups', () => {
    const digest = parseDigest('#digest\n\n# Digest — Tuesday, 2026-07-28\n\n## Yesterday\n- A thing.\n## Today\n');
    expect(digest).toEqual({ title: 'Digest — Tuesday, 2026-07-28', groups: [], sections: ['Yesterday', 'Today'] });
  });
});
