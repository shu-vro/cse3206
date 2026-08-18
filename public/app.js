"use strict";

/* ------------------------------------------------------------------ *
 * Strategy — how the transcript decides which words to mark.
 * ------------------------------------------------------------------ */

/** Interface: given a word index, return the CSS class it should carry. */
class HighlightStrategy {
    /** @returns {"active"|"spoken"|null} */
    classFor(index, activeIndex, words) {
        return null;
    }
}

/** Current word highlighted, everything before it dimmed. */
class WordHighlight extends HighlightStrategy {
    classFor(index, activeIndex) {
        if (index === activeIndex) return "active";
        return index < activeIndex ? "spoken" : null;
    }
}

/** Only the current word is marked; no trail behind it. */
class KaraokeHighlight extends HighlightStrategy {
    classFor(index, activeIndex) {
        return index === activeIndex ? "active" : null;
    }
}

/** The whole sentence around the current word is highlighted. */
class SentenceHighlight extends HighlightStrategy {
    // ponytail: Edge word boundaries drop punctuation, so a sentence break is
    // inferred from the silence between words. Use real punctuation if the
    // backend ever reports it.
    static GAP = 0.25;

    classFor(index, activeIndex, words) {
        if (activeIndex < 0) return null;
        const breaksAfter = (i) => i >= words.length - 1 || words[i + 1].start - words[i].end > SentenceHighlight.GAP;

        let start = activeIndex;
        while (start > 0 && !breaksAfter(start - 1)) start--;
        let end = activeIndex;
        while (!breaksAfter(end)) end++;

        if (index >= start && index <= end) return "active";
        return index < start ? "spoken" : null;
    }
}

/** Name -> strategy, for the picker in the UI. */
const HIGHLIGHTS = {
    word: () => new WordHighlight(),
    karaoke: () => new KaraokeHighlight(),
    sentence: () => new SentenceHighlight(),
};

/* ------------------------------------------------------------------ *
 * State — what the player does depends on where it is in its lifecycle.
 * ------------------------------------------------------------------ */

class PlayerState {
    constructor(player) {
        this.player = player;
    }
    /** Label the play/pause button should show in this state. */
    get label() {
        return "Play";
    }
    /** Whether the button is usable in this state. */
    get enabled() {
        return true;
    }
    toggle() {}
    seek(seconds) {
        this.player.audio.currentTime = seconds;
    }
}

/** Nothing generated yet: no playback, no seeking. */
class IdleState extends PlayerState {
    get enabled() {
        return false;
    }
    seek() {}
}

/** Audio loaded and stopped. */
class PausedState extends PlayerState {
    toggle() {
        this.player.audio.play(); // -> PlayingState
    }
    seek(seconds) {
        super.seek(seconds);
        this.player.audio.play(); // clicking a word resumes from there
    }
}

/** Audio running. */
class PlayingState extends PlayerState {
    get label() {
        return "Pause";
    }
    toggle() {
        this.player.audio.pause(); // -> PausedState
    }
}

/** Reached the end: pressing play starts over. */
class EndedState extends PausedState {
    toggle() {
        this.player.audio.currentTime = 0;
        this.player.audio.play();
    }
}

/* ------------------------------------------------------------------ *
 * Collaborators
 * ------------------------------------------------------------------ */

/** Talks to the Express backend. */
class TTSClient {
    constructor(endpoint = "/api/tts") {
        this.endpoint = endpoint;
    }

    /** @returns {Promise<{audio: string, words: Array}>} */
    async synthesize(text, voice) {
        const res = await fetch(this.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "synthesis failed");
        return data;
    }
}

/** Renders the words and keeps the highlight in sync with a time. */
class Transcript {
    constructor(container, onWordClick, strategy = new WordHighlight()) {
        this.container = container;
        this.onWordClick = onWordClick;
        this.strategy = strategy;
        this.words = [];
        this.spans = [];
        this.activeIndex = -1;
    }

    setStrategy(strategy) {
        this.strategy = strategy;
        this.repaint(this.activeIndex);
    }

    render(words) {
        this.words = words;
        this.activeIndex = -1;
        this.container.textContent = "";
        this.spans = words.map((word, i) => {
            const span = document.createElement("span");
            span.textContent = word.text;
            span.addEventListener("click", () => this.onWordClick(i, word));
            this.container.append(span, " ");
            return span;
        });
    }

    /** Index of the word being spoken at `time` (last word that already started). */
    indexAt(time) {
        let index = -1;
        for (let i = 0; i < this.words.length; i++) {
            if (this.words[i].start > time) break;
            index = i;
        }
        return index;
    }

