const express = require("express");
const { Communicate } = require("edge-tts-universal");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.post("/api/tts", async (req, res) => {
  const text = String(req.body.text || "").trim();
  const voice = req.body.voice || "en-US-EmmaMultilingualNeural";
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const chunks = [];
    const words = [];
    for await (const chunk of new Communicate(text, { voice }).stream()) {
      if (chunk.type === "audio" && chunk.data) {
        chunks.push(chunk.data);
      } else if (chunk.type === "WordBoundary") {
        words.push({
          text: chunk.text,
          start: chunk.offset / 1e7, // 100ns units -> seconds
          end: (chunk.offset + chunk.duration) / 1e7,
        });
      }
    }
    res.json({ audio: Buffer.concat(chunks).toString("base64"), words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));
