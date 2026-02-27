console.log("BACKEND VERSION FINAL OK");

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));

// Supabase
const supabase = createClient(
  process.env.DATA_BASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("Backend OK");
});

// ================= SIGNUP =================
app.post('/signup', async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });

  try {
    const normalizedEmail = email.toLowerCase().trim();

    const { data: existing } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', normalizedEmail);

    if (existing.length > 0)
      return res.status(400).json({ error: 'Compte déjà existant' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      user_id: uuidv4(),
      email: normalizedEmail,
      password: hashedPassword,
      username: username || null,
      created_at: new Date(),
      premium_active: false,
      premium_expires_at: null,
      free_conversion_used: true,
      free_audit_used: true,
      free_refactor_used: true
    };

    const { data, error } = await supabase
      .from('DATA BASE PROFILES')
      .insert([newUser])
      .select();

    if (error) {
      console.error('[SIGNUP ERROR]', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: "Compte créé", user: data[0] });

  } catch (err) {
    console.error('[SIGNUP FATAL]', err);
    res.status(500).json({ error: 'Erreur serveur signup' });
  }
});

// ================= LOGIN =================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: users } = await supabase
      .from('DATA BASE PROFILES')
      .select('*')
      .eq('email', email.toLowerCase().trim());

    if (!users || users.length === 0)
      return res.status(400).json({ error: 'Utilisateur non trouvé' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match)
      return res.status(401).json({ error: 'Mot de passe incorrect' });

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
            premium_expires_at: null,
            free_conversion_used: true,
            free_audit_used: true,
            free_refactor_used: true
          })
          .eq('user_id', user.user_id);
      }
    }

    res.json({
      message: "Connexion OK",
      user: {
        user_id: user.user_id,
        email: user.email,
        username: user.username,
        premium_active: premiumActive,
        free_conversion_used: user.free_conversion_used,
        free_audit_used: user.free_audit_used,
        free_refactor_used: user.free_refactor_used
      }
    });

  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    res.status(500).json({ error: 'Erreur serveur login' });
  }
});

// ================= CONVERT (GROQ) =================
app.post('/api/convert', async (req, res) => {
  const { sourceCode, toLanguage } = req.body;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.3-70b-versatile",
        messages: [{
          role: "user",
          content: `Convert this code to ${toLanguage}:\n${sourceCode}`
        }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      convertedCode: response.data.choices[0].message.content
    });

  } catch (err) {
    console.error('[GROQ ERROR]', err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur conversion GROQ' });
  }
});

// ================= AUDIT (GROQ) =================
app.post('/api/audit', async (req, res) => {
  const { code } = req.body;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.3-70b-versatile",
        messages: [{
          role: "user",
          content: `Audit this code and return JSON findings only:\n${code}`
        }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      findings: response.data.choices[0].message.content
    });

  } catch (err) {
    console.error('[AUDIT ERROR]', err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur audit' });
  }
});

// ================= REFACTOR (HUGGING FACE) =================
app.post('/api/refactor', async (req, res) => {
  const { code } = req.body;

  try {
    const response = await axios.post(
      'https://router.huggingface.co/v1/chat/completions',
      {
        model: "Qwen/Qwen3-Coder-Next:fastest",
        messages: [
          { role: "user", content: `Refactor this code:\n${code}` }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REFACTORING_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      refactoredCode: response.data.choices[0].message.content
    });

  } catch (err) {
    console.error('[REFACTOR ERROR]', err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur refactor' });
  }
});

// ================= PAYPAL WEBHOOK =================
app.post('/paypal/webhook', async (req, res) => {
  const { orderID, user_id, amount } = req.body;

  console.log("Webhook reçu:", req.body);

  if (!orderID || !user_id || !amount) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  if (!uuidValidate(user_id)) {
    console.log("UUID INVALID", user_id);
    return res.status(400).json({ error: "user_id invalide" });
  } else {
    console.log("UUID OK", user_id);
  }

  try {
    // Insert payment
    const { error: paymentError } = await supabase
      .from('DATA BASE PAYMENTS')
      .insert([{
        user_id: user_id,
        paypal_order_id: orderID,
        amount: amount,
        status: "confirmed",
        created_at: new Date()
      }]);

    if (paymentError) {
      console.error("Erreur insertion payment:", paymentError);
      return res.status(500).json({ error: paymentError.message });
    }

    // Activate premium
    const premiumExpiresAt = new Date();
    premiumExpiresAt.setDate(premiumExpiresAt.getDate() + 30);

    const { error: profileError } = await supabase
      .from('DATA BASE PROFILES')
      .update({
        premium_active: true,
        premium_expires_at: premiumExpiresAt,
        free_audit_used: false,
        free_conversion_used: false,
        free_refactor_used: false
      })
      .eq('user_id', user_id);

    if (profileError) {
      console.error("Erreur activation premium:", profileError);
      return res.status(500).json({ error: profileError.message });
    }

    console.log("Premium activé pour:", user_id);

    res.status(200).json({
      message: "Premium activé",
      expires_at: premiumExpiresAt
    });

  } catch (err) {
    console.error('[PAYPAL FATAL]', err);
    res.status(500).json({ error: "Erreur serveur PayPal" });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur port ${PORT}`);
});
