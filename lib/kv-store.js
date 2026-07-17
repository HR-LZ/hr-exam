// Vercel Blob-based JSON storage
// Uses Vercel Blob for persistent JSON storage, falls back to in-memory when Blob is not available

const { put, head, get } = require('@vercel/blob');

let memoryStore = {};

function makePath(collection, id) {
  return `hr-exam/${collection}/${id}.json`;
}

// Check if Blob is available (env var set)
function blobAvailable() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// Read a JSON document from Blob or memory
async function readJSON(collection, id) {
  const pathname = makePath(collection, id);
  if (blobAvailable()) {
    try {
      const blobInfo = await head(pathname);
      if (!blobInfo) return null;
      const response = await get(pathname);
      const text = await response.text();
      return JSON.parse(text);
    } catch (e) {
      console.warn('[Blob Store] Read failed:', e.message);
      return null;
    }
  }
  // Fallback: in-memory
  const key = `${collection}:${id}`;
  return memoryStore[key] || null;
}

// Write a JSON document to Blob or memory
async function writeJSON(collection, id, data) {
  const pathname = makePath(collection, id);
  if (blobAvailable()) {
    try {
      await put(pathname, JSON.stringify(data), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json'
      });
      return true;
    } catch (e) {
      console.warn('[Blob Store] Write failed:', e.message);
      return false;
    }
  }
  // Fallback: in-memory
  const key = `${collection}:${id}`;
  memoryStore[key] = data;
  return true;
}

// Get existing document or create with default
async function getOrCreate(collection, id, defaultValue) {
  const existing = await readJSON(collection, id);
  if (existing !== null) return existing;
  await writeJSON(collection, id, defaultValue);
  return defaultValue;
}

module.exports = { readJSON, writeJSON, getOrCreate };
