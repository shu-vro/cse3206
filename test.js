// Self-check for the timing -> word lookup. Run: node test.js
const assert = require("assert");
const { Transcript } = require("./public/app.js");

const t = new Transcript(null, () => {});
t.words = [
    { text: "Hello", start: 0.0625, end: 0.3625 },
    { text: "there", start: 0.375, end: 0.7375 },
    { text: "friend", start: 1.125, end: 1.5 },
];

assert.strictEqual(t.indexAt(0), -1, "before first word");
assert.strictEqual(t.indexAt(0.0625), 0, "exactly at word start");
assert.strictEqual(t.indexAt(0.3), 0);
assert.strictEqual(t.indexAt(0.9), 1, "gap holds previous word");
assert.strictEqual(t.indexAt(99), 2, "past the end");
assert.strictEqual(t.startTime(2), 1.125);
console.log("ok");
