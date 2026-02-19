console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Secure Backend Proxy (Node.js)
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');

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
 * Check environment variables
 */
function checkEnv() {
    const missing = [];
    if (!process.env.GROQ_API_KEY) missing.push('GROQ_API_KEY');

    if (missing.length > 0) {
        console.warn(`[WARNING] Variables d'environnement manquantes : ${missing.join(', ')}`);
    } else {
        console.log(`[INFO] Configuration API complète : Groq détecté.`);
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
            groq: !!process.env.GROQ_API_KEY
        }
    });
});

/**
 * Code Conversion (Groq) - inchangé
 */
ute la route /api/audit :

app.post('/api/audit', async (req, res) => {
    const { owner, repo } = req.body;
    const token = process.env.GITHUB_PAT;

    try {
        const response = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/code-scanning/alerts`,
            {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github+json"
                }
            }
        );
        res.json(response.data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/convert', async (req, res) => {
    const { sourceCode, fromLanguage, toLanguage } = req.body;
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        return res.status(503).json({
            error: 'API Groq non configurée (GROQ_API_KEY absente).'
        });
    }

    try {
        // Prompt dynamique pour Groq
        const prompt = `
Convert the following code from ${fromLanguage || 'any language'} to the target language.
Do not add explanations. Return only the converted code.

Target language: ${toLanguage}
Code to convert:
${sourceCode}
`;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: prompt }
                ],
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

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
 * Le serveur écoute
 */
app.listen(PORT, () => {
    console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});


















