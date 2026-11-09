import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/notification-fixture.mjs";

const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=";

test("team icons persist, are visible to teammates, and can only be edited by their owner", async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.call("unknown", "/team-profiles")).status, 401);
  assert.equal((await f.call("sync", "/team-profiles")).status, 403);
  const input = { userId: "jordyn", mode: "photo", photo, revision: 0 };
  assert.equal((await f.call("rayne", "/team-profiles", input, "PUT")).status, 403);
  const saved = await f.call("jordyn", "/team-profiles", input, "PUT");
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1);
  assert.deepEqual((await f.call("rayne", "/team-profiles")).data.profiles, [saved.data]);
  const initial = await f.call("jordyn", "/team-profiles", { ...input, revision: 1, mode: "initial" }, "PUT");
  assert.equal(initial.status, 200);
  assert.equal((await f.call("rayne", "/team-profiles")).data.profiles[0].photo, null, "an inactive photo is not sent to teammates");
  assert.equal((await f.call("jordyn", "/team-profiles")).data.profiles[0].photo, photo, "the owner can choose their saved photo again");
});

test("stale devices cannot overwrite a newer profile and invalid photos leave saved data unchanged", async t => {
  const f = await fixture(); t.after(f.close);
  const input = { mode: "photo", photo, revision: 0 };
  assert.equal((await f.call("amia", "/team-profiles", input, "PUT")).status, 200);
  assert.equal((await f.call("amia", "/team-profiles", input, "PUT")).status, 409);
  for (const invalid of ["https://example.invalid/photo.jpg", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,SGVsbG8=", "data:image/png;base64," + "A".repeat(100000), null]) {
    assert.equal((await f.call("amia", "/team-profiles", { ...input, photo: invalid, revision: 1 }, "PUT")).status, 400);
  }
  const current = (await f.call("amia", "/team-profiles")).data.profiles[0];
  assert.equal(current.photo, photo); assert.equal(current.revision, 1);
});
