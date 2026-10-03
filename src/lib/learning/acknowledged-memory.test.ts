import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcknowledgedMemory } from './acknowledged-memory.ts';

type Record = { id: string; revision: number; savedAt: string; status: 'draft' | 'submitted'; decisionLocked: boolean; answer: string; writeAccess: boolean };
const scope = JSON.stringify(['workspace-a', 'program-a', 'learner-a', 'version-1', 'activity']);
const draft = (revision: number, answer: string, extra: Partial<Record> = {}): Record => ({ id: 'attempt-a', revision, answer, savedAt: `2026-10-03T18:00:${String(revision).padStart(2, '0')}Z`, status: 'draft', decisionLocked: false, writeAccess: true, ...extra });

test('Back after confirmed save restores option 3, never the historical option 2', () => {
  const memory = createAcknowledgedMemory<Record>();
  const historicalPage = draft(3, 'option-2');
  memory.remember(scope, draft(4, 'option-3'));
  const returnedPage = memory.restore(scope, historicalPage)!;
  assert.equal(returnedPage.answer, 'option-3');
  assert.equal(returnedPage.revision, 4);
  assert.equal(historicalPage.answer, 'option-2');
});

test('late older ACK and later local edits cannot alter the last acknowledged answers', () => {
  const memory = createAcknowledgedMemory<Record>();
  const acknowledgement = draft(5, 'newest-confirmed');
  memory.remember(scope, acknowledgement);
  acknowledgement.answer = 'unconfirmed-local-edit';
  memory.remember(scope, draft(4, 'late-old-response'));
  assert.equal(memory.restore(scope, draft(3, 'historical'))!.answer, 'newest-confirmed');
  assert.equal(acknowledgement.answer, 'unconfirmed-local-edit');
});

test('fresh or equal revision server snapshot remains authoritative, including denied write access', () => {
  const memory = createAcknowledgedMemory<Record>();
  memory.remember(scope, draft(4, 'confirmed'));
  const closed = draft(4, 'confirmed', { writeAccess: false });
  assert.equal(memory.restore(scope, closed), closed);
  const newer = draft(6, 'saved-in-another-tab', { writeAccess: false });
  assert.equal(memory.restore(scope, newer), newer);
});

test('another account, workspace, program, version or activity cannot recover this content', () => {
  const memory = createAcknowledgedMemory<Record>();
  memory.remember(scope, draft(4, 'owner-only'));
  const parts = JSON.parse(scope) as string[];
  for (let index = 0; index < parts.length; index++) {
    const foreignScope = [...parts]; foreignScope[index] = 'different';
    assert.equal(memory.restore(JSON.stringify(foreignScope), null), null);
  }
});

test('decision lock and final submission survive a return to an older draft page', () => {
  const memory = createAcknowledgedMemory<Record>();
  const historical = draft(3, 'chosen');
  memory.remember(scope, draft(4, 'chosen', { decisionLocked: true }));
  assert.equal(memory.restore(scope, historical)!.decisionLocked, true);
  memory.remember(scope, draft(5, 'chosen', { decisionLocked: true, status: 'submitted', writeAccess: false }));
  assert.equal(memory.restore(scope, historical)!.status, 'submitted');
  assert.equal(memory.restore(scope, historical)!.decisionLocked, true);
});

test('recovery retains the submitted parent and never substitutes another explicit attempt', () => {
  const memory = createAcknowledgedMemory<Record>();
  memory.remember(scope, draft(6, 'submitted-answer', { status: 'submitted' }));
  memory.remember(scope, draft(1, '', { id: 'recovery-b', savedAt: '2026-10-03T18:01:00Z' }));
  assert.equal(memory.restore(scope, draft(3, 'old-answer'))!.status, 'submitted');
  assert.equal(memory.restore(scope, draft(1, '', { id: 'recovery-b' }))!.answer, '');
  const unrelated = draft(1, 'third-attempt', { id: 'unrelated' });
  assert.equal(memory.restore(scope, unrelated), unrelated);
});

test('a saved or submitted new idea can be displayed after returning to the original empty snapshot', () => {
  const memory = createAcknowledgedMemory<Record>();
  memory.remember(scope, draft(1, 'saved-idea', { id: 'idea' }));
  assert.equal(memory.restore(scope, null)!.answer, 'saved-idea');
  memory.remember(scope, draft(3, 'saved-idea', { id: 'idea', status: 'submitted' }));
  assert.equal(memory.restore(scope, null)!.status, 'submitted');
});
