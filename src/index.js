require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const { connectDB, getDB, getClient } = require('./config/db');
const { ObjectId } = require('mongodb');
const { buildSystemPrompt } = require('./services/resume');
const { chatCompletion } = require('./services/llm');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const chatRoutes = require('./routes/chat');

const app = express();

const allowedOrigins = ['https://readyresume.help', 'https://selvkarthik.github.io'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
  abortOnLimit: true,
}));

let sessionMiddleware = null;

function getSessionMiddleware() {
  if (sessionMiddleware) return sessionMiddleware;
  sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    },
    store: MongoStore.create({
      client: getClient(),
      dbName: process.env.MONGODB_DB || 'mini_proj',
      collectionName: 'sessions',
      ttl: 7 * 24 * 60 * 60,
    }),
  });
  return sessionMiddleware;
}

app.use((req, res, next) => {
  getSessionMiddleware()(req, res, next);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/chats', chatRoutes);

function auth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.userId = req.session.userId;
  req.username = req.session.username;
  next();
}

app.post('/api/chat', auth, async (req, res) => {
  try {
    const db = getDB();
    const { chat_id, message: userMsg } = req.body;
    if (!userMsg || !userMsg.trim()) {
      return res.status(400).json({ error: 'Empty message' });
    }
    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id required' });
    }

    const chat = await db.collection('chats').findOne({
      _id: new ObjectId(chat_id),
      user_id: req.userId,
    });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    let systemPrompt;
    try {
      const profile = await db.collection('profiles').findOne({ user_id: req.userId });
      systemPrompt = buildSystemPrompt(profile);
    } catch (e) {
      systemPrompt = 'You are a helpful AI assistant.';
    }

    const lcMessages = [{ role: 'system', content: systemPrompt }];
    for (const m of (chat.messages || [])) {
      lcMessages.push({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      });
    }
    lcMessages.push({ role: 'user', content: userMsg.trim() });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });
    }

    let aiReply;
    try {
      aiReply = await chatCompletion(lcMessages);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('401')) return res.status(500).json({ error: 'Invalid OPENROUTER_API_KEY.' });
      if (msg.includes('429')) return res.status(500).json({ error: 'Rate limited. Wait and try again.' });
      return res.status(500).json({ error: msg });
    }

    let resumeJson = null;
    let resumeIndex = null;
    let cleanReply = aiReply;

    const match = aiReply.match(/<resume_json>([\s\S]*?)<\/resume_json>/);
    if (match) {
      try {
        resumeJson = JSON.parse(match[1].trim());
        cleanReply = (aiReply.substring(0, match.index) + aiReply.substring(match.index + match[0].length)).trim();
      } catch (e) {
        resumeJson = null;
      }
    }

    if (resumeJson) {
      await db.collection('chats').updateOne(
        { _id: new ObjectId(chat_id) },
        { $push: { tailored_resumes: resumeJson } }
      );
      const updated = await db.collection('chats').findOne({ _id: new ObjectId(chat_id) });
      resumeIndex = (updated.tailored_resumes || []).length - 1;
    }

    const now = new Date();
    const assistantMsg = { role: 'assistant', content: cleanReply, timestamp: now };
    if (resumeJson) {
      assistantMsg.resume_json = resumeJson;
      assistantMsg.resume_index = resumeIndex;
    }

    await db.collection('chats').updateOne(
      { _id: new ObjectId(chat_id) },
      {
        $push: {
          messages: {
            $each: [
              { role: 'user', content: userMsg.trim(), timestamp: now },
              assistantMsg,
            ]
          }
        },
        $set: { updated_at: now },
      }
    );

    if (chat.title === 'New Chat') {
      const title = userMsg.trim().substring(0, 50) + (userMsg.length > 50 ? '...' : '');
      await db.collection('chats').updateOne(
        { _id: new ObjectId(chat_id) },
        { $set: { title } }
      );
    }

    const resp = { reply: cleanReply };
    if (resumeJson) {
      resp.resume_json = resumeJson;
      resp.resume_index = resumeIndex;
      resp.chat_id = chat_id;
    }
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let dbConnected = false;

async function ensureDB() {
  if (!dbConnected) {
    await connectDB();
    dbConnected = true;
  }
}

if (process.env.NODE_ENV !== 'lambda') {
  ensureDB().then(() => {
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  }).catch(console.error);
}

module.exports = app;
module.exports.handler = async (event, context) => {
  await ensureDB();
  const serverlessHttp = require('serverless-http');
  const handler = serverlessHttp(app);
  return handler(event, context);
};
