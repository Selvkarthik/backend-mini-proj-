const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/db');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDB();
    const user = await db.collection('users').findOne({ username: username.trim() });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user._id.toString();
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDB();
    const existing = await db.collection('users').findOne({ username: username.trim() });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({
      username: username.trim(),
      password: hashed,
      created_at: new Date(),
    });

    req.session.userId = result.insertedId.toString();
    req.session.username = username.trim();
    res.json({ ok: true, username: username.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ userId: req.session.userId, username: req.session.username });
});

module.exports = router;
