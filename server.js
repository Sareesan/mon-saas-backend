console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Backend complet avec Supabase Users + IA + PayPal Premium
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

/* =========================
   MIDDLEWARE
========================= */

app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

/* =========================
   SUPABASE
========================= */

const supabase = createClient(
  process.env.DATA_BASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   ROOT + HEALTH
========================= */

app.get("/", (req, res) => {
  res.send("Backend OK");
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    groq: !!process.env.GROQ_API_KEY,
    refactoring: !!process.env.REFACTORING_API_KEY,
    supabase: !!process.env.DATA_BASE_URL
  });
});

/* =========================
   SIGNUP
========================= */

app.post('/signup', async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: existing } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (existing && existing.length > 0)
      return res.status(400).json({ error: 'Compte déjà existant.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user_id = uuidv4();

    const { data, error } = await supabase
      .from('DATA BASE PROFILES')
      .insert([{
        user_id,
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

    res.json({ message: "Utilisateur créé", user: data[0] });

  } catch (err) {
    console.error("[Signup Error]", err.message);
    res.status(500).json({ error: "Erreur signup." });
  }
});

/* =========================
   LOGIN
========================= */

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: users } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (!users || users.length === 0)
      return res.status(400).json({ error: 'Utilisateur non trouvé.' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match)
      return res.status(401).json({ error: 'Mot de passe incorrect.' });

    res.json({ message: "Connexion réussie", user });

  } catch (err) {
    console.error("[Login Error]", err.message);
    res.status(500).json({ error: "Erreur login." });
  }
});

/* =========================
   USER ME
========================= */

app.get('/api/user/me', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id)
    return res.status(400).json({ error: "user_id requis" });

  const { data, error } = await supabase
    .from('DATA BASE PROFILES')
    .select('*')
    .eq('user_id', user_id)
    .single();

  if (error || !data)
    return res.status(404).json({ error: "Utilisateur non trouvé" });

  res.json({ user: data });
});

/* =========================
   IA - AUDIT (GROQ LLAMA)
========================= */

app.post('/api/audit', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Code requis" });

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Analyse le code et retourne un JSON." },
          { role: "user", content: code }
        ],
        temperature: 0.1
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      findings: response.data.choices[0].message.content
    });

  } catch (err) {
    console.error("[Audit Error]", err.message);
    res.status(500).json({ error: "Erreur audit." });
  }
});

/* =========================
   IA - CONVERT (GROQ LLAMA)
========================= */

app.post('/api/convert', async (req, res) => {
  const { sourceCode, fromLanguage, toLanguage } = req.body;

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: `Convertis de ${fromLanguage} vers ${toLanguage}` },
          { role: "user", content: sourceCode }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      convertedCode: response.data.choices[0].message.content
    });

  } catch (err) {
    console.error("[Convert Error]", err.message);
    res.status(500).json({ error: "Erreur conversion." });
  }
});

/* =========================
   IA - REFACTOR (HUGGING FACE)
========================= */

app.post('/api/refactor', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Code requis" });

  try {
    const response = await axios.post(
      "https://router.huggingface.co/v1/chat/completions",
      {
        model: "Qwen/Qwen3-Coder-Next:fastest",
        messages: [
          { role: "system", content: "Refactor le code proprement." },
          { role: "user", content: code }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REFACTORING_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      refactoredCode: response.data.choices[0].message.content
    });

  } catch (err) {
    console.error("[Refactor Error]", err.message);
    res.status(500).json({ error: "Erreur refactor." });
  }
});

/* =========================
   PAYPAL WEBHOOK
========================= */

app.post('/paypal/webhook', async (req, res) => {
  try {
    const { orderID } = req.body;
    if (!orderID)
      return res.status(400).json({ error: "orderID requis" });

    const auth = Buffer.from(
      `${process.env.Client_ID}:${process.env.Secret}`
    ).toString('base64');

    const orderResp = await axios.get(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (orderResp.data.status !== "COMPLETED")
      return res.status(400).json({ error: "Paiement non confirmé" });

    const user_id =
      orderResp.data.purchase_units?.[0]?.custom_id;

    const amount =
      orderResp.data.purchase_units?.[0]?.amount?.value;

    if (!user_id)
      return res.status(400).json({ error: "custom_id manquant" });

    await supabase.from('DATA BASE PAYMENTS').insert([{
      user_id,
      paypal_order_id: orderID,
      amount,
      status: "confirmed",
      created_at: new Date()
    }]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await supabase.from('DATA BASE PROFILES')
      .update({
        premium_active: true,
        premium_expires_at: expiresAt,
        free_trial_conversion: false,
        free_trial_audit: false,
        free_trial_refactor: false
      })
      .eq('user_id', user_id);

    res.json({ message: "Premium activé", expiresAt });

  } catch (err) {
    console.error("[PAYPAL ERROR]", err.message);
    res.status(500).json({ error: "Erreur PayPal." });
  }
});

/* ========================= */

app.listen(PORT, () => {
  console.log(`Server démarré sur http://localhost:${PORT}`);
});
