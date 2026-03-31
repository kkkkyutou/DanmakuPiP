const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");

test("clampNumber works with boundaries and fallback", () => {
  assert.equal(core.clampNumber(10, 1, 20, 5), 10);
  assert.equal(core.clampNumber(50, 1, 20, 5), 20);
  assert.equal(core.clampNumber(-1, 1, 20, 5), 1);
  assert.equal(core.clampNumber("bad", 1, 20, 5), 5);
});

test("findMatchingBracket handles quoted strings", () => {
  const text = 'aaa[{"a":"x]y"}, {"b":2}]bbb';
  const start = text.indexOf("[");
  const end = core.findMatchingBracket(text, start);
  assert.equal(text.slice(start, end + 1), '[{"a":"x]y"}, {"b":2}]');
});

test("extractCaptionTracksFromHtml parses captionTracks list", () => {
  const html =
    '<script>var x={"captionTracks":[{"vssId":".en","baseUrl":"https://x.test?a=1"}],"other":1};</script>';
  const tracks = core.extractCaptionTracksFromHtml(html);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].vssId, ".en");
});

test("normalizeEvents sorts and de-duplicates near identical payload", () => {
  const events = core.normalizeEvents(
    [
      { id: "2", t: 1.01, text: "hello", mode: "scroll" },
      { id: "1", t: 1.0, text: "hello", mode: "scroll" },
      { id: "3", t: 2.0, text: "world", mode: "top" }
    ],
    "youtube"
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].text, "hello");
  assert.equal(events[1].text, "world");
});

test("isBlocked uses case-insensitive match", () => {
  assert.equal(core.isBlocked("这个是剧透内容", ["剧透"]), true);
  assert.equal(core.isBlocked("Spoiler alert", ["spoiler"]), true);
  assert.equal(core.isBlocked("普通内容", ["剧透"]), false);
});
