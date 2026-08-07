// Simple JSON-file datastore. No native compilation needed (unlike sqlite
// drivers), which matters when this runs on a low-end laptop. Fine for a
// handful of concurrent users; all writes are serialized through a queue
// below so two requests can never interleave and corrupt the file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Default pricing shown the first time anyone opens the Quotation tab —
// pulled from the Bizonet/Genuine Spares quotation template. Admins can
// change all of this from Admin > Quotation Defaults; it's just a starting
// point so nobody has to type prices in from scratch every time.
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
  users: [],      // {id, name, username, passwordHash, role, perms, createdAt, phone, email, joinDate}
  leads: [],       // see LEAD_FIELDS below
  activity: [],    // {id, date, setter, dials, dms, conversations, createdBy}
  quotations: [],  // see QUOTATION_FIELDS in quotation-routes.js
  loginLogs: [],   // {id, userId, userName, at} — one entry per successful login
  settings: { revenueGoal: 100000, commissionBase: 'cash', inactivityTimeoutMinutes: 30, quotationDefaults: DEFAULT_QUOTATION_DEFAULTS },
  sessions: []     // {token, userId, createdAt, expiresAt}
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2));
  }
}
ensureFile();

let cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
// backfill any keys added after a db.json already existed
for (const k of Object.keys(EMPTY)) if (!(k in cache)) cache[k] = EMPTY[k];
if (!cache.settings.quotationDefaults) cache.settings.quotationDefaults = DEFAULT_QUOTATION_DEFAULTS;
if (!cache.settings.inactivityTimeoutMinutes) cache.settings.inactivityTimeoutMinutes = 30;

let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(cache, null, 2), (err) => {
      if (err) return reject(err);
      fs.rename(tmp, DB_FILE, (err2) => err2 ? reject(err2) : resolve());
    });
  }));
  return writeQueue;
}

function id(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

module.exports = {
  get raw() { return cache; },
  id,
  persist,
  reload() { cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); },
};
