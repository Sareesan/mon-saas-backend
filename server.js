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

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Vérification des variables d'environnement
 */
if (!process.env.GROQ_API_KEY) {
    console.warn('[WARNING] GROQ_API_KEY manquante !');
} else {
    console.log('[INFO] GROQ_API_KEY détectée');
}

/**
 * Route racine pour test rapide
 */
app.get("/", (req, res) => {
    res.send("Backend OK");
});

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
 * Audit intelligent de code (GROQ / Llama-3)
 * Reçoit le code collé par l'utilisateur
 */
app.post('/api/audit', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Code obligatoire pour l’audit' });
    }

    try {
        const prompt = `
You are a security and code quality auditor AI.
Analyze the following code for security vulnerabilities, bad practices, and code quality issues.
Return ONLY a valid JSON array of findings with these keys:
- severity (low, medium, high)
- title
- description
- file (if applicable)
- line (if applicable)

DO NOT include any explanations, text, or Markdown outside the JSON.
Code to analyze:
${code}
`;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: prompt }],
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        let findingsText = response.data.choices[0].message.content.trim();

        // Nettoyage des backticks ``` et "json"
        findingsText = findingsText.replace(/^```json\s*/, '').replace(/```$/g, '');

        // Supprimer les titres Markdown (#, ##, ###)
        findingsText = findingsText.replace(/^#+\s.*$/gm, '').trim();

        // Parser JSON avec sécurité
        let findings;
        try {
            findings = JSON.parse(findingsText);
        } catch (parseErr) {
            console.error('JSON parse failed:', parseErr.message);
            console.error('Raw response:', findingsText);
            return res.status(500).json({
                error: 'Impossible de parser la réponse de l’audit en JSON',
                raw: findingsText
            });
        }

        res.json({ findings });

    } catch (error) {
        console.error('Audit Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Erreur lors de l’audit du code.'
        });
    }
});

/**
 * Code Conversion (Groq)
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
 * Démarrage du serveur
 */
app.listen(PORT, () => {
    console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});




















