require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const ATLAS_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'mini_proj';

async function seed() {
  console.log('Connecting to MongoDB Atlas...');
  const client = new MongoClient(ATLAS_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');

    const db = client.db(DB_NAME);

    const collections = ['users', 'chats', 'profiles'];
    for (const collName of collections) {
      const count = await db.collection(collName).countDocuments();
      console.log(`  Collection "${collName}": ${count} documents`);
    }

    const existing = await db.collection('users').findOne({ username: 'demo' });
    if (existing) {
      console.log('\nDemo user already exists, skipping seed.');
      return;
    }

    console.log('\nSeeding demo user...');
    const hash = await bcrypt.hash('demo123', 10);
    const userResult = await db.collection('users').insertOne({
      username: 'demo',
      password: hash,
      created_at: new Date(),
    });

    const userId = userResult.insertedId;
    await db.collection('profiles').insertOne({
      user_id: userId,
      full_name: 'Demo User',
      email: 'demo@example.com',
      phone: '+1 234 567 890',
      location: 'San Francisco, CA',
      summary: 'Software engineer with 3+ years of experience in full-stack development.',
      skills: 'Python, JavaScript, React, Node.js, MongoDB, AWS, Docker',
      education: 'BS Computer Science, UC Berkeley, 2021',
      experience: 'Software Engineer at Acme Corp (2021-2024)',
      resume_json: null,
    });

    await db.collection('chats').insertOne({
      user_id: userId,
      title: 'Sample Chat',
      messages: [
        { role: 'user', content: 'Help me tailor my resume for a backend developer role' },
        { role: 'assistant', content: 'I can help you with that! Let me look at your profile...' },
      ],
      created_at: new Date(),
      updated_at: new Date(),
    });

    console.log('Demo user seeded successfully!');
    console.log('  Username: demo');
    console.log('  Password: demo123');

    const finalCounts = {};
    for (const collName of collections) {
      finalCounts[collName] = await db.collection(collName).countDocuments();
    }
    console.log('\nFinal counts:', finalCounts);
  } catch (err) {
    console.error('Seed failed:', err);
  } finally {
    await client.close();
  }
}

seed();
