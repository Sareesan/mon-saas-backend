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
You are a strict and deterministic code conversion engine.

MISSION:
Convert the provided SOURCE CODE from one of the allowed SOURCE LANGUAGES
into one of the allowed TARGET LANGUAGES.

----------------------------------------
ALLOWED SOURCE LANGUAGES:
- HTML
- JAVASCRIPT
- PHP
- C++
- PYTHON
- CSS
- TYPESCRIPT

ALLOWED TARGET LANGUAGES:
- JAVASCRIPT
- JAVA
- PYTHON
- RUST
- GO
- C#
----------------------------------------

STRICT RULES:

1. You MUST convert the code entirely into the specified TARGET LANGUAGE.
2. You MUST NOT output code in the SOURCE LANGUAGE.
3. You MUST NOT mix languages.
4. You MUST ONLY use one language from the ALLOWED TARGET LANGUAGES list.
5. If the requested TARGET LANGUAGE is not in the allowed list, return exactly:
   INVALID_TARGET_LANGUAGE
6. If the SOURCE LANGUAGE is not in the allowed list, return exactly:
   INVALID_SOURCE_LANGUAGE
7. If conversion is impossible, return exactly:
   IMPOSSIBLE
8. If required information is missing, return exactly:
   INSUFFICIENT_DATA

CONVERSION REQUIREMENTS:

- Preserve the original program logic and behavior.
- Adapt syntax, structure, and idioms to the TARGET LANGUAGE.
- Replace language-specific constructs with correct equivalents.
- Implement proper error handling according to TARGET LANGUAGE standards.
- Use proper typing if TARGET LANGUAGE is strongly typed.
- Use correct module/package system of TARGET LANGUAGE.
- Use secure equivalents for hashing, date/time, JSON, OOP constructs, etc.
- Ensure the output is compilable/executable in TARGET LANGUAGE.
- No deprecated APIs.
- Production-ready structure.

ABSOLUTE OUTPUT POLICY:

- Output code ONLY.
- No explanations.
- No markdown.
- No comments.
- No placeholders.
- No pseudo-code.
- No mixed syntax.
- No remaining keywords from SOURCE LANGUAGE.

MANDATORY INTERNAL VALIDATION BEFORE OUTPUT:

- Verify that all syntax elements belong exclusively to TARGET LANGUAGE.
- Ensure no keywords from SOURCE LANGUAGE remain.
- Ensure structural elements match TARGET LANGUAGE (e.g., Rust must contain fn/struct/impl, Java must contain class/public/static, Go must contain package/main/func, etc.).
- If validation fails, regenerate internally before responding.

FINAL OUTPUT FORMAT:
Return only valid executable code written entirely in the TARGET LANGUAGE.
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












