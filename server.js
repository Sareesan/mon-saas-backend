console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Secure Backend Proxy (Node.js) avec Supabase Users
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

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
  console.warn('[WARNING] REFACTORING_API_KEY manquante ! Mode refactor désactivé');
else
  console.log('[INFO] REFACTORING_API_KEY détectée');

if (!process.env.DATA_BASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn('[WARNING] Supabase non configurée !');
else
  console.log('[INFO] Supabase détectée');

const supabase = createClient(
  process.env.DATA_BASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      refactoring: !!process.env.REFACTORING_API_KEY,
      supabase: !!process.env.DATA_BASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
});

/**
 * 🔹 Routes Supabase - Users
 */

// Inscription utilisateur
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    // Hasher le mot de passe avant insertion
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users') // Assure-toi d'avoir une table 'users' dans Supabase
      .insert([{ email, password: hashedPassword }]);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Utilisateur créé avec succès', data });
  } catch (err) {
    console.error('[Signup Error]', err.message);
    res.status(500).json({ error: 'Erreur lors de la création de l’utilisateur.' });
  }
});

// Connexion utilisateur
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) return res.status(400).json({ error: 'Utilisateur non trouvé.' });

    const match = await bcrypt.compare(password, data.password);
    if (!match) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    res.json({ message: 'Connexion réussie', user: { email: data.email } });
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

/**
 * 🔹 Routes existantes (GROQ / Hugging Face)
 * Je n’y touche pas, tout reste identique
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
DO NOT include any explanations or Markdown outside the JSON.
Code to analyze:
${code}
`;

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: prompt }], temperature: 0.1 },
      { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    let findingsText = response.data.choices[0].message.content.trim();
    findingsText = findingsText
      .replace(/^```json\s*/, '')
      .replace(/```$/g, '')
      .replace(/^#+\s.*$/gm, '')
      .trim();

    let findings;
    try {
      findings = JSON.parse(findingsText);
    } catch (parseErr) {
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

app.post('/api/convert', async (req, res) => {
  const { sourceCode, fromLanguage, toLanguage } = req.body;

  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'API Groq non configurée.' });

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
      { model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: prompt }], temperature: 0.1 },
      { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const convertedCode = response.data.choices[0].message.content.trim();
    res.json({ convertedCode });

  } catch (error) {
    console.error('[Groq Convert Error]', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: 'Erreur lors de la conversion via Groq.' });
  }
});

app.post('/api/refactor', async (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).json({ error: 'Code obligatoire pour le refactoring.' });
  if (!process.env.REFACTORING_API_KEY) return res.status(503).json({ error: 'Clé REFACTORING_API_KEY non configurée.' });

  console.log('[DEBUG] /api/refactor appelé');
  console.log('[DEBUG] Code reçu:', code);

  try {
    const response = await axios.post(
      'https://router.huggingface.co/v1/chat/completions',
      {
        model: "Qwen/Qwen3-Coder-Next:fastest",
        messages: [
          { role: "system", content: "You are an AI that refactors code. Return cleaned/refactored code only." },
          { role: "user", content: `Refactor this code:\n${code}` }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.REFACTORING_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const refactoredCode = response.data?.choices?.[0]?.message?.content || "";
    res.json({ refactoredCode });

  } catch (error) {
    console.error('[Refactor Error]', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erreur lors du refactoring via Hugging Face.',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Démarrage serveur
 */
app.listen(PORT, () => {
  console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
  console.log(`[SERVER] Supabase backend disponible sur https://mon-saas-backend.onrender.com`);
});
