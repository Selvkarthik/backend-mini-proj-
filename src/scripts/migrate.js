require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

const LOCAL_URI = 'mongodb://localhost:27017';
const ATLAS_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'mini_proj';
const COLLECTIONS = ['users', 'chats', 'profiles'];

async function migrate() {
  console.log('Starting migration from local MongoDB to Atlas...');

  const localClient = new MongoClient(LOCAL_URI);
  const atlasClient = new MongoClient(ATLAS_URI);

  try {
    await localClient.connect();
    console.log('Connected to local MongoDB');

    await atlasClient.connect();
    console.log('Connected to MongoDB Atlas');

    const localDB = localClient.db(DB_NAME);
    const atlasDB = atlasClient.db(DB_NAME);

    for (const collName of COLLECTIONS) {
      console.log(`\nMigrating collection: ${collName}`);

      const docs = await localDB.collection(collName).find({}).toArray();
      console.log(`  Found ${docs.length} documents`);

      if (docs.length === 0) {
        console.log('  Skipping (empty)');
        continue;
      }

      try {
        await atlasDB.collection(collName).drop();
        console.log('  Dropped existing collection');
      } catch (e) {
        // Collection might not exist, that's fine
      }

      if (docs.length > 0) {
        await atlasDB.collection(collName).insertMany(docs, { ordered: false });
        console.log(`  Inserted ${docs.length} documents`);
      }
    }

    console.log('\nMigration complete!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await localClient.close();
    await atlasClient.close();
  }
}

migrate();
