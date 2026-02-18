console.log("BACKEND VERSION TEST 123");
/**
 * CodeVision AI - Secure Backend Proxy (Node.js)
 * Strict Zero Hardcoding Policy - All secrets from process.env
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const app = express();
app.get("/", (req, res) => {
  res.send("Backend OK");
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Security Check: Ensure required environment variables are present
 * This prevents the server from crashing later during an API call.
 */
function checkEnv() {
    const missing = [];
    if (!process.env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
    if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');

    if (missing.length > 0) {
        console.warn(`[WARNING] Variables d'environnement manquantes : ${missing.join(', ')}`);
        console.warn(`[WARNING] Le site fonctionnera en mode limité jusqu'à configuration effectuée.`);
    } else {
        console.log(`[INFO] Configuration API complète : Groq et Gemini détectés.`);
    }
}

checkEnv();

// Health check
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
 * Endpoint for Code Conversion (Groq)
 * Uses process.env.GROQ_API_KEY
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
                    content: `You are an expert code converter. Convert the following code from ${fromLanguage} to ${toLanguage}. 
                             Provide ONLY the converted code without any explanation or markdown backticks.`
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
 * Endpoint for Image Intelligence (Gemini)
 * Uses process.env.GEMINI_API_KEY
 */
app.post('/api/vision', async (req, res) => {
    const { image, mode, targetLanguage, errorCode } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(503).json({
            error: 'API Gemini non configurée (GEMINI_API_KEY absente).'
        });
    }

    try {
        const base64Data = image.split(',')[1] || image;

        let prompt = "";
        if (mode === 'correct') {
            prompt = `Analyze this image of code and fix any bugs. 
                     Target Language: ${targetLanguage || 'Detected from image'}.
                     ${errorCode ? `Context of error from user: ${errorCode}` : ''}
                     Provide the corrected code FIRST, followed by a short list of what was fixed (max 3 points).
                     Format your response as:
                     CODE:
                     [The code]
                     NOTES:
                     • [Correction 1]
                     • [Correction 2]`;
        } else {
            prompt = `Generate functional ${targetLanguage || 'HTML/CSS'} code based on this user interface screenshot.
                     Provide ONLY the code. No explanations.`;
        }

        const response = await axios.post(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: "image/png",
                            data: base64Data
                        }
                    }
                ]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
        });

        const fullResponse = response.data.candidates[0].content.parts[0].text;

        if (mode === 'correct') {
            const split = fullResponse.split('NOTES:');
            const code = split[0].replace('CODE:', '').trim();
            const notes = split[1] ? split[1].trim() : "Bugs corrigés selon l'image.";
            res.json({ result: code, notes: notes });
        } else {
            res.json({ result: fullResponse.trim(), notes: "" });
        }

    } catch (error) {
        console.error('Gemini Error:', error.response?.data || error.message);
        res.status(500).json({ error: "Erreur lors de l'analyse via Gemini." });
    }
});

app.listen(PORT, () => {
    console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});



