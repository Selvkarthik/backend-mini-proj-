const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

async function authMiddleware(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.userId = userId;
    req.username = user.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

module.exports = authMiddleware;
