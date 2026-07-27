const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'mini_proj';

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  console.log(`Connected to MongoDB: ${dbName}`);
  return db;
}

function getDB() {
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

function getClient() {
  return client;
}

module.exports = { connectDB, getDB, closeDB, getClient };
