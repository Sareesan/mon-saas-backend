console.log("BACKEND VERSION SDK GROQ OK");

/**
 * CodeVision AI - Backend sécurisé complet (Users + Paiements + Admin)
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
else console.log('[INFO] Supabase détectée');

if (!process.env.ADMIN_EMAIL) console.warn('[WARNING] ADMIN_EMAIL non défini !');

const supabase = createClient(
  process.env.DATA_BASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Middleware Admin
 */
const adminMiddleware = (req, res, next) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!req.headers['x-admin-email'] || req.headers['x-admin-email'] !== adminEmail) {
    return res.status(403).json({ error: 'Accès admin refusé' });
  }
  next();
};

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
 * 🔹 Routes utilisateurs
 */

// Inscription
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

// Connexion
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

    // Vérifier expiration du pass premium
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
 * 🔹 Paiements
 */

app.post('/payments/add', async (req, res) => {
  const { user_id, paypal_order_id, amount } = req.body;
  if (!user_id || !paypal_order_id || !amount) return res.status(400).json({ error: 'user_id, paypal_order_id et amount requis.' });

  try {
    const { data: payment, error: paymentError } = await supabase
      .from('DATA BASE PAYMENTS')
      .insert([{
        user_id,
        paypal_order_id,
        amount,
        status: 'confirmed',
        created_at: new Date()
      }])
      .select();

    if (paymentError) return res.status(400).json({ error: paymentError.message });

    // Activer le pass premium 30 jours
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

    res.json({ message: 'Paiement ajouté et pass premium activé', expires_at: expiresAt });
  } catch (err) {
    console.error('[Payments Add]', err.message);
    res.status(500).json({ error: 'Impossible d’ajouter le paiement.' });
  }
});

/**
 * 🔹 Admin
 */

app.get('/admin/users', adminMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('DATA BASE PROFILES')
      .select('*');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ users: data });
  } catch (err) {
    console.error('[Admin Users]', err.message);
    res.status(500).json({ error: 'Impossible de récupérer les utilisateurs.' });
  }
});

// Statistiques admin
app.get('/admin/stats', adminMiddleware, async (req, res) => {
  try {
    const { data: users } = await supabase.from('DATA BASE PROFILES').select('*');
    const { data: payments } = await supabase.from('DATA BASE PAYMENTS').select('*');

    const totalUsers = users.length;
    const totalPremium = users.filter(u => u.premium_active).length;
    const totalPayments = payments.filter(p => p.status === 'confirmed').length;
    const revenue = payments.filter(p => p.status === 'confirmed').reduce((sum, p) => sum + parseFloat(p.amount), 0);

    res.json({ totalUsers, totalPremium, totalPayments, revenue });
  } catch (err) {
    console.error('[Admin Stats]', err.message);
    res.status(500).json({ error: 'Impossible de récupérer les stats.' });
  }
});

// Promouvoir
app.post('/admin/promote', adminMiddleware, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id requis' });

  try {
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

    res.json({ message: 'Utilisateur promu et pass premium activé', expires_at: expiresAt });
  } catch (err) {
    console.error('[Admin Promote]', err.message);
    res.status(500).json({ error: 'Impossible de promouvoir l’utilisateur.' });
  }
});

// Rétrograder
app.post('/admin/demote', adminMiddleware, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id requis' });

  try {
    await supabase.from('DATA BASE PROFILES')
      .update({
        premium_active: false,
        premium_expires_at: null
      })
      .eq('user_id', user_id);

    res.json({ message: 'Utilisateur rétrogradé, pass premium désactivé.' });
  } catch (err) {
    console.error('[Admin Demote]', err.message);
    res.status(500).json({ error: 'Impossible de rétrograder l’utilisateur.' });
  }
});

/**
 * 🔹 Routes existantes GROQ / Hugging Face
 * Inchangées
 */
app.post('/api/audit', async (req, res) => { /* inchangé */ });
app.post('/api/convert', async (req, res) => { /* inchangé */ });
app.post('/api/refactor', async (req, res) => { /* inchangé */ });

/**
 * Démarrage serveur
 */
app.listen(PORT, () => {
  console.log(`[SERVER] CodeVision AI démarré sur http://localhost:${PORT}`);
  console.log(`[SERVER] Supabase backend disponible sur https://mon-saas-backend.onrender.com`);
});
