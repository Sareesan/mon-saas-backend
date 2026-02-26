require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const morgan = require("morgan");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARE
========================= */

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {
  res.json({ message: "CodeVision AI Backend running 🚀" });
});

/* =========================
   CONVERT CODE (GROQ)
========================= */

app.post("/api/convert", async (req, res) => {
  try {
    const { sourceCode, fromLanguage, toLanguage } = req.body;

    if (!sourceCode || !fromLanguage || !toLanguage) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    console.log("[CONVERT] Request received");

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          {
            role: "system",
            content: "You are a professional code conversion assistant."
          },
          {
            role: "user",
            content: `Convert this ${fromLanguage} code to ${toLanguage}:\n\n${sourceCode}`
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const convertedCode = response.data.choices[0].message.content;

    res.json({ result: convertedCode });

  } catch (error) {
    console.error("❌ Convert error:", error.response?.data || error.message);
    res.status(500).json({ error: "Conversion failed" });
  }
});

/* =========================
   AUDIT CODE (GROQ LLAMA)
========================= */

app.post("/api/audit", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    console.log("[AUDIT] Request received");

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          {
            role: "system",
            content: "You are a senior software security auditor."
          },
          {
            role: "user",
            content: `Audit this code and list issues, improvements, and security risks:\n\n${code}`
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const auditResult = response.data.choices[0].message.content;

    res.json({ result: auditResult });

  } catch (error) {
    console.error("❌ Audit error:", error.response?.data || error.message);
    res.status(500).json({ error: "Audit failed" });
  }
});

/* =========================
   REFACTOR CODE (HUGGING FACE)
========================= */

app.post("/api/refactor", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    console.log("[REFACTOR] Request received");

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/bigcode/starcoder",
      {
        inputs: `Refactor this code for clarity and performance:\n\n${code}`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const refactoredCode = response.data[0]?.generated_text || "No refactor result.";

    res.json({ result: refactoredCode });

  } catch (error) {
    console.error("❌ Refactor error:", error.response?.data || error.message);
    res.status(500).json({ error: "Refactor failed" });
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
