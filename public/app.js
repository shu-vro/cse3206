"use strict";

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
  constructor(container, onWordClick) {
    this.container = container;
    this.onWordClick = onWordClick;
    this.words = [];
    this.spans = [];
    this.activeIndex = -1;
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
    this.spans.forEach((span, i) => {
      span.classList.toggle("active", i === index);
      span.classList.toggle("spoken", i < index);
    });
    this.spans[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  startTime(index) {
    return this.words[index].start;
  }
}

/** Wraps an <audio> element and drives a per-frame time callback. */
class Player {
  constructor(onTick) {
    this.audio = new Audio();
    this.onTick = onTick;
    this.frame = null;
    this.audio.addEventListener("play", () => this.#loop());
    this.audio.addEventListener("pause", () => this.#stopLoop());
    this.audio.addEventListener("ended", () => this.#stopLoop());
  }

  load(base64Mp3) {
    this.audio.src = "data:audio/mpeg;base64," + base64Mp3;
  }

  toggle() {
    this.audio.paused ? this.audio.play() : this.audio.pause();
  }

  seek(seconds, autoplay = true) {
    this.audio.currentTime = seconds;
    if (autoplay && this.audio.paused) this.audio.play();
    this.onTick(seconds);
  }

  get isPlaying() {
    return !this.audio.paused;
  }

  #loop() {
    this.onTick(this.audio.currentTime);
    this.frame = requestAnimationFrame(() => this.#loop());
  }

  #stopLoop() {
    cancelAnimationFrame(this.frame);
    this.onTick(this.audio.currentTime);
  }
}

/** Wires the DOM to the client, transcript and player. */
class App {
  constructor() {
    this.client = new TTSClient();
    this.player = new Player((time) => this.#onTick(time));
    this.transcript = new Transcript(
      document.getElementById("transcript"),
      (i) => this.player.seek(this.transcript.startTime(i))
    );
    this.textEl = document.getElementById("text");
    this.voiceEl = document.getElementById("voice");
    this.generateEl = document.getElementById("generate");
    this.playPauseEl = document.getElementById("playPause");
    this.statusEl = document.getElementById("status");

    this.generateEl.addEventListener("click", () => this.generate());
    this.playPauseEl.addEventListener("click", () => this.player.toggle());
    this.player.audio.addEventListener("play", () => this.#syncButton());
    this.player.audio.addEventListener("pause", () => this.#syncButton());
  }

  async generate() {
    const text = this.textEl.value.trim();
    if (!text) return;
    this.generateEl.disabled = true;
    this.statusEl.textContent = "Generating…";
    try {
      const { audio, words } = await this.client.synthesize(
        text,
        this.voiceEl.value
      );
      this.transcript.render(words);
      this.player.load(audio);
      this.playPauseEl.disabled = false;
      this.statusEl.textContent = `${words.length} words ready`;
    } catch (err) {
      this.statusEl.textContent = err.message;
    } finally {
      this.generateEl.disabled = false;
    }
  }

  #onTick(time) {
    this.transcript.highlightAt(time);
  }

  #syncButton() {
    this.playPauseEl.textContent = this.player.isPlaying ? "Pause" : "Play";
  }
}

if (typeof document !== "undefined") new App();
if (typeof module !== "undefined")
  module.exports = { TTSClient, Transcript, Player, App };
