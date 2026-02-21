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
if (!process.env.GROQ_API_KEY)
  console.warn('[WARNING] GROQ_API_KEY manquante !');
else
  console.log('[INFO] GROQ_API_KEY détectée');

if (!process.env.REFACTORING_API_KEY)
  console.warn('[WARNING] REFACTORING_API_KEY manquante !');
else
  console.log('[INFO] REFACTORING_API_KEY détectée');

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
      refactoring: !!process.env.REFACTORING_API_KEY
    }
  });
});

/**
 * Audit intelligent (GROQ / Llama-3)
 */
app.post('/api/audit', async (req, res) => {
  const { code } = req.body;
  if (!code)
    return res.status(400).json({ error: 'Code obligatoire pour l’audit' });

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
DO NOT include any explanations or Markdown outside the JSON.
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
    findingsText = findingsText
      .replace(/^```json\s*/, '')
      .replace(/```$/g, '')
      .trim();

    const findings = JSON.parse(findingsText);

    res.json({ findings });

  } catch (error) {
    console.error('[Audit Error]', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erreur lors de l’audit du code.'
    });
  }
});

/**
 * Conversion de code (GROQ)
 */
app.post('/api/convert', async (req, res) => {
  const { sourceCode, fromLanguage, toLanguage } = req.body;

  if (!process.env.GROQ_API_KEY)
    return res.status(503).json({ error: 'API Groq non configurée.' });

  try {
    const prompt = `
Convert the following code from ${fromLanguage || 'any language'} 
to ${toLanguage}.
Return ONLY the converted code without explanations.

Code:
${sourceCode}
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

    const convertedCode =
      response.data.choices[0].message.content.trim();

    res.json({ convertedCode });

  } catch (error) {
    console.error('[Groq Convert Error]', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erreur lors de la conversion via Groq.'
    });
  }
});

/**
 * Refactoring automatique (via REFACTORING_API_KEY)
 */
app.post('/api/refactor', async (req, res) => {
  const { code } = req.body;

  if (!code)
    return res.status(400).json({ error: 'Code obligatoire pour le refactoring.' });

  if (!process.env.REFACTORING_API_KEY)
    return res.status(503).json({ error: 'Clé REFACTORING_API_KEY non configurée.' });

  try {
    const prompt = `
You are an expert senior software engineer specialized in clean code and refactoring.

Refactor the following code to:
- Improve readability
- Improve structure
- Improve maintainability
- Apply best practices
- Keep EXACT same behavior

Return ONLY the refactored code.
Do not add explanations or markdown.

Code:
${code}
`;

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: prompt }],
        temperature: 0.2
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.REFACTORING_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const refactoredCode =
      response.data.choices[0].message.content.trim();

    res.json({ refactoredCode });

  } catch (error) {
    console.error('[Refactor Error]', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erreur lors du refactoring via REFACTORING_API_KEY.'
    });
  }
});

/**
 * Démarrage serveur
 */
app.listen(PORT, () => {
  console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});


