// Vercel KV-based JSON storage
// Falls back to in-memory store when KV is not configured (local dev)

let kv = null;
let memoryStore = {};

function getKV() {
  if (kv) return kv;
  try {
    const { kv: vercelKV } = require('@vercel/kv');
    // Test connection
    kv = vercelKV;
    return kv;
  } catch (e) {
    // Fall back to in-memory for local dev
    console.warn('[KV Store] @vercel/kv not available, using in-memory fallback');
    return null;
  }
}

function makeKey(collection, id) {
  return `hr-exam:${collection}:${id}`;
}

// Read a JSON document from KV or memory
async function readJSON(collection, id) {
  const k = getKV();
  if (k) {
    try {
      const raw = await k.get(makeKey(collection, id));
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch (e) {
      console.error(`[KV] read error ${collection}:${id}`, e.message);
      return memoryStore[`${collection}:${id}`] ?? null;
    }
  }
  return memoryStore[`${collection}:${id}`] ?? null;
}

// Write a JSON document to KV or memory
async function writeJSON(collection, id, data) {
  const k = getKV();
  if (k) {
    try {
      await k.set(makeKey(collection, id), JSON.stringify(data));
    } catch (e) {
      console.error(`[KV] write error ${collection}:${id}`, e.message);
    }
  }
  memoryStore[`${collection}:${id}`] = data;
}

// Get or create with default value
async function getOrCreate(collection, id, defaultVal) {
  let data = await readJSON(collection, id);
  if (data === null || data === undefined) {
    data = typeof defaultVal === 'function' ? defaultVal() : defaultVal;
    await writeJSON(collection, id, data);
  }
  return data;
}

module.exports = { readJSON, writeJSON, getOrCreate };
