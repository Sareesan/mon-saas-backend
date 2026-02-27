console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Backend sécurisé avec Supabase Users + PayPal LIVE
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

/**
 * Vérification des variables d'environnement
 */
if (!process.env.GROQ_API_KEY) console.warn('[WARNING] GROQ_API_KEY manquante !');
else console.log('[INFO] GROQ_API_KEY détectée');

if (!process.env.REFACTORING_API_KEY) console.warn('[WARNING] REFACTORING_API_KEY manquante !');
else console.log('[INFO] REFACTORING_API_KEY détectée');

if (!process.env.DATA_BASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn('[WARNING] Supabase non configurée !');
else
  console.log('[INFO] Supabase détectée');

if (!process.env.PAYPAL_Client_ID || !process.env.PAYPAL_Secret)
  console.warn('[WARNING] PayPal LIVE non configuré !');
else
  console.log('[INFO] PayPal LIVE détecté');

const supabase = createClient(
  process.env.DATA_BASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── PAYPAL LIVE CONFIG ────────────────────────────────────────────────────────
const PAYPAL_API = 'https://api-m.paypal.com'; // LIVE (pas sandbox)
const PAYPAL_CLIENT_ID = process.env.PAYPAL_Client_ID;
const PAYPAL_SECRET = process.env.PAYPAL_Secret;
const PREMIUM_PRICE = '7.99'; // 🔴 Change ce prix si besoin
const PREMIUM_CURRENCY = 'EUR'; // 🔴 Change la devise si besoin
const PREMIUM_DURATION_DAYS = 30;

/**
 * Obtenir un token d'accès PayPal LIVE
 */
async function getPayPalAccessToken() {
  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const response = await axios.post(
    `${PAYPAL_API}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return response.data.access_token;
}

// ─── ROUTE RACINE ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("Backend OK");
});

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    config: {
      groq: !!process.env.GROQ_API_KEY,
      refactoring: !!process.env.REFACTORING_API_KEY,
      supabase: !!process.env.DATA_BASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      paypal: !!process.env.PAYPAL_Client_ID && !!process.env.PAYPAL_Secret
    }
  });
});

// ─── SUPABASE AUTH ─────────────────────────────────────────────────────────────

// Inscription utilisateur
app.post('/signup', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: existingUsers } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ error: 'Compte déjà existant.' });
    }

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
        is_premium: false,
        premium_expires_at: null,
        free_conversion_used: false,
        free_audit_used: false,
        free_refactor_used: false
      }])
      .select();

    if (error) return res.status(400).json({ error: error.message });

    res.json({
      message: 'Utilisateur créé avec succès',
      user: {
        email: data[0].email,
        username: data[0].username,
        user_id: data[0].user_id
      }
    });

  } catch (err) {
    console.error('[Signup Error]', err.message);
    res.status(500).json({ error: "Erreur lors de la création de l'utilisateur." });
  }
});

// Connexion utilisateur
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: users } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (!users || users.length === 0) {
      return res.status(400).json({ error: 'Utilisateur non trouvé.' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    // Vérifier si le premium a expiré et le rétrograder automatiquement
    if (user.is_premium && user.premium_expires_at) {
      const now = new Date();
      const expiresAt = new Date(user.premium_expires_at);
      if (now > expiresAt) {
        await supabase
          .from('DATA BASE PROFILES')
          .update({ is_premium: false })
          .eq('user_id', user.user_id);
        user.is_premium = false;
      }
    }

    res.json({
      message: 'Connexion réussie',
      user: {
        email: user.email,
        username: user.username,
        user_id: user.user_id,
        is_premium: user.is_premium,
        premium_expires_at: user.premium_expires_at,
        free_conversion_used: user.free_conversion_used,
        free_audit_used: user.free_audit_used,
        free_refactor_used: user.free_refactor_used
      }
    });

  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

// ─── PAYPAL LIVE — ÉTAPE 1 : Créer la commande ────────────────────────────────
/**
 * POST /api/paypal/create-order
 * Body: { user_id: "..." }
 * Crée une commande PayPal LIVE et retourne l'order_id au frontend
 */
app.post('/api/paypal/create-order', async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id requis.' });

  try {
    // Vérifier que l'utilisateur existe
    const { data: users, error: userError } = await supabase
      .from('DATA BASE PROFILES')
      .select('user_id, email, is_premium, premium_expires_at')
      .eq('user_id', user_id);

    if (userError || !users || users.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const user = users[0];

    // Si déjà premium et pas expiré → bloquer
    if (user.is_premium && user.premium_expires_at) {
      const expiresAt = new Date(user.premium_expires_at);
      if (new Date() < expiresAt) {
        return res.status(400).json({ error: 'Vous avez déjà un pass premium actif.' });
      }
    }

    const accessToken = await getPayPalAccessToken();

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [{
        description: 'Pass Premium 30 jours — CodeVision AI',
        amount: {
          currency_code: PREMIUM_CURRENCY,
          value: PREMIUM_PRICE
        },
        custom_id: user_id // Lier la commande à l'utilisateur
      }],
      application_context: {
        brand_name: 'CodeVision AI',
        locale: 'fr-FR',
        user_action: 'PAY_NOW'
      }
    };

    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders`,
      orderPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[PayPal] Commande créée : ${response.data.id} pour user ${user_id}`);

    res.json({
      order_id: response.data.id,
      status: response.data.status
    });

  } catch (err) {
    console.error('[PayPal Create Order Error]', err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur lors de la création de la commande PayPal.' });
  }
});

// ─── PAYPAL LIVE — ÉTAPE 2 : Capturer et activer le premium ───────────────────
/**
 * POST /api/paypal/capture-order
 * Body: { order_id: "...", user_id: "..." }
 * Capture le paiement PayPal et active le pass premium dans Supabase
 */
app.post('/api/paypal/capture-order', async (req, res) => {
  const { order_id, user_id } = req.body;

  if (!order_id || !user_id) {
    return res.status(400).json({ error: 'order_id et user_id requis.' });
  }

  try {
    const accessToken = await getPayPalAccessToken();

    // Capturer le paiement auprès de PayPal
    const captureResponse = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${order_id}/capture`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const captureData = captureResponse.data;
    const captureStatus = captureData.status;

    console.log(`[PayPal] Capture order ${order_id} → status: ${captureStatus}`);

    if (captureStatus !== 'COMPLETED') {
      return res.status(400).json({
        error: `Paiement non complété. Statut PayPal: ${captureStatus}`
      });
    }

    // Extraire les infos du paiement capturé
    const captureUnit = captureData.purchase_units?.[0];
    const captureDetail = captureUnit?.payments?.captures?.[0];
    const amountPaid = captureDetail?.amount?.value || PREMIUM_PRICE;
    const captureCurrency = captureDetail?.amount?.currency_code || PREMIUM_CURRENCY;

    // Calculer la date d'expiration (maintenant + 30 jours)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1000);

    // ✅ Activer le premium dans DATA BASE PROFILES
    const { error: profileError } = await supabase
      .from('DATA BASE PROFILES')
      .update({
        is_premium: true,
        premium_expires_at: expiresAt.toISOString()
      })
      .eq('user_id', user_id);

    if (profileError) {
      console.error('[Supabase Profile Update Error]', profileError.message);
      return res.status(500).json({ error: 'Paiement reçu mais erreur activation premium. Contactez le support.' });
    }

    // ✅ Enregistrer le paiement dans DATA BASE PAYMENTS
    const { error: paymentError } = await supabase
      .from('DATA BASE PAYMENTS')
      .insert([{
        user_id: user_id,
        paypal_order_id: order_id,
        amount: parseFloat(amountPaid),
        status: 'COMPLETED',
        created_at: now.toISOString()
      }]);

    if (paymentError) {
      // Non bloquant : le premium est déjà activé, on log juste l'erreur
      console.error('[Supabase Payment Insert Error]', paymentError.message);
    }

    console.log(`[PayPal] ✅ Premium activé pour user ${user_id} jusqu'au ${expiresAt.toISOString()}`);

    res.json({
      success: true,
      message: 'Pass Premium activé avec succès !',
      premium: {
        is_premium: true,
        premium_expires_at: expiresAt.toISOString(),
        days: PREMIUM_DURATION_DAYS,
        order_id: order_id,
        amount: `${amountPaid} ${captureCurrency}`
      }
    });

  } catch (err) {
    console.error('[PayPal Capture Error]', err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur lors de la capture du paiement PayPal.' });
  }
});

// ─── STATUT PREMIUM D'UN UTILISATEUR ──────────────────────────────────────────
/**
 * GET /api/premium/status/:user_id
 * Retourne le statut premium actuel d'un utilisateur
 */
app.get('/api/premium/status/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    const { data: users, error } = await supabase
      .from('DATA BASE PROFILES')
      .select('user_id, is_premium, premium_expires_at, free_conversion_used, free_audit_used, free_refactor_used')
      .eq('user_id', user_id);

    if (error || !users || users.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const user = users[0];
    const now = new Date();

    let isPremiumActive = false;
    let daysLeft = 0;

    if (user.is_premium && user.premium_expires_at) {
      const expiresAt = new Date(user.premium_expires_at);
      if (now < expiresAt) {
        isPremiumActive = true;
        daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      } else {
        // Expiration détectée → mettre à jour Supabase
        await supabase
          .from('DATA BASE PROFILES')
          .update({ is_premium: false })
          .eq('user_id', user_id);
      }
    }

    res.json({
      user_id: user.user_id,
      is_premium: isPremiumActive,
      premium_expires_at: user.premium_expires_at,
      days_left: isPremiumActive ? daysLeft : 0,
      free_conversion_used: user.free_conversion_used,
      free_audit_used: user.free_audit_used,
      free_refactor_used: user.free_refactor_used
    });

  } catch (err) {
    console.error('[Premium Status Error]', err.message);
    res.status(500).json({ error: 'Erreur lors de la vérification du statut premium.' });
  }
});

// ─── MARQUER ESSAI GRATUIT UTILISÉ ────────────────────────────────────────────
/**
 * POST /api/free-trial/use
 * Body: { user_id: "...", service: "conversion" | "audit" | "refactor" }
 * Marque l'essai gratuit comme utilisé pour un service donné
 */
app.post('/api/free-trial/use', async (req, res) => {
  const { user_id, service } = req.body;

  const validServices = ['conversion', 'audit', 'refactor'];
  if (!user_id || !validServices.includes(service)) {
    return res.status(400).json({ error: 'user_id et service valide requis.' });
  }

  const columnMap = {
    conversion: 'free_conversion_used',
    audit: 'free_audit_used',
    refactor: 'free_refactor_used'
  };

  try {
    const column = columnMap[service];
    const { error } = await supabase
      .from('DATA BASE PROFILES')
      .update({ [column]: true })
      .eq('user_id', user_id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, message: `Essai gratuit ${service} marqué comme utilisé.` });

  } catch (err) {
    console.error('[Free Trial Error]', err.message);
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'essai gratuit." });
  }
});

// ─── ROUTES IA GROQ / HUGGING FACE (NON MODIFIÉES) ───────────────────────────

app.post('/api/audit', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Code obligatoire pour l'audit" });

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
      return res.status(500).json({ error: "Impossible de parser la réponse de l'audit", raw: findingsText });
    }

    res.json({ findings });

  } catch (error) {
    console.error('[Audit Error]', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: "Erreur lors de l'audit du code." });
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

// ─── DÉMARRAGE SERVEUR ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
  console.log(`[SERVER] Supabase backend disponible sur https://mon-saas-backend.onrender.com`);
  console.log(`[SERVER] PayPal LIVE activé — Client ID: ${PAYPAL_CLIENT_ID ? '✅ détecté' : '❌ MANQUANT'}`);
});