    highlightAt(time) {
        const index = this.indexAt(time);
        if (index === this.activeIndex) return;
        this.activeIndex = index;
        this.repaint(index);
        this.spans[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    /** Applies the current strategy to every span. */
    repaint(index) {
        this.spans.forEach((span, i) => {
            const cls = this.strategy.classFor(i, index, this.words);
            span.classList.toggle("active", cls === "active");
            span.classList.toggle("spoken", cls === "spoken");
        });
    }

    startTime(index) {
        return this.words[index].start;
    }
}

/** Wraps an <audio> element; delegates behaviour to its current state. */
class Player {
    constructor(onTick, onStateChange) {
        this.audio = new Audio();
        this.onTick = onTick;
        this.onStateChange = onStateChange;
        this.frame = null;
        this.setState(new IdleState(this));

        this.audio.addEventListener("play", () => {
            this.setState(new PlayingState(this));
            this.#loop();
        });
        this.audio.addEventListener("pause", () => {
            this.setState(new PausedState(this));
            this.onTick(this.audio.currentTime);
        });
        this.audio.addEventListener("ended", () => {
            this.setState(new EndedState(this));
            this.onTick(this.audio.currentTime);
        });
    }

    setState(state) {
        this.state = state;
        this.onStateChange(state);
    }

    load(base64Mp3) {
        this.audio.src = "data:audio/mpeg;base64," + base64Mp3;
        this.setState(new PausedState(this));
    }

    toggle() {
        this.state.toggle();
    }

    seek(seconds) {
        this.state.seek(seconds);
        this.onTick(seconds);
    }

    #loop() {
        if (this.audio.paused) return;
        this.onTick(this.audio.currentTime);
        this.frame = requestAnimationFrame(() => this.#loop());
    }
}

/* ------------------------------------------------------------------ *
 * Facade — one small door in front of client + transcript + player.
 * ------------------------------------------------------------------ */

/**
 * Hides the three-object dance (synthesize -> render -> load -> tick) behind
 * four methods. Callers never touch TTSClient, Transcript or Player directly.
 */
class ReaderFacade {
    constructor(container, { onStatus, onPlayerState }) {
        this.onStatus = onStatus;
        this.client = new TTSClient();
        this.transcript = new Transcript(container, (i) => this.jumpToWord(i));
        this.player = new Player((time) => this.transcript.highlightAt(time), onPlayerState);
    }

    /** Synthesize `text`, show it, and arm the player. */
    async read(text, voice) {
        this.onStatus("Generating…");
        const { audio, words } = await this.client.synthesize(text, voice);
        this.transcript.render(words);
        this.player.load(audio);
        this.onStatus(`${words.length} words ready`);
    }

    toggle() {
        this.player.toggle();
    }

    jumpToWord(index) {
        this.player.seek(this.transcript.startTime(index));
    }

    setHighlight(name) {
        this.transcript.setStrategy(HIGHLIGHTS[name]());
    }
}

/* ------------------------------------------------------------------ *
 * DOM wiring
 * ------------------------------------------------------------------ */

class App {
    constructor() {
        this.textEl = document.getElementById("text");
        this.voiceEl = document.getElementById("voice");
        this.highlightEl = document.getElementById("highlight");
        this.generateEl = document.getElementById("generate");
        this.playPauseEl = document.getElementById("playPause");
        this.statusEl = document.getElementById("status");

        this.reader = new ReaderFacade(document.getElementById("transcript"), {
            onStatus: (text) => (this.statusEl.textContent = text),
            onPlayerState: (state) => {
                this.playPauseEl.textContent = state.label;
                this.playPauseEl.disabled = !state.enabled;
            },
        });

        this.generateEl.addEventListener("click", () => this.generate());
        this.playPauseEl.addEventListener("click", () => this.reader.toggle());
        this.highlightEl.addEventListener("change", () => this.reader.setHighlight(this.highlightEl.value));
    }

    async generate() {
        const text = this.textEl.value.trim();
        if (!text) return;
        this.generateEl.disabled = true;
        try {
            await this.reader.read(text, this.voiceEl.value);
        } catch (err) {
            this.statusEl.textContent = err.message;
        } finally {
            this.generateEl.disabled = false;
        }
    }
}

if (typeof document !== "undefined") new App();
if (typeof module !== "undefined")
    module.exports = {
        HighlightStrategy,
        WordHighlight,
        KaraokeHighlight,
        SentenceHighlight,
        HIGHLIGHTS,
        PlayerState,
        IdleState,
        PausedState,
        PlayingState,
        EndedState,
        TTSClient,
        Transcript,
        Player,
        ReaderFacade,
        App,
    };
