console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Backend sécurisé complet
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

app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

/* =====================================================
   ENV CHECK
===================================================== */
if (!process.env.DATA_BASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn('[WARNING] Supabase non configurée !');

if (!process.env.ADMIN_EMAIL)
  console.warn('[WARNING] ADMIN_EMAIL non défini !');

const supabase = createClient(
  process.env.DATA_BASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   ADMIN MIDDLEWARE
===================================================== */
const adminMiddleware = (req, res, next) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!req.headers['x-admin-email'] || req.headers['x-admin-email'] !== adminEmail) {
    return res.status(403).json({ error: 'Accès admin refusé' });
  }
  next();
};

/* =====================================================
   ROOT + HEALTH
===================================================== */
app.get("/", (req, res) => {
  res.send("Backend OK");
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* =====================================================
   SIGNUP
===================================================== */
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

    res.json({
      message: 'Utilisateur créé',
      user: {
        email: data[0].email,
        username: data[0].username,
        user_id: data[0].user_id
      }
    });

  } catch (err) {
    console.error('[Signup]', err.message);
    res.status(500).json({ error: 'Erreur inscription.' });
  }
});

/* =====================================================
   LOGIN
===================================================== */
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

    // Vérification expiration premium
    let premiumActive = false;

    if (user.premium_active && user.premium_expires_at) {
      const now = new Date();
      const expires = new Date(user.premium_expires_at);

      if (expires > now) {
        premiumActive = true;
      } else {
        await supabase
          .from('DATA BASE PROFILES')
          .update({
            premium_active: false,
            premium_expires_at: null
          })
          .eq('user_id', user.user_id);
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
    console.error('[Login]', err.message);
    res.status(500).json({ error: 'Erreur connexion.' });
  }
});

/* =====================================================
   PAYMENTS
===================================================== */
app.post('/payments/add', async (req, res) => {
  const { user_id, paypal_order_id, amount } = req.body;

  if (!user_id || !paypal_order_id || !amount)
    return res.status(400).json({ error: 'Champs requis manquants.' });

  try {
    const { error } = await supabase
      .from('DATA BASE PAYMENTS')
      .insert([{
        user_id,
        paypal_order_id,
        amount,
        status: 'confirmed',
        created_at: new Date()
      }]);

    if (error) return res.status(400).json({ error: error.message });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await supabase
      .from('DATA BASE PROFILES')
      .update({
        premium_active: true,
        premium_expires_at: expiresAt,
        free_trial_conversion: false,
        free_trial_audit: false,
        free_trial_refactor: false
      })
      .eq('user_id', user_id);

    res.json({ message: 'Premium activé', expires_at: expiresAt });

  } catch (err) {
    console.error('[Payments]', err.message);
    res.status(500).json({ error: 'Erreur paiement.' });
  }
});

/* =====================================================
   ADMIN
===================================================== */
app.get('/admin/users', adminMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('DATA BASE PROFILES')
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
});

app.get('/admin/stats', adminMiddleware, async (req, res) => {
  const { count: totalUsers } = await supabase
    .from('DATA BASE PROFILES')
    .select('*', { count: 'exact', head: true });

  const { count: totalPremium } = await supabase
    .from('DATA BASE PROFILES')
    .select('*', { count: 'exact', head: true })
    .eq('premium_active', true);

  const { count: totalPayments } = await supabase
    .from('DATA BASE PAYMENTS')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'confirmed');

  res.json({
    totalUsers: totalUsers || 0,
    totalPremium: totalPremium || 0,
    totalPayments: totalPayments || 0
  });
});

app.post('/admin/promote', adminMiddleware, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id)
    return res.status(400).json({ error: 'user_id requis' });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { data } = await supabase
    .from('DATA BASE PROFILES')
    .update({
      premium_active: true,
      premium_expires_at: expiresAt
    })
    .eq('user_id', user_id)
    .select();

  if (!data || data.length === 0)
    return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json({ message: 'Utilisateur promu' });
});

app.post('/admin/demote', adminMiddleware, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id)
    return res.status(400).json({ error: 'user_id requis' });

  const { data } = await supabase
    .from('DATA BASE PROFILES')
    .update({
      premium_active: false,
      premium_expires_at: null
    })
    .eq('user_id', user_id)
    .select();

  if (!data || data.length === 0)
    return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json({ message: 'Utilisateur rétrogradé' });
});

/* =====================================================
   GROQ / HUGGING FACE (Placeholders conservés)
===================================================== */
app.post('/api/audit', async (req, res) => {
  res.json({ message: "Audit endpoint actif" });
});

app.post('/api/convert', async (req, res) => {
  res.json({ message: "Convert endpoint actif" });
});

app.post('/api/refactor', async (req, res) => {
  res.json({ message: "Refactor endpoint actif" });
});

/* =====================================================
   START
===================================================== */
app.listen(PORT, () => {
  console.log(`[SERVER] CodeVision AI lancé sur port ${PORT}`);
});

