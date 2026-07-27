const express = require('express');
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { chatCompletion } = require('../services/llm');
const { buildSystemPrompt } = require('../services/resume');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const chats = await db.collection('chats')
      .find({ user_id: req.userId }, { projection: { messages: 0 } })
      .sort({ updated_at: -1 })
      .toArray();
    chats.forEach(c => { c._id = c._id.toString(); });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const title = req.body.title || 'New Chat';
    const chat = {
      user_id: req.userId,
      title,
      messages: [],
      created_at: new Date(),
      updated_at: new Date(),
    };
    const result = await db.collection('chats').insertOne(chat);
    res.json({ _id: result.insertedId.toString(), title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const chat = await db.collection('chats').findOne({
      _id: new ObjectId(req.params.id),
      user_id: req.userId,
    });
    if (!chat) return res.status(404).json({ error: 'Not found' });
    chat._id = chat._id.toString();
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    await db.collection('chats').deleteOne({
      _id: new ObjectId(req.params.id),
      user_id: req.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/message', auth, async (req, res) => {
  try {
    const db = getDB();
    const { message: userMsg } = req.body;
    if (!userMsg || !userMsg.trim()) {
      return res.status(400).json({ error: 'Empty message' });
    }

    const chat = await db.collection('chats').findOne({
      _id: new ObjectId(req.params.id),
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

    let aiReply;
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey || apiKey === 'sk-or-v1-dummy-placeholder-key-for-development') {
        return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured. Please set it in the backend .env file.' });
      }
      aiReply = await chatCompletion(lcMessages);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('401') || msg.includes('Missing Authentication')) {
        return res.status(500).json({ error: 'Invalid OPENROUTER_API_KEY.' });
      }
      if (msg.includes('429')) {
        return res.status(500).json({ error: 'Rate limited. Please wait and try again.' });
      }
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
        { _id: new ObjectId(req.params.id) },
        { $push: { tailored_resumes: resumeJson } }
      );
      const updated = await db.collection('chats').findOne({ _id: new ObjectId(req.params.id) });
      const tailored = updated.tailored_resumes || [];
      resumeIndex = tailored.length - 1;
    }

    const now = new Date();
    const assistantMsg = { role: 'assistant', content: cleanReply, timestamp: now };
    if (resumeJson) {
      assistantMsg.resume_json = resumeJson;
      assistantMsg.resume_index = resumeIndex;
    }

    await db.collection('chats').updateOne(
      { _id: new ObjectId(req.params.id) },
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
        { _id: new ObjectId(req.params.id) },
        { $set: { title } }
      );
    }

    const resp = { reply: cleanReply };
    if (resumeJson) {
      resp.resume_json = resumeJson;
      resp.resume_index = resumeIndex;
      resp.chat_id = req.params.id;
    }
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
