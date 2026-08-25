// Firestore-backed datastore. Keeps the exact same interface as the old
// JSON-file db.js (db.raw, db.id, db.persist, db.reload) so none of the
// route files need to change.
//
// Design: cache stays an in-memory object that routes mutate SYNCHRONOUSLY,
// exactly like before. On boot we load() everything from Firestore into
// cache. Every persist() diffs cache against Firestore and writes the
// difference (adds/updates/deletes) in one batch per collection.
//
// This only supports a single running server instance — same constraint
// the old local-file version had. If you ever scale to multiple instances,
// each route would need to read/write Firestore directly instead of a
// shared in-memory cache.

const admin = require('firebase-admin');

// ---- Firebase init -------------------------------------------------------
// Provide credentials via env var FIREBASE_SERVICE_ACCOUNT (the full JSON,
// e.g. pasted into Render's env var UI) OR a local serviceAccountKey.json
// file for local dev. Never commit the JSON file to git.
function loadCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  // eslint-disable-next-line global-require
  const serviceAccount = require('./serviceAccountKey.json');
  return admin.credential.cert(serviceAccount);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: loadCredential() });
}
const firestore = admin.firestore();

// Collections that behave like plain arrays of records with an `id` field.
const ARRAY_COLLECTIONS = ['users', 'leads', 'activity', 'quotations', 'loginLogs', 'sessions'];
// `settings` is a single object, stored as one document.
const SETTINGS_DOC = firestore.collection('meta').doc('settings');

const DEFAULT_QUOTATION_DEFAULTS = {
  fromCompany: 'Bizonet Technology Solutions',
  docPrefix: 'BZ-JO',
  gstPct: 18,
  validityDays: 15,
  modules: [
    { title: 'Unloading Box', desc: 'A webpage will be provided for unloading the boxes.', include: true },
    { title: 'Product Box Validation', desc: 'It is a page for providing the rack location of the scanned products.', include: true },
    { title: 'Loading of Orders', desc: 'A page will be provided to load the .csv excel containing order information to the Bizonet Platform.', include: true },
    { title: 'Store Out Screen', desc: 'A webpage will be provided which will help you in boxing the items picked as per the order.', include: true },
    { title: 'Dispatch', desc: 'A webpage will be provided which will help you in dispatching the materials to your customer. Invoices will be available along with this functionality.', include: true },
    { title: 'Reports', desc: 'Details of the scanned Orders, Manual entry will be provided over the reports.', include: true },
  ],
  addOns: [
    { title: 'Inward (Container Unloading, Box Validation, Product Racking)', include: true },
    { title: 'Outward (Order Pick up, Boxing)', include: true },
    { title: 'Add-Ons (Logistics Management, Inventory Segregation) – Including in Package.', include: true },
  ],
  packages: [
    { name: 'Silver', price: 120000, machines: 1, users: 10, storage: '10GB', recommended: false, include: true },
    { name: 'Gold', price: 140000, machines: 1, users: 20, storage: '15GB', recommended: true, include: true },
    { name: 'Platinum', price: 160000, machines: 2, users: 50, storage: '15GB', recommended: false, include: true },
  ],
  implementationCostPerDay: 8000,
  scanners: [
    { name: 'Android Mobile Scanner (3GB/32GB, inc. GST)', price: 25000, include: true },
    { name: 'Android Mobile Scanner (4GB/64GB, inc. GST)', price: 27100, include: true },
  ],
  paymentTerms: 'The total project fees would be divided into two parts for payment as half yearly forward looking.',
  assumptions: [
    'It is assumed that the Client will have desktops, laptops, mobiles or any other system with the latest browser version for the Management system to work on all the machines.',
    'The staff required to use the Management system should be educated enough to understand the basic functionalities of the Management system, in order to use the system successfully.',
  ],
  exclusions: [
    'Any module which is not mentioned above in the Project Scope Definition.',
    'Any additional training that is required other than the mentioned above in the Project Scope Definition.',
  ],
};

const EMPTY = {
  users: [],
  leads: [],
  activity: [],
  quotations: [],
  loginLogs: [],
  settings: { revenueGoal: 100000, commissionBase: 'cash', inactivityTimeoutMinutes: 30, quotationDefaults: DEFAULT_QUOTATION_DEFAULTS },
  sessions: [],
};

let cache = JSON.parse(JSON.stringify(EMPTY));
// Tracks which ids existed in Firestore as of the last load/persist, per
// collection, so persist() knows what needs deleting vs upserting.
let lastKnownIds = {};
for (const c of ARRAY_COLLECTIONS) lastKnownIds[c] = new Set();

async function load() {
  for (const col of ARRAY_COLLECTIONS) {
    const snap = await firestore.collection(col).get();
    const rows = [];
    const ids = new Set();
    snap.forEach(doc => {
      rows.push({ id: doc.id, ...doc.data() });
      ids.add(doc.id);
    });
    cache[col] = rows;
    lastKnownIds[col] = ids;
  }
  const settingsSnap = await SETTINGS_DOC.get();
  cache.settings = settingsSnap.exists
    ? { ...EMPTY.settings, ...settingsSnap.data() }
    : EMPTY.settings;
  if (!cache.settings.quotationDefaults) cache.settings.quotationDefaults = DEFAULT_QUOTATION_DEFAULTS;
  if (!cache.settings.inactivityTimeoutMinutes) cache.settings.inactivityTimeoutMinutes = 30;
}

// Diffs cache[col] against what we last saw in Firestore, then upserts
// current rows and deletes rows that disappeared from the cache array
// (covers your hard-delete routes, which do `.filter(...)` reassignment).
async function persist() {
  const batch = firestore.batch();
  let writes = 0;

  for (const col of ARRAY_COLLECTIONS) {
    const rows = cache[col] || [];
    const currentIds = new Set();
    for (const row of rows) {
      if (!row.id) continue; // shouldn't happen — db.id() always sets one
      currentIds.add(row.id);
      const { id, ...data } = row;
      batch.set(firestore.collection(col).doc(id), data);
      writes++;
    }
    for (const oldId of lastKnownIds[col]) {
      if (!currentIds.has(oldId)) {
        batch.delete(firestore.collection(col).doc(oldId));
        writes++;
      }
    }
    lastKnownIds[col] = currentIds;
  }

  batch.set(SETTINGS_DOC, cache.settings || EMPTY.settings);
  writes++;

  // Firestore batches cap at 500 writes; fine for a small-team CRM, but
  // guard against silently dropping writes if you ever exceed it.
  if (writes > 450) {
    console.warn(`db.persist(): ${writes} writes in one batch — approaching Firestore's 500 limit.`);
  }

  await batch.commit();
}

function id(prefix) {
  // Firestore doc IDs work fine as plain strings; keep your existing
  // prefix+timestamp+random scheme so ids look the same as before.
  return prefix + Date.now().toString(36) + Math.random().toString(16).slice(2, 10);
}

let ready = load().catch(err => {
  console.error('Failed to load initial data from Firestore:', err);
  throw err;
});

module.exports = {
  get raw() { return cache; },
  id,
  persist,
  reload: load,
  // Await this once at server startup before accepting requests, so the
  // first request isn't racing the initial Firestore load.
  ready: () => ready,
};