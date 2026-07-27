const express = require('express');
const { getDB } = require('../config/db');
const { extractTextFromPDF } = require('../services/pdf');
const { parseResumeWithLLM } = require('../services/resume');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.collection('profiles').findOne({ user_id: req.userId }) || {};
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const now = new Date();

    const full_name = (req.body.full_name || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim();
    const location = (req.body.location || '').trim();
    const summary = (req.body.summary || '').trim();
    const skills_raw = (req.body.skills || '').trim();
    const education_raw = (req.body.education || '').trim();
    const experience_raw = (req.body.experience || '').trim();
    const resume_text = (req.body.resume_text || '').trim();

    const skills_dict = {};
    if (skills_raw) {
      skills_dict['General'] = skills_raw.split(',').map(s => s.trim()).filter(Boolean);
    }

    const education_list = education_raw.split('\n').filter(l => l.trim()).map(line => ({
      degree: line.trim(), institution: '', period: '', grade: ''
    }));

    const experience_list = experience_raw.split('\n').filter(l => l.trim()).map(line => ({
      role: line.trim(), company: '', location: '', period: '', stack: '', projects: []
    }));

    let resume_json = {
      name: full_name,
      title: '',
      contact: { phone, email, github: [], linkedin: '', location },
      summary,
      skills: skills_dict,
      experience: experience_list,
      projects: [],
      education: education_list,
      certifications: [],
      publications: [],
      additional: {},
    };

    const existing = await db.collection('profiles').findOne({ user_id: req.userId });
    if (existing && existing.resume_json && !existing.resume_json.error) {
      const base = existing.resume_json;
      if (full_name) base.name = full_name;
      if (email) base.contact = { ...(base.contact || {}), email };
      if (phone) base.contact = { ...(base.contact || {}), phone };
      if (location) base.contact = { ...(base.contact || {}), location };
      if (summary) base.summary = summary;
      if (skills_raw) base.skills = skills_dict;
      resume_json = base;
    }

    const data = {
      user_id: req.userId,
      full_name, email, phone, location, summary,
      skills: skills_raw, education: education_raw,
      experience: experience_raw, resume_text,
      resume_json, updated_at: now,
    };

    await db.collection('profiles').updateOne(
      { user_id: req.userId },
      { $set: data },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', auth, async (req, res) => {
  try {
    if (!req.files || !req.files.resume) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const file = req.files.resume;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files are accepted' });
    }

    const resume_text = await extractTextFromPDF(file.data);
    if (!resume_text) {
      return res.status(400).json({ error: 'Could not extract text from PDF.' });
    }

    const resume_json = await parseResumeWithLLM(resume_text);

    const db = getDB();
    await db.collection('profiles').updateOne(
      { user_id: req.userId },
      { $set: { resume_text, resume_json, updated_at: new Date() } },
      { upsert: true }
    );

    res.json({ resume_text, resume_json });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
