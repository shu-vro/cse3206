// Self-checks for the pure logic: time -> word lookup and the highlight
// strategies. Run: node test.js
const assert = require("assert");
const {
    Transcript,
    WordHighlight,
    KaraokeHighlight,
    SentenceHighlight,
    IdleState,
    PausedState,
    PlayingState,
    EndedState,
} = require("./public/app.js");

// Two sentences: a 0.39s silence separates "there" from "This".
const words = [
    { text: "Hello", start: 0.0625, end: 0.3625 },
    { text: "there", start: 0.375, end: 0.7375 },
    { text: "This", start: 1.125, end: 1.3125 },
    { text: "is", start: 1.325, end: 1.4625 },
    { text: "test", start: 1.475, end: 2.1375 },
];

// --- Transcript.indexAt -------------------------------------------------
const t = new Transcript(null, () => {});
t.words = words;
assert.strictEqual(t.indexAt(0), -1, "before first word");
assert.strictEqual(t.indexAt(0.0625), 0, "exactly at word start");
assert.strictEqual(t.indexAt(0.3), 0);
assert.strictEqual(t.indexAt(0.9), 1, "gap holds previous word");
assert.strictEqual(t.indexAt(99), 4, "past the end");
assert.strictEqual(t.startTime(2), 1.125);

// --- Strategy -----------------------------------------------------------
const classes = (strategy, active) => words.map((_, i) => strategy.classFor(i, active, words));

assert.deepStrictEqual(classes(new WordHighlight(), 2), ["spoken", "spoken", "active", null, null]);
assert.deepStrictEqual(classes(new KaraokeHighlight(), 2), [null, null, "active", null, null]);
assert.deepStrictEqual(
    classes(new SentenceHighlight(), 3),
    ["spoken", "spoken", "active", "active", "active"],
    "whole second sentence lights up"
);
assert.deepStrictEqual(
    classes(new SentenceHighlight(), 0),
    ["active", "active", null, null, null],
    "first sentence, nothing spoken yet"
);
assert.deepStrictEqual(classes(new SentenceHighlight(), -1), [null, null, null, null, null]);

// --- State --------------------------------------------------------------
const fake = () => {
    const player = { audio: { currentTime: 0, playing: false } };
    player.audio.play = () => (player.audio.playing = true);
    player.audio.pause = () => (player.audio.playing = false);
    return player;
};

let p = fake();
const idle = new IdleState(p);
assert.strictEqual(idle.enabled, false, "cannot press play before audio exists");
idle.seek(1.5);
assert.strictEqual(p.audio.currentTime, 0, "idle ignores word clicks");

p = fake();
new PausedState(p).toggle();
assert.strictEqual(p.audio.playing, true, "paused -> playing");
assert.strictEqual(new PausedState(p).label, "Play");

p = fake();
p.audio.playing = true;
new PlayingState(p).toggle();
assert.strictEqual(p.audio.playing, false, "playing -> paused");
assert.strictEqual(new PlayingState(p).label, "Pause");

p = fake();
p.audio.currentTime = 9;
new EndedState(p).toggle();
assert.deepStrictEqual([p.audio.currentTime, p.audio.playing], [0, true], "ended restarts from zero");

p = fake();
new PausedState(p).seek(1.5);
assert.deepStrictEqual([p.audio.currentTime, p.audio.playing], [1.5, true], "word click seeks and plays");

console.log("ok");
