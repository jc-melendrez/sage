const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");
const path = require("path");

// Deliberately the real, deployable rules file. If this drifts from what gets
// deployed, these tests stop meaning anything.
const RULES = fs.readFileSync(path.join(__dirname, "firestore.rules"), "utf8");

const ROOM = "GAME1";
const roomDoc = `gameRooms/${ROOM}`;

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "sage-rules-test",
    firestore: { rules: RULES, host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed via withSecurityRulesDisabled, which is the emulator's equivalent of
  // the Admin SDK path Django uses -- rules do not apply.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(roomDoc).set({
      hostId: "host-1",
      status: "active",
      questions: [{ id: "q1" }],
      maxTeamSize: 10,
    });
    await db.doc(`${roomDoc}/players/42`).set({
      userId: "42",
      name: "Ana",
      score: 10,
      teamId: "red",
    });
    await db.doc(`${roomDoc}/answers/0`).set({ counts: { "1": 3 } });
    await db.doc(`${roomDoc}/reactions/0_42`).set({ emoji: "🔥", userId: "42" });
  });
});

const authed = (uid, claims = {}) =>
  testEnv.authenticatedContext(uid, claims).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

describe("regression: room document is server-owned", () => {
  // Django owns the room document (create/join/start/answer/finish) via the
  // Admin SDK, which bypasses rules. These assert no client can reach it.
  it("denies a non-host student updating the room document", async () => {
    const db = authed("student-uid");
    await assertFails(
      db.doc(roomDoc).update({ questions: [{ id: "hijacked" }] })
    );
  });

  it("denies a non-host student overwriting the whole room document", async () => {
    const db = authed("student-uid");
    await assertFails(
      db.doc(roomDoc).set({ hostId: "student-uid", status: "finished" })
    );
  });

  it("denies a non-host flipping room status", async () => {
    const db = authed("student-uid");
    await assertFails(db.doc(roomDoc).update({ status: "finished" }));
  });

  it("denies stealing hostId", async () => {
    const db = authed("student-uid");
    await assertFails(db.doc(roomDoc).update({ hostId: "student-uid" }));
  });

  it("denies deleting the room", async () => {
    const db = authed("student-uid");
    await assertFails(db.doc(roomDoc).delete());
  });

  it("denies creating a room from the client (Django owns creation)", async () => {
    const db = authed("student-uid");
    await assertFails(db.doc("gameRooms/NEWROOM").set({ hostId: "student-uid" }));
  });
});

describe("the app still works: reads stay allowed", () => {
  it("allows any signed-in player to read the room they were invited to", async () => {
    const db = authed("student-uid");
    await assertSucceeds(db.doc(roomDoc).get());
  });

  it("still denies unauthenticated reads", async () => {
    await assertFails(anon().doc(roomDoc).get());
  });

  it("allows reading the player roster", async () => {
    const db = authed("student-uid");
    await assertSucceeds(db.doc(`${roomDoc}/players/42`).get());
  });

  it("allows reading the answer distribution (final screen)", async () => {
    const db = authed("student-uid");
    await assertSucceeds(db.doc(`${roomDoc}/answers/0`).get());
  });
});

describe("the app still works: client subcollection writes", () => {
  it("allows lobby.tsx to write teamId onto a player doc", async () => {
    const db = authed("student-uid");
    await assertSucceeds(
      db.doc(`${roomDoc}/players/42`).update({ teamId: "blue" })
    );
  });

  it("allows reading reactions", async () => {
    const db = authed("student-uid");
    await assertSucceeds(db.doc(`${roomDoc}/reactions/0_42`).get());
  });
});

describe("server-owned subcollections", () => {
  it("denies clients writing the answer distribution", async () => {
    const db = authed("student-uid");
    await assertFails(
      db.doc(`${roomDoc}/answers/1`).set({ counts: { "0": 999 } })
    );
  });

  it("denies clients rewriting an existing answer distribution", async () => {
    const db = authed("student-uid");
    await assertFails(
      db.doc(`${roomDoc}/answers/0`).update({ counts: { "1": 9999 } })
    );
  });
});

describe("unrelated rules are untouched", () => {
  it("still scopes user profiles to the owner", async () => {
    const db = authed("uid-a");
    await assertSucceeds(db.doc("users/uid-a").get());
    await assertFails(db.doc("users/uid-b").get());
  });
});

// Known-broken, documented rather than silently fixed: these blocks still
// reference `request.auth.token.schoolId`, which no longer exists in any token.
// The engine errors on the missing property, so the rule denies everything.
// That is why studyGroups reads and quizzes reads are currently broken.
// The game room was fixed; these were out of scope for that change.
describe("KNOWN GAP: blocks still referencing the removed schoolId claim", () => {
  it("documents that a studyGroups read is currently denied for everyone", async () => {
    const db = authed("uid-a");
    await assertFails(db.doc("studyGroups/g1").get());
  });

  it("documents that a quizzes read is currently denied for everyone", async () => {
    const db = authed("uid-a");
    await assertFails(db.doc("quizzes/q1").get());
  });
});
