console.log("BACKEND VERSION SDK GEMINI OK");

/**
 * CodeVision AI - Secure Backend Proxy (Node.js)
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Backend OK");
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Initialize Gemini SDK
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest"
});

/**
 * Check environment variables
 */
function checkEnv() {
    const missing = [];
    if (!process.env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
    if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');

    if (missing.length > 0) {
        console.warn(`[WARNING] Variables d'environnement manquantes : ${missing.join(', ')}`);
    } else {
        console.log(`[INFO] Configuration API complète : Groq et Gemini détectés.`);
    }
}
checkEnv();

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        config: {
            groq: !!process.env.GROQ_API_KEY,
            gemini: !!process.env.GEMINI_API_KEY
        }
    });
});

/**
 * Code Conversion (Groq) - inchangé
 */
app.post('/api/convert', async (req, res) => {
    const { sourceCode, fromLanguage, toLanguage } = req.body;
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        return res.status(503).json({
            error: 'API Groq non configurée (GROQ_API_KEY absente).'
        });
    }

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content:  `
You are a senior software engineer and expert code converter.

Your task is to strictly follow the instructions below.

INPUT:
- Source language declared by the user: {source_language}
- Target language requested by the user: {target_language}
- User code:
{user_code}

PROCESS:

1) Detect the actual programming language of the provided code.

2) Compare the detected language with the user-declared source language.

3) If the detected language DOES NOT match the declared source language:
   Output ONLY the following message and nothing else:
   Error: Detected language is [detected_language] but the declared source language is [source_language]. Please verify the requested language.

4) If the detected language matches the declared source language:
   - Fully analyze the source code.
   - Identify and fix any syntax errors, logical issues, or structural problems.
   - Ensure the corrected version is valid and functional.
   - Convert the corrected code into the requested target language.
   - Adapt syntax, conventions, idioms, and best practices to the target language.
   - Ensure the converted code is clean, optimized, and production-ready.

5) After conversion:
   - Re-analyze the converted code.
   - Fix any remaining errors.
   - Ensure the final output is syntactically correct and executable.

OUTPUT RULES (STRICT):
- If language mismatch → output ONLY the error message.
- If conversion succeeds → output ONLY the final converted code.
- Do NOT include explanations.
- Do NOT include markdown formatting.
- Do NOT include code fences.
- Do NOT include comments unless strictly required for execution.
- Do NOT add any extra text before or after the result.

The final output must be directly executable.
`

                },
                {
                    role: "user",
                    content: sourceCode
                }
            ],
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const convertedCode = response.data.choices[0].message.content.trim();
        res.json({ convertedCode });

    } catch (error) {
        console.error('Groq Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Erreur lors de la conversion via Groq.'
        });
    }
});

/**
 * Vision Endpoint (Gemini SDK version)
 */
app.post('/api/vision', async (req, res) => {
    const { image, mode, targetLanguage, errorCode } = req.body;

    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
            error: 'API Gemini non configurée (GEMINI_API_KEY absente).'
        });
    }

    try {
        const base64Data = image.includes(",") ? image.split(',')[1] : image;

        let prompt = "";

        if (mode === 'correct') {
            prompt = `
Analyze this image of code and fix any bugs.
Target Language: ${targetLanguage || 'Detected from image'}.
${errorCode ? `User error context: ${errorCode}` : ''}

Return:
CODE:
[Corrected code]

NOTES:
• Max 3 short fixes
`;
        } else {
            prompt = `
Generate functional ${targetLanguage || 'HTML/CSS'} code based on this user interface screenshot.
Return ONLY the code. No explanations.
`;
        }

        const result = await geminiModel.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: "image/png",
                    data: base64Data
                }
            }
        ]);

        const fullResponse = result.response.text();

        if (mode === 'correct') {
            const split = fullResponse.split('NOTES:');
            const code = split[0].replace('CODE:', '').trim();
            const notes = split[1] ? split[1].trim() : "Corrections appliquées.";
            res.json({ result: code, notes });
        } else {
            res.json({ result: fullResponse.trim(), notes: "" });
        }

    } catch (error) {
        console.error('Gemini SDK Error:', error);
        res.status(500).json({ error: "Erreur lors de l'analyse via Gemini." });
    }
});

app.listen(PORT, () => {
    console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});













