console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Backend complet avec Supabase Users + Pass Premium via PayPal
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

// Supabase client
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
 * 🔹 Routes Utilisateurs
 */

// Signup
app.post('/signup', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: existingUsers } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (existingUsers && existingUsers.length > 0)
      return res.status(400).json({ error: 'Compte déjà existant.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUserId = uuidv4();

    const { data, error } = await supabase
      .from('DATA BASE PROFILES')
      .insert([{
        user_id: newUserId,
        email: normalizedEmail,
        password: hashedPassword,
        username: username || null,
        created_at: new Date(),
        premium_active: false,
        premium_expires_at: null,
        free_trial_conversion: true,
        free_trial_audit: true,
        free_trial_refactor: true
      }])
      .select();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Utilisateur créé avec succès', user: { email: data[0].email, username: data[0].username, user_id: data[0].user_id } });
  } catch (err) {
    console.error('[Signup Error]', err.message);
    res.status(500).json({ error: 'Erreur lors de la création de l’utilisateur.' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: users } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (!users || users.length === 0) return res.status(400).json({ error: 'Utilisateur non trouvé.' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    let premiumActive = false;
    if (user.premium_active && user.premium_expires_at) {
      const now = new Date();
      const expires = new Date(user.premium_expires_at);
      if (expires > now) premiumActive = true;
      else {
        await supabase.from('DATA BASE PROFILES')
          .update({
            premium_active: false,
            premium_expires_at: null,
            free_trial_conversion: true,
            free_trial_audit: true,
            free_trial_refactor: true
          })
          .eq('user_id', user.user_id);
        premiumActive = false;
      }
    }

    res.json({
      message: 'Connexion réussie',
      user: {
        email: user.email,
        username: user.username,
        user_id: user.user_id,
        premium_active: premiumActive,
        free_trial_conversion: user.free_trial_conversion,
        free_trial_audit: user.free_trial_audit,
        free_trial_refactor: user.free_trial_refactor
      }
    });
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

/**
 * 🔹 Routes IA (GROQ / Hugging Face)
 */

// Audit
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

// Convert
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

// Refactor
app.post('/api/refactor', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code obligatoire pour le refactoring.' });
  if (!process.env.REFACTORING_API_KEY) return res.status(503).json({ error: 'Clé REFACTORING_API_KEY non configurée.' });

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
 * 🔹 Webhook PayPal pour activer le pass premium
 */
app.post('/paypal/webhook', async (req, res) => {
  const event = req.body;
  if (!event.resource) return res.status(400).json({ error: 'Payload invalide' });

  const orderID = event.resource.id;
  const user_id = event.resource.custom; // user_id envoyé dans "custom"
  if (!user_id || !orderID) return res.status(400).json({ error: 'Données manquantes' });

  try {
    // Auth PayPal
    const auth = Buffer.from(`${process.env.Client_ID}:${process.env.Secret}`).toString('base64');

    // Récupérer l’ordre
    const orderResp = await axios.get(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    if (orderResp.data.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Paiement non confirmé par PayPal' });
    }

    const payerEmail = orderResp.data.payer?.email_address;
    const amount = orderResp.data.purchase_units?.[0]?.amount?.value;

    // Ajouter paiement
    await supabase.from('DATA BASE PAYMENTS').insert([{
      user_id,
      paypal_order_id: orderID,
      amount,
      status: 'confirmed',
      created_at: new Date()
    }]);

    // Activer pass premium 30 jours
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await supabase.from('DATA BASE PROFILES').update({
      premium_active: true,
      premium_expires_at: expiresAt,
      free_trial_conversion: false,
      free_trial_audit: false,
      free_trial_refactor: false
    }).eq('user_id', user_id);

    res.status(200).json({ message: 'Pass premium activé', premium_expires_at: expiresAt });
  } catch (err) {
    console.error('[PAYPAL ERROR]', err.response?.data || err.message);
    res.status(500).json({ error: 'Impossible d’activer le pass premium' });
  }
});

/**
 * Démarrage serveur
 */
app.listen(PORT, () => {
  console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
});
