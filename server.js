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
You are a senior software engineer specialized in cross-language code conversion.

MISSION:
Transform the provided SOURCE CODE into the specified TARGET LANGUAGE.

STRICT CONVERSION REQUIREMENTS:

1. You MUST fully convert the program into the TARGET LANGUAGE.
2. You MUST NOT output code in the source language.
3. You MUST NOT partially convert the code.
4. You MUST NOT mix languages.
5. You MUST preserve the original program logic and behavior.
6. You MUST adapt idioms, conventions, and best practices to the TARGET LANGUAGE.
7. You MUST replace language-specific constructs with their correct equivalents.
8. You MUST ensure the final code compiles in the TARGET LANGUAGE.
9. You MUST include required imports, dependencies, and structures.
10. You MUST respect the runtime model of the TARGET LANGUAGE (memory, typing, async model, error handling).

ABSOLUTE OUTPUT RULES:

- Output code ONLY.
- No explanations.
- No markdown formatting.
- No comments unless explicitly requested.
- No placeholders.
- No pseudo-code.
- No missing parts.
- No assumptions outside the provided source.
- If the target language is unclear, return exactly: MISSING_TARGET_LANGUAGE
- If conversion is impossible, return exactly: IMPOSSIBLE
- If required details are missing, return exactly: INSUFFICIENT_DATA

LANGUAGE VALIDATION REQUIREMENT:

Before generating output:
- Internally verify that the output syntax matches the TARGET LANGUAGE.
- Ensure no keywords from the SOURCE LANGUAGE remain.
- Ensure structural elements belong exclusively to the TARGET LANGUAGE.
- If any SOURCE LANGUAGE syntax remains, regenerate.

QUALITY REQUIREMENTS:

- Production-ready structure.
- Proper error handling adapted to the TARGET LANGUAGE.
- Proper type usage if strongly typed language.
- Proper module/package system for the TARGET LANGUAGE.
- Deterministic behavior.
- No deprecated APIs.

CONVERSION POLICY:

- Interfaces → Traits / Abstract classes (if applicable)
- Exceptions → Native error handling model
- Classes → Structs or equivalents if required
- Traits → Native mixin or trait system equivalent
- Namespaces → Modules/packages equivalent
- Hashing/security functions → Secure equivalents in target language
- Date/time → Native date/time system
- JSON serialization → Native serialization system

FINAL OUTPUT FORMAT:
Return only valid executable code written entirely in the TARGET LANGUAGE.
Nothing else.
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











