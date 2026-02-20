console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Secure Backend Proxy (Node.js)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const { GoogleAuth } = require('google-auth-library'); // pour Gemini

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Vérification des variables d'environnement
 */
if (!process.env.GROQ_API_KEY) console.warn('[WARNING] GROQ_API_KEY manquante !');
else console.log('[INFO] GROQ_API_KEY détectée');

if (!process.env.GEMINI_API_KEY) console.warn('[WARNING] GEMINI_API_KEY manquante ! Mode DEMO activé');
else console.log('[INFO] GEMINI_API_KEY détectée');

/**
 * Route racine
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
            groq: !!process.env.GROQ_API_KEY,
            gemini: !!process.env.GEMINI_API_KEY
        }
    });
});

/**
 * Audit intelligent (GROQ / Llama-3)
 */
app.post('/api/audit', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code obligatoire pour l’audit' });

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
            { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        let findingsText = response.data.choices[0].message.content.trim();
        findingsText = findingsText.replace(/^```json\s*/, '').replace(/```$/g, '').replace(/^#+\s.*$/gm, '').trim();

        let findings;
        try { findings = JSON.parse(findingsText); }
        catch (parseErr) {
            console.error('[Audit JSON parse failed]', parseErr.message);
            console.error('[Raw response]', findingsText);
            return res.status(500).json({ error: 'Impossible de parser la réponse de l’audit', raw: findingsText });
        }

        res.json({ findings });

    } catch (error) {
        console.error('[Audit Error]', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ error: 'Erreur lors de l’audit du code.' });
    }
});

/**
 * Conversion de code (GROQ)
 */
app.post('/api/convert', async (req, res) => {
    const { sourceCode, fromLanguage, toLanguage } = req.body;
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'API Groq non configurée.' });

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
            { model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: prompt }], temperature: 0.1 },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        const convertedCode = response.data.choices[0].message.content.trim();
        res.json({ convertedCode });

    } catch (error) {
        console.error('[Groq Error]', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ error: 'Erreur lors de la conversion via Groq.' });
    }
});

/**
 * Refactoring automatique (Gemini)
 */
app.post('/api/refactor', async (req, res) => {
    const { code } = req.body;
    console.log('[DEBUG] /api/refactor appelé');
    console.log('[DEBUG] Code reçu:', code);

    if (!code) return res.status(400).json({ error: 'Code obligatoire pour le refactoring.' });

    // Mode DEMO si pas de clé
    if (!process.env.GEMINI_API_KEY) {
        return res.json({
            demo: true,
            refactoredCode: `// === MODE DEMO ACTIVÉ ===\n// La clé Gemini n'est pas configurée.\n${code}\n// === Exemple d'amélioration simulée ===\n// - Variables renommées\n// - Structure simplifiée\n// - Code nettoyé\n`
        });
    }

    try {
        // Création du fichier temporaire à partir de la variable GEMINI_API_KEY
        const credDir = path.join(__dirname, 'credentials');
        if (!fs.existsSync(credDir)) fs.mkdirSync(credDir);
        const keyFilePath = path.join(credDir, 'gemini-sa.json');
        fs.writeFileSync(keyFilePath, process.env.GEMINI_API_KEY);

        // Auth Google
        const auth = new GoogleAuth({
            keyFile: keyFilePath,
            scopes: 'https://www.googleapis.com/auth/cloud-platform'
        });
        const client = await auth.getClient();

        const url = 'https://generativelanguage.googleapis.com/v1beta2/models/gemini-code-assist:generateMessage';
        const response = await client.request({
            url,
            method: 'POST',
            data: {
                messages: [
                    { role: "system", content: "You are an expert software engineer specialized in clean code and refactoring. Return ONLY the refactored code without explanations." },
                    { role: "user", content: `Refactor this code to improve readability, modularity and best practices while keeping the exact same behavior:\n\n${code}` }
                ],
                temperature: 0.2
            },
            timeout: 30000
        });

        console.log('[DEBUG] Réponse Gemini brute:', response.data);
        const refactoredCode = response.data?.candidates?.[0]?.content?.trim() || "// Erreur : réponse vide de Gemini";

        res.json({ demo: false, refactoredCode });

    } catch (error) {
        console.error('[Gemini Refactor Error]', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Erreur lors du refactoring automatique via Gemini.',
            details: error.response?.data || error.message
        });
    }
});

/**
 * Démarrage du serveur
 */
app.listen(PORT, () => {
    console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});
























