// server/db.js
//
// Firestore-backed datastore for Pipeline CRM.
//
// Keeps the same interface used by all existing routes:
//   db.raw
//   db.id()
//   db.persist()
//   db.reload()
//   db.ready()
//
// Firebase credentials are supplied through:
//   FIREBASE_SERVICE_ACCOUNT
//
// IMPORTANT:
// Never commit the Firebase service-account JSON/private key to GitHub.

const {
  initializeApp,
  getApps,
  cert
} = require('firebase-admin/app');

const {
  getFirestore
} = require('firebase-admin/firestore');


// ============================================================================
// FIREBASE INITIALIZATION
// ============================================================================

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT environment variable is missing.'
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT contains invalid JSON: ${err.message}`
    );
  }

  if (!serviceAccount.project_id) {
    throw new Error(
      'Firebase service account is missing "project_id".'
    );
  }

  if (!serviceAccount.client_email) {
    throw new Error(
      'Firebase service account is missing "client_email".'
    );
  }

  if (!serviceAccount.private_key) {
    throw new Error(
      'Firebase service account is missing "private_key".'
    );
  }

  // Vercel may store the private key with literal \n characters.
  // Convert them into actual newline characters.
  const privateKey = serviceAccount.private_key.replace(
    /\\n/g,
    '\n'
  );

  console.log('Firebase credentials loaded:', {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    hasPrivateKey: !!privateKey,
    privateKeyLength: privateKey.length
  });

  return cert({
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey
  });
}


// Reuse an already-created Firebase app when Vercel
// reuses the same serverless instance.
let firebaseApp;

try {
  const existingApps = getApps();

  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];

    console.log(
      'Firebase Admin: reusing existing app.'
    );
  } else {
    console.log(
      'Firebase Admin: initializing new app...'
    );

    firebaseApp = initializeApp({
      credential: loadCredential()
    });

    console.log(
      'Firebase Admin: initialized successfully.'
    );
  }
} catch (err) {
  console.error(
    'Firebase Admin initialization failed:',
    err.message
  );

  console.error(err.stack);

  throw err;
}


// Get Firestore for the initialized Firebase app.
const firestore = getFirestore(firebaseApp);

console.log(
  'Firestore initialized successfully.'
);


// ============================================================================
// COLLECTIONS
// ============================================================================

const ARRAY_COLLECTIONS = [
  'users',
  'leads',
  'activity',
  'quotations',
  'loginLogs',
  'sessions'
];

const SETTINGS_DOC = firestore
  .collection('meta')
  .doc('settings');


// ============================================================================
// DEFAULT QUOTATION SETTINGS
// ============================================================================

const DEFAULT_QUOTATION_DEFAULTS = {
  fromCompany: 'Bizonet Technology Solutions',

  docPrefix: 'BZ-JO',

  gstPct: 18,

  validityDays: 15,

  modules: [
    {
      title: 'Unloading Box',
      desc:
        'A webpage will be provided for unloading the boxes.',
      include: true
    },

    {
      title: 'Product Box Validation',
      desc:
        'It is a page for providing the rack location of the scanned products.',
      include: true
    },

    {
      title: 'Loading of Orders',
      desc:
        'A page will be provided to load the .csv excel containing order information to the Bizonet Platform.',
      include: true
    },

    {
      title: 'Store Out Screen',
      desc:
        'A webpage will be provided which will help you in boxing the items picked as per the order.',
      include: true
    },

    {
      title: 'Dispatch',
      desc:
        'A webpage will be provided which will help you in dispatching the materials to your customer. Invoices will be available along with this functionality.',
      include: true
    },

    {
      title: 'Reports',
      desc:
        'Details of the scanned Orders, Manual entry will be provided over the reports.',
      include: true
    }
  ],

  addOns: [
    {
      title:
        'Inward (Container Unloading, Box Validation, Product Racking)',
      include: true
    },

    {
      title:
        'Outward (Order Pick up, Boxing)',
      include: true
    },

    {
      title:
        'Add-Ons (Logistics Management, Inventory Segregation) – Including in Package.',
      include: true
    }
  ],

  packages: [
    {
      name: 'Silver',
      price: 120000,
      machines: 1,
      users: 10,
      storage: '10GB',
      recommended: false,
      include: true
    },

    {
      name: 'Gold',
      price: 140000,
      machines: 1,
      users: 20,
      storage: '15GB',
      recommended: true,
      include: true
    },

    {
      name: 'Platinum',
      price: 160000,
      machines: 2,
      users: 50,
      storage: '15GB',
      recommended: false,
      include: true
    }
  ],

  implementationCostPerDay: 8000,

  scanners: [
    {
      name:
        'Android Mobile Scanner (3GB/32GB, inc. GST)',
      price: 25000,
      include: true
    },

    {
      name:
        'Android Mobile Scanner (4GB/64GB, inc. GST)',
      price: 27100,
      include: true
    }
  ],

  paymentTerms:
    'The total project fees would be divided into two parts for payment as half yearly forward looking.',

  assumptions: [
    'It is assumed that the Client will have desktops, laptops, mobiles or any other system with the latest browser version for the Management system to work on all the machines.',

    'The staff required to use the Management system should be educated enough to understand the basic functionalities of the Management system, in order to use the system successfully.'
  ],

  exclusions: [
    'Any module which is not mentioned above in the Project Scope Definition.',

    'Any additional training that is required other than the mentioned above in the Project Scope Definition.'
  ]
};


// ============================================================================
// EMPTY DATABASE
// ============================================================================

const EMPTY = {
  users: [],

  leads: [],

  activity: [],

  quotations: [],

  loginLogs: [],

  settings: {
    revenueGoal: 100000,

    commissionBase: 'cash',

    inactivityTimeoutMinutes: 30,

    quotationDefaults:
      DEFAULT_QUOTATION_DEFAULTS
  },

  sessions: []
};


// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

let cache = JSON.parse(
  JSON.stringify(EMPTY)
);


// Track IDs that existed in Firestore
// during the last successful load/persist.
const lastKnownIds = {};

const lastKnownData = {};

let lastKnownSettings = null;

for (const collection of ARRAY_COLLECTIONS) {
    lastKnownIds[collection] = new Set();
    lastKnownData[collection] = new Map();
}


// ============================================================================
// LOAD FIRESTORE → MEMORY
// ============================================================================

async function load() {
  console.log(
    'Firestore: starting database load...'
  );

  for (const collection of ARRAY_COLLECTIONS) {
    console.log(
      `Firestore: loading ${collection}...`
    );

    const snapshot = await firestore
      .collection(collection)
      .get();

    const rows = [];

    const ids = new Set();

    snapshot.forEach(doc => {
      rows.push({
        id: doc.id,
        ...doc.data()
      });

      ids.add(doc.id);
    });

    cache[collection] = rows;

    lastKnownIds[collection] = ids;

    const snapshotData = new Map();

for (const row of rows) {
    snapshotData.set(
        row.id,
        JSON.parse(JSON.stringify(row))
    );
}

lastKnownData[collection] = snapshotData;
    console.log(
      `Firestore: ${collection} loaded (${rows.length} records)`
    );
  }


  // --------------------------------------------------------------------------
  // SETTINGS
  // --------------------------------------------------------------------------

  console.log(
    'Firestore: loading settings...'
  );

  const settingsSnapshot =
    await SETTINGS_DOC.get();

  if (settingsSnapshot.exists) {
    cache.settings = {
      ...JSON.parse(
        JSON.stringify(EMPTY.settings)
      ),
      ...settingsSnapshot.data()
    };
  } else {
    cache.settings = JSON.parse(
      JSON.stringify(EMPTY.settings)
    );
  }

  if (
    !cache.settings.quotationDefaults
  ) {
    cache.settings.quotationDefaults =
      JSON.parse(
        JSON.stringify(
          DEFAULT_QUOTATION_DEFAULTS
        )
      );
  }

  if (
    !cache.settings.inactivityTimeoutMinutes ||
    Number(
      cache.settings.inactivityTimeoutMinutes
    ) < 1
  ) {
    cache.settings.inactivityTimeoutMinutes = 30;
  }

  lastKnownSettings = JSON.parse(
  JSON.stringify(cache.settings)
);
  console.log(
    'Firestore: database load completed.'
  );
}


// ============================================================================
// PERSIST MEMORY → FIRESTORE
// ============================================================================
 async function persist() {
  console.log('Firestore: checking for changes...');

  const operations = [];

  for (const collection of ARRAY_COLLECTIONS) {
    const rows = cache[collection] || [];

    const currentIds = new Set();

    for (const row of rows) {
      if (!row || !row.id) {
        continue;
      }

      currentIds.add(row.id);

      const previous =
        lastKnownData[collection].get(row.id);

      // Only write if the document is new or changed.
      if (
        !previous ||
        JSON.stringify(previous) !== JSON.stringify(row)
      ) {
        const { id, ...data } = row;

        operations.push({
          type: 'set',
          ref: firestore
            .collection(collection)
            .doc(id),
          data
        });
      }
    }

    // Detect deletions.
    for (
      const oldId of lastKnownIds[collection]
    ) {
      if (!currentIds.has(oldId)) {
        operations.push({
          type: 'delete',
          ref: firestore
            .collection(collection)
            .doc(oldId)
        });
      }
    }

    // Update local snapshots.
    const newSnapshot = new Map();

    for (const row of rows) {
      if (row && row.id) {
        newSnapshot.set(
          row.id,
          JSON.parse(JSON.stringify(row))
        );
      }
    }

    lastKnownData[collection] = newSnapshot;
    lastKnownIds[collection] = currentIds;
  }

  // Settings
  if (
    JSON.stringify(cache.settings) !==
    JSON.stringify(lastKnownSettings)
  ) {
    operations.push({
      type: 'set',
      ref: SETTINGS_DOC,
      data: cache.settings
    });

    lastKnownSettings =
      JSON.parse(
        JSON.stringify(cache.settings)
      );
  }

  if (operations.length === 0) {
    console.log(
      'Firestore: no changes to persist.'
    );

    return;
  }

  const BATCH_SIZE = 450;

  for (
    let start = 0;
    start < operations.length;
    start += BATCH_SIZE
  ) {
    const chunk =
      operations.slice(
        start,
        start + BATCH_SIZE
      );

    const batch =
      firestore.batch();

    for (const operation of chunk) {
      if (
        operation.type === 'delete'
      ) {
        batch.delete(operation.ref);
      } else {
        batch.set(
          operation.ref,
          operation.data
        );
      }
    }

    await batch.commit();

    console.log(
      `Firestore: committed ${chunk.length} changes.`
    );
  }

  console.log(
    `Firestore: persist completed (${operations.length} changes).`
  );
}


// ============================================================================
// ID GENERATOR
// ============================================================================

function id(prefix) {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random()
      .toString(16)
      .slice(2, 10)
  );
}


// ============================================================================
// INITIAL DATABASE LOAD
// ============================================================================

let ready = load()
  .catch(err => {
    console.error(
      'Firestore: initial database load failed:',
      err
    );

    throw err;
  });


// ============================================================================
// PUBLIC INTERFACE
// ============================================================================

module.exports = {
  get raw() {
    return cache;
  },

  id,

  persist,

  reload: load,

  ready() {
    return ready;
  }
};
