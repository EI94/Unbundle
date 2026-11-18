import test from "node:test";
import assert from "node:assert/strict";
import { LEARNING_LEAVE_GRACE_MS, createLearningLeaveGuard } from "./leave-guard.ts";

// (Rilascio 10, ondata 1) Le modifiche non salvate della Formazione chiedono nella finestra dell'app: lo stato della
// guardia, senza React e senza DOM. Un orologio finto per i 500 ms dopo la conferma.

function setup() {
  const clock = { now: 1_000 };
  const guard = createLearningLeaveGuard(() => clock.now);
  let notified = 0;
  const unsubscribe = guard.subscribe(() => {
    notified += 1;
  });
  return { clock, guard, unsubscribe, notified: () => notified };
}

test("nothing registered, or nothing dirty: the step goes ahead at once and no dialog opens", () => {
  const { guard } = setup();
  assert.equal(guard.request("leave"), true);
  guard.register({}, { dirty: false });
  assert.equal(guard.request("continue", () => assert.fail("not called")), true);
  assert.equal(guard.current(), null);
  assert.equal(guard.blocksUnload(), false);
});

test("without the dialog mounted nothing is blocked: nobody could answer", () => {
  const { guard, unsubscribe } = setup();
  guard.register({}, { dirty: true });
  unsubscribe();
  assert.equal(guard.request("leave"), true);
  assert.equal(guard.current(), null);
  assert.equal(guard.blocksUnload(), true, "closing the tab still asks the browser");
});

test("unsaved edits: the dialog opens with the step, and confirming discards the dirty forms, then runs the step", () => {
  const { guard, notified } = setup();
  const discarded: string[] = [];
  guard.register({}, { dirty: true, onDiscard: () => discarded.push("a") });
  guard.register({}, { dirty: false, onDiscard: () => discarded.push("b") });
  guard.register({}, { dirty: true, onDiscard: () => discarded.push("c") });
  let stepped = 0;
  assert.equal(guard.request("leave", () => (stepped += 1)), false);
  assert.equal(guard.current()?.kind, "leave");
  assert.equal(notified(), 1, "the dialog hears it");
  assert.equal(stepped, 0, "nothing happens before the answer");

  guard.confirm();
  assert.deepEqual(discarded, ["a", "c"], "only the forms with unsaved edits, as the OK of the old browser box");
  assert.equal(stepped, 1);
  assert.equal(guard.current(), null);
  assert.equal(notified(), 2);
});

test("after the confirmation the step passes without asking again, also for the browser, for 500 ms", () => {
  const { clock, guard } = setup();
  guard.register({}, { dirty: true });
  assert.equal(guard.request("leave", () => undefined), false);
  guard.confirm();
  // The forms still look dirty until React re-renders them: the same link, clicked again, passes.
  assert.equal(guard.request("leave"), true);
  assert.equal(guard.blocksUnload(), false);
  clock.now += LEARNING_LEAVE_GRACE_MS;
  assert.equal(guard.blocksUnload(), true, "the grace period expires even if the step never started");
  assert.equal(guard.request("discard"), false);
});

test("«Resta», Esc or a click outside: nothing is discarded and the step does not run", () => {
  const { guard } = setup();
  let discarded = 0;
  guard.register({}, { dirty: true, onDiscard: () => (discarded += 1) });
  assert.equal(guard.request("continue", () => assert.fail("not called")), false);
  guard.dismiss();
  assert.equal(guard.current(), null);
  assert.equal(discarded, 0);
  assert.equal(guard.request("discard"), false, "the next step asks again");
});

test("a save in progress: the dialog says to wait and closing it changes nothing", () => {
  const { guard } = setup();
  let discarded = 0;
  guard.register({}, { dirty: true, onDiscard: () => (discarded += 1) });
  guard.register({}, { dirty: false, pending: true });
  assert.equal(guard.request("leave", () => assert.fail("not called")), false);
  assert.deepEqual(guard.current(), { kind: "wait" });
  guard.confirm();
  assert.equal(guard.current(), null);
  assert.equal(discarded, 0);
  assert.equal(guard.blocksUnload(), true);
});

test("a caller that repeats its own step («Esci»): after the confirmation the next step passes once; new edits ask again", () => {
  const { clock, guard } = setup();
  // The session boundary of a page whose access must be checked again: hidden edits, nothing to discard.
  const boundary = {};
  guard.register(boundary, { dirty: true });
  assert.equal(guard.request("discard", guard.passNext), false);
  guard.confirm();
  clock.now += LEARNING_LEAVE_GRACE_MS;
  assert.equal(guard.request("discard", guard.passNext), true, "the repeated step passes, without a loop of questions");
  assert.equal(guard.request("discard", guard.passNext), false, "only once");

  guard.confirm();
  clock.now += LEARNING_LEAVE_GRACE_MS;
  guard.register({}, { dirty: true });
  assert.equal(guard.request("leave"), false, "edits made after the confirmation are protected again");
});

test("the last form leaving closes a dialog left open and ends the grace period", () => {
  const { guard } = setup();
  const first = {};
  const second = {};
  guard.register(first, { dirty: true });
  guard.register(second, { dirty: false });
  assert.equal(guard.request("leave"), false);
  guard.unregister(first);
  assert.equal(guard.current()?.kind, "leave", "another form is still there");
  guard.unregister(second);
  assert.equal(guard.current(), null);
  assert.equal(guard.size(), 0);

  guard.register(first, { dirty: true });
  assert.equal(guard.request("leave"), false);
  guard.confirm();
  guard.unregister(first);
  guard.register(first, { dirty: true });
  assert.equal(guard.request("leave"), false, "a form registered later asks again");
});
