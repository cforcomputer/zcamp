// new server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import axios from "axios";
import path from "path";
import cors from "cors";
import fs from "fs";
import session from "express-session";
import RedisStore from "connect-redis";
import { createClient as createRedisClient } from "redis";
import { hash, compare } from "bcrypt";
import { THRESHOLDS } from "../src/constants";
import pg from "pg";

import { ServerActivityManager } from "./serverActivityManager.js";

const { Pool } = pg;

class TaskQueue {
  constructor(concurrency = 50, name = "DefaultQueue") {
    // Added name for logging
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
    this.name = name; // Store the queue name
    this.processedCount = 0; // Track processed tasks
    this.lastLogTime = Date.now(); // For periodic status
    console.log(
      `[${this.name}] Initialized with concurrency ${this.concurrency}`
    );
  }

  _logStatus(force = false) {
    const now = Date.now();
    // Log roughly every 10 seconds or if forced
    if (force || now - this.lastLogTime > 10000) {
      console.log(
        `[${this.name} Status] Running: ${this.running}, Waiting: ${this.queue.length}, Processed: ${this.processedCount}`
      );
      this.lastLogTime = now;
    }
  }

  async enqueue(task, taskId = null) {
    // Added optional taskId for better logging
    const internalTaskId =
      taskId ||
      `Task_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;
    console.log(
      `[${this.name}] Enqueuing task ${internalTaskId}. Queue size: ${
        this.queue.length + 1
      }, Running: ${this.running}`
    );
    this._logStatus(); // Log status on enqueue
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject,
        internalTaskId, // Store ID with the task
      });
      this.runNext();
    });
  }

  async runNext() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      // Log only if we are blocked by concurrency limit but have waiting tasks
      if (this.running >= this.concurrency && this.queue.length > 0) {
        // console.log(`[${this.name}] Concurrency limit reached (${this.running}/${this.concurrency}). Waiting tasks: ${this.queue.length}`);
        this._logStatus(); // Log status when blocked
      }
      return;
    }

    const { task, resolve, reject, internalTaskId } = this.queue.shift();
    this.running++;
    const taskStartTime = performance.now();
    console.log(
      `[${this.name}] Starting task ${internalTaskId}. Running: ${this.running}, Waiting: ${this.queue.length}`
    );
    this._logStatus(); // Log status on start

    try {
      const result = await task(); // Execute the actual task
      resolve(result);
      const taskEndTime = performance.now();
      console.log(
        `[${
          this.name
        }] Task ${internalTaskId} completed successfully. Duration: ${(
          taskEndTime - taskStartTime
        ).toFixed(2)}ms`
      );
    } catch (error) {
      const taskEndTime = performance.now();
      console.error(
        `[${this.name}] Task ${internalTaskId} failed. Duration: ${(
          taskEndTime - taskStartTime
        ).toFixed(2)}ms`,
        error
      );
      reject(error);
    } finally {
      this.running--;
      this.processedCount++;
      console.log(
        `[${this.name}] Finished task ${internalTaskId}. Running: ${this.running}, Waiting: ${this.queue.length}`
      );
      this._logStatus(true); // Force log status on completion
      this.runNext(); // Try to run the next task
    }
  }
}

// Caches for common items
const MAX_SHIP_CACHE_SIZE = 2000;
const shipTypeCache = new Map();

const killmailProcessingQueue = new TaskQueue(50, "KillmailQueue"); // simultaneous processing tasks for kms

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.PUBLIC_URL || "https://where.zcamp.lol",
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: true,
  path: "/socket.io/",
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: {
    name: "io",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  },
});

// Make sure these are set before creating the server
app.set("trust proxy", true);
app.enable("trust proxy");
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY;
axios.defaults.baseURL = "http://localhost:" + process.env.PORT;

const MIME_TYPES = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const REDIS_CONFIG = {
  development: {
    url: "redis://localhost:6379",
    prefix: "km_dev:", // Will result in km_dev:sess:sessionID
  },
  production: {
    url: process.env.REDIS_URL,
    prefix: "km_prod:", // Will result in km_prod:sess:sessionID
  },
};
// Initialize Redis client
const redisConfig = REDIS_CONFIG[process.env.NODE_ENV || "development"];
const redisClient = createRedisClient({
  url: redisConfig.url,
});
redisClient.connect().catch(console.error);

io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Express middleware
app.use(express.json());

// Allow cross origin requests
app.use(
  cors({
    origin: process.env.PUBLIC_URL || "http://localhost:8080",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, "../public")));

// Ensure build directory exists
const buildPath = path.join(__dirname, "../public/build");
if (!fs.existsSync(buildPath)) {
  fs.mkdirSync(buildPath, { recursive: true });
}

const audioPath = path.join(__dirname, "../public/build/audio_files");
if (!fs.existsSync(audioPath)) {
  fs.mkdirSync(audioPath, { recursive: true });
}

// Send public url configuration to client (this is not necessary if we switch to vite)
app.get("/", (req, res) => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "../public/index.html"),
    "utf8"
  );
  const rendered = indexHtml.replace(
    "{{PUBLIC_URL}}",
    process.env.PUBLIC_URL || `http://${req.headers.host}`
  );
  res.send(rendered);
});

const REDISQ_URL =
  "https://redisq.zkillboard.com/listen.php?queueID=zcamp&ttw=1";
let killmails = [];
let isDatabaseInitialized = false;

// --- Globals ---
let systemConnectivity = new Map(); // Key: systemId (string), Value: Set<string> (neighbor systemIds)
let stargateDestinationMap = new Map(); // Key: stargateItemId (string), Value: destinationSystemId (string) - RESTORED
let regionNameCache = new Map(); // Key: regionId (string), Value: regionName (string)
let systemIdToNameMap = new Map();
let marketGroupInfo = new Map();

/**
 * Downloads market group data from the SDE URL during startup and builds
 * an in-memory map for quick parent lookups and name retrieval.
 */
async function buildMarketGroupHierarchyCache() {
  console.log(
    "[Market Group Cache] Building hierarchy by downloading from SDE URL..."
  );
  const tempMarketInfo = new Map();
  const marketGroupsUrl = "https://sde.zzeve.com/invMarketGroups.json"; // URL for the data

  try {
    console.log(
      `[Market Group Cache] Fetching data from ${marketGroupsUrl}...`
    );

    // Use axios to download the file content
    const response = await axios.get(marketGroupsUrl, {
      timeout: 30000, // Add a reasonable timeout (e.g., 30 seconds)
      // Optional: Add headers if needed, e.g., User-Agent
      // headers: { 'User-Agent': 'YourAppName/Version (Contact Info)' }
    });

    // Check if the request was successful and data exists
    if (response.status !== 200 || !response.data) {
      throw new Error(
        `Failed to download market groups. Status: ${response.status}`
      );
    }

    // Axios automatically parses JSON response by default
    const marketGroupsData = response.data;

    if (!Array.isArray(marketGroupsData)) {
      throw new Error(
        "Invalid format: Downloaded market group data should be an array."
      );
    }

    console.log(
      `[Market Group Cache] Download successful. Processing ${marketGroupsData.length} entries...`
    );
    let count = 0;
    marketGroupsData.forEach((group) => {
      // Ensure marketGroupID exists and is a number before adding
      if (
        group.marketGroupID != null &&
        typeof group.marketGroupID === "number"
      ) {
        tempMarketInfo.set(group.marketGroupID, {
          parentId: group.parentGroupID ?? null, // Use nullish coalescing for null parent
          name: group.marketGroupName || "Unknown Group",
        });
        count++;
      } else {
        console.warn(
          "[Market Group Cache] Skipping group with missing or invalid marketGroupID:",
          group
        );
      }
    });

    marketGroupInfo = tempMarketInfo; // Assign to global map *after* successful loading
    console.log(
      `[Market Group Cache] Successfully loaded ${marketGroupInfo.size} market groups into cache.`
    );
  } catch (error) {
    console.error(
      "[Market Group Cache] CRITICAL: Failed to download or parse market groups from URL:",
      {
        url: marketGroupsUrl,
        message: error.message,
        // Log Axios specific details if available
        axiosError: error.isAxiosError
          ? {
              status: error.response?.status,
              data: error.response?.data
                ? String(error.response.data).substring(0, 200) + "..."
                : undefined, // Log snippet of data
            }
          : undefined,
        stack: error.stack, // Include stack trace for debugging
      }
    );
    // Keep the map empty to indicate failure
    marketGroupInfo = tempMarketInfo; // Assign empty map on error

    // Decide if server startup should fail if this critical data cannot be loaded.
    // It's often better to fail fast if essential data is missing.
    // throw new Error("Failed to build market group hierarchy cache. Server cannot start.");
    // Or allow startup with degraded functionality (unknown categories) - current behaviour.
  }
}

/**
 * Builds the system connectivity map using direct jump data from an external JSON source,
 * and also populates caches for region names and system ID-to-name mappings.
 */
async function buildSystemConnectivityMap() {
  console.log(
    "[Map Build] Building System Connectivity, Region Cache, and ID->Name Map using JSON Jumps..."
  );
  const tempConnectivity = new Map(); // Key: string systemId, Value: Set<string> neighbor IDs
  const tempRegionCache = new Map(); // Key: string regionId (itemID for type=3), Value: string name
  const tempSystemIdToNameMap = new Map(); // Key: string systemId (itemID for type=5), Value: string name
  let client = null;

  try {
    // --- Database Connection ---
    console.log("[Map Build] Attempting to connect to DB...");
    client = await pool.connect();
    console.log("[Map Build] DB client connected successfully.");

    // --- Step 1: Get Valid Systems (ID and Name) ---
    console.log(
      "[Map Build] Fetching valid system IDs and Names (typeID=5 using itemID)..."
    );
    const systemsQuery = `SELECT itemID, itemName FROM map_denormalize WHERE typeID = 5 AND itemID IS NOT NULL AND itemName IS NOT NULL`;
    let systemRows = [];
    try {
      const { rows } = await client.query(systemsQuery);
      systemRows = rows;
      console.log(
        `[Map Build] Query for typeID=5 systems returned ${
          systemRows?.length ?? "undefined"
        } rows.`
      );
    } catch (systemsQueryError) {
      console.error(
        "[Map Build] CRITICAL: Error executing system ID/Name query:",
        systemsQueryError
      );
      if (client) {
        try {
          await client.release();
        } catch (e) {}
      }
      return; // Cannot proceed without system list
    }

    if (!systemRows || systemRows.length === 0) {
      console.error(
        "[Map Build] CRITICAL: No valid system entries (typeID=5) found in database. Cannot build maps."
      );
      if (client) {
        try {
          await client.release();
        } catch (e) {}
      }
      return; // Cannot proceed
    }

    // Initialize connectivity map AND build ID->Name map
    systemRows.forEach((row) => {
      const systemIdStr = String(row.itemid);
      const systemName = row.itemname;
      // Initialize connectivity
      if (!tempConnectivity.has(systemIdStr)) {
        tempConnectivity.set(systemIdStr, new Set());
      }
      // Add to ID->Name map
      tempSystemIdToNameMap.set(systemIdStr, systemName);
    });
    console.log(
      `[Map Build] Initialized connectivity map for ${tempConnectivity.size} systems.`
    );
    console.log(
      `[Map Build] Built System ID->Name map with ${tempSystemIdToNameMap.size} entries.`
    );

    // --- Step 2: Build Region Name Cache ---
    try {
      console.log(
        "[Map Build] Building Region Name Cache (typeID=3 using itemID)..."
      );
      // Use the corrected query selecting itemID for regions
      const regionsQuery = `SELECT itemID, itemName FROM map_denormalize WHERE typeID = 3 AND itemID IS NOT NULL AND itemName IS NOT NULL`;
      const { rows: regionRows } = await client.query(regionsQuery);

      regionRows.forEach((row) => {
        // Use itemID (as string) as key, itemName as value
        tempRegionCache.set(String(row.itemid), row.itemname);
      });
      console.log(
        `[Map Build] Built region cache with ${tempRegionCache.size} entries.`
      );
      if (tempRegionCache.size === 0) {
        console.warn(
          "[Map Build] WARNING: Region cache is empty. Region name lookups will fail."
        );
      }
    } catch (regionCacheError) {
      console.error(
        "[Map Build] Error building region cache:",
        regionCacheError
      );
      // Continue without region cache, but log the error
      tempRegionCache.clear(); // Ensure cache is empty on error
    }

    // --- Step 3: Fetch the Jumps JSON data ---
    const jumpsUrl = "https://sde.zzeve.com/mapSolarSystemJumps.json";
    let jumpsData = [];
    try {
      console.log(`[Map Build] Fetching jump data from ${jumpsUrl}...`);
      const response = await fetch(jumpsUrl);
      if (!response.ok) {
        // Log specific status for easier debugging
        throw new Error(
          `HTTP error ${response.status} fetching ${jumpsUrl}: ${response.statusText}`
        );
      }
      jumpsData = await response.json();
      console.log(`[Map Build] Fetched ${jumpsData.length} jump entries.`);
    } catch (fetchError) {
      console.error(
        "[Map Build] CRITICAL: Failed to fetch or parse jump data:",
        fetchError
      );
      if (client) {
        try {
          await client.release();
        } catch (e) {}
      }
      return; // Cannot build connectivity without jump data
    }

    // --- Step 4: Process the Jumps Data ---
    let linksAddedCount = 0;
    let invalidJumps = 0;
    const processedLinkPairs = new Set();

    jumpsData.forEach((jump) => {
      const fromId = String(jump.fromSolarSystemID);
      const toId = String(jump.toSolarSystemID);

      // Validate that BOTH systems exist in our connectivity map (initialized from DB systems)
      if (tempConnectivity.has(fromId) && tempConnectivity.has(toId)) {
        // Add the bidirectional link
        tempConnectivity.get(fromId).add(toId);
        tempConnectivity.get(toId).add(fromId);

        // Count unique links added
        const linkId = [fromId, toId].sort().join("-");
        if (!processedLinkPairs.has(linkId)) {
          linksAddedCount++;
          processedLinkPairs.add(linkId);
        }
      } else {
        invalidJumps++;
        // Optional: More detailed logging for skipped jumps
        // if (!tempConnectivity.has(fromId)) console.warn(`[Map Build] Skipping jump: Source system ${fromId} not found in DB systems.`);
        // if (!tempConnectivity.has(toId)) console.warn(`[Map Build] Skipping jump: Target system ${toId} not found in DB systems.`);
      }
    }); // End forEach jump

    console.log(
      `[Map Build] Processed jump data. Added ${linksAddedCount} unique links.`
    );
    if (invalidJumps > 0) {
      console.warn(
        `[Map Build] Skipped ${invalidJumps} jumps involving systems not found in initial DB query.`
      );
    }

    // --- Step 5: Assign Globals ---
    systemConnectivity = tempConnectivity;
    regionNameCache = tempRegionCache;
    systemIdToNameMap = tempSystemIdToNameMap;
    stargateDestinationMap.clear(); // Ensure this is cleared as it's unused

    console.log(
      `[Map Build] Finished building maps. Connectivity: ${systemConnectivity.size} systems, Regions: ${regionNameCache.size}, SysNames: ${systemIdToNameMap.size}.`
    );
  } catch (error) {
    // Catch any unexpected errors during the process
    console.error(
      "[Map Build] FATAL: Unexpected error during map building:",
      error
    );
    // Clear maps to indicate failure state
    systemConnectivity.clear();
    regionNameCache.clear();
    systemIdToNameMap.clear();
    stargateDestinationMap.clear();
  } finally {
    // Ensure the client is always released
    if (client) {
      try {
        await client.release();
        console.log("[Map Build] DB Client released.");
      } catch (releaseError) {
        console.error("[Map Build] Error releasing DB client:", releaseError);
      }
    } else {
      console.log(
        "[Map Build] No DB client to release (connection likely failed)."
      );
    }
  }
}

/**
 * Finds systems within a specified number of jumps from a starting system.
 * @param {string | number} startSystemId - The ID of the starting system.
 * @param {number} [maxJumps=2] - The maximum number of jumps to explore (0, 1, or 2).
 * @returns {{0: string[], 1: string[], 2: string[]}} - Object containing arrays of system IDs at each jump distance.
 */
function getNearbySystems(startSystemId, maxJumps = 2) {
  const startIdStr = String(startSystemId);
  const nearby = {
    0: [startIdStr], // Systems 0 jumps away (itself)
    1: [], // Systems 1 jump away
    2: [], // Systems 2 jumps away
  };
  const visited = new Set([startIdStr]); // Keep track of visited systems
  const queue = [{ systemId: startIdStr, jumps: 0 }]; // Queue for Breadth-First Search

  if (!systemConnectivity.has(startIdStr)) {
    console.warn(
      `[getNearbySystems] Start system ${startIdStr} not found in connectivity map.`
    );
    return nearby; // Return just the start system
  }

  while (queue.length > 0) {
    const { systemId: currentId, jumps } = queue.shift();

    if (jumps >= maxJumps) {
      continue; // Don't explore further than maxJumps
    }

    const neighbors = systemConnectivity.get(currentId) || new Set();

    neighbors.forEach((neighborId) => {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        const nextJumps = jumps + 1;
        if (nextJumps <= maxJumps) {
          // Add to the correct jump list if within maxJumps
          if (nearby[nextJumps]) {
            // Check if the jump level exists
            nearby[nextJumps].push(neighborId);
          }
          // Add to queue to explore its neighbors
          queue.push({ systemId: neighborId, jumps: nextJumps });
        }
      }
    });
  }

  return nearby;
}

// const db = createSqlClient({
//   url: process.env.LIBSQL_URL || "file:zcamp.db",
//   authToken: process.env.LIBSQL_AUTH_TOKEN,
// });

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  native: false,
});

const serverActivityManager = new ServerActivityManager(io, pool);

// Start the manager update intervals
serverActivityManager.startUpdates();

// Initialize Redis store
const redisStore = new RedisStore({
  client: redisClient,
  prefix: redisConfig.prefix + "sess:",
  ttl: 86400, // 24 hours in seconds
  disableTouch: false,
  disableTTL: false,
  cleanup: {
    interval: 3600, // Run cleanup every hour
  },
});

// Session middleware configuration
const sessionMiddleware = session({
  store: redisStore,
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  name: "km_sid",
  cookie: {
    secure: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: "lax",
    domain:
      process.env.NODE_ENV === "production"
        ? new URL(PUBLIC_URL).hostname
        : undefined,
    path: "/",
  },
  proxy: true,
});
app.use(sessionMiddleware);
app.set("trust proxy", 1);

// Share session middleware with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

async function saveState(state) {
  await redisClient.set(
    `${redisConfig.prefix}state:${state}`,
    JSON.stringify({ timestamp: Date.now() }),
    { EX: 300 } // Expire after 5 minutes
  );
}

async function getState(state) {
  const stateData = await redisClient.get(
    `${redisConfig.prefix}state:${state}`
  );
  return stateData ? JSON.parse(stateData) : null;
}

// SSO configuration
const EVE_SSO_CONFIG = {
  client_id: process.env.EVE_CLIENT_ID,
  client_secret: process.env.EVE_CLIENT_SECRET,
  callback_url:
    process.env.EVE_CALLBACK_URL || "http://localhost:3000/callback/",
};

if (!EVE_SSO_CONFIG.client_id || !EVE_SSO_CONFIG.client_secret) {
  console.error("EVE SSO credentials not found in environment variables");
  process.exit(1);
}

// Database setup
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Users table - Cleaned whitespace
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE,
        password TEXT,
        settings TEXT,
        character_id TEXT UNIQUE,
        character_name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry INTEGER,
        bashbucks INTEGER DEFAULT 0
      );
    `); // Ensure no non-standard spaces/chars here

    // Ensure users.bashbucks exists (using ALTER TABLE) - Cleaned whitespace
    try {
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS bashbucks INTEGER DEFAULT 0;
      `); // Ensure no non-standard spaces/chars here
      console.log("Ensured 'bashbucks' column exists in 'users'.");
    } catch (alterErr) {
      if (alterErr.code !== "42701") {
        // Ignore "duplicate column" error
        console.error(
          "Error attempting to add 'bashbucks' column to users:",
          alterErr
        );
        throw alterErr;
      } else {
        console.log("'bashbucks' column likely already exists in users.");
      }
    }

    // Duplicate killmails check table
    await client.query(`
      CREATE TABLE IF NOT EXISTS processed_kill_ids (
        kill_id INTEGER PRIMARY KEY,
        processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_processed_kill_ids_time ON processed_kill_ids(processed_at);`
    );
    console.log("Ensured 'processed_kill_ids' table exists.");

    // Add index for users table - Cleaned whitespace
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_character_id ON users(character_id);` // Ensure no non-standard spaces/chars here
    );

    // Camp Crushers table (Remove bashbucks) - Cleaned whitespace
    await client.query(`
      CREATE TABLE IF NOT EXISTS camp_crushers (
        id SERIAL PRIMARY KEY,
        character_id TEXT NOT NULL UNIQUE,
        character_name TEXT NOT NULL
      );
    `); // Ensure no non-standard spaces/chars here

    // Remove camp_crushers.bashbucks column if it exists (using ALTER TABLE) - Cleaned whitespace
    try {
      await client.query(`
          ALTER TABLE camp_crushers
          DROP COLUMN IF EXISTS bashbucks;
        `); // Ensure no non-standard spaces/chars here
      console.log(
        "Removed 'bashbucks' column from 'camp_crushers' if it existed."
      );
    } catch (alterErr) {
      console.error(
        "Error attempting to drop 'bashbucks' column from camp_crushers:",
        alterErr
      );
      if (alterErr.code !== "42703") {
        // Ignore "column does not exist"
        console.warn(
          "Non-critical error dropping bashbucks from camp_crushers:",
          alterErr.message
        );
      } else {
        console.log(
          "'bashbucks' column likely did not exist in camp_crushers."
        );
      }
    }

    // Add index for camp_crushers table - Cleaned whitespace
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_camp_crushers_character_id ON camp_crushers(character_id);` // Ensure no non-standard spaces/chars here
    );

    // Camp Crusher Targets table (including target_character_id) - Cleaned whitespace
    await client.query(`
      CREATE TABLE IF NOT EXISTS camp_crusher_targets (
        id SERIAL PRIMARY KEY,
        character_id TEXT NOT NULL,
        target_character_id TEXT,
        camp_id TEXT NOT NULL,
        system_id INTEGER,
        stargate_name TEXT,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        FOREIGN KEY(character_id) REFERENCES users(character_id) ON DELETE CASCADE
      );
    `); // Ensure no non-standard spaces/chars here

    // Ensure camp_crusher_targets.target_character_id exists (using ALTER TABLE) - Cleaned whitespace
    try {
      await client.query(`
        ALTER TABLE camp_crusher_targets
        ADD COLUMN IF NOT EXISTS target_character_id TEXT;
      `); // Ensure no non-standard spaces/chars here
      console.log(
        "Ensured 'target_character_id' column exists in 'camp_crusher_targets'."
      );
    } catch (alterErr) {
      if (alterErr.code !== "42701") {
        console.error(
          "Error attempting to add 'target_character_id' column:",
          alterErr
        );
        throw alterErr;
      } else {
        console.log("'target_character_id' column likely already exists.");
      }
    }

    // Add indexes for camp_crusher_targets table - Cleaned whitespace
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_camp_crusher_targets_character_id ON camp_crusher_targets(character_id);` // Ensure no non-standard spaces/chars here
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_camp_crusher_targets_lookup ON camp_crusher_targets(target_character_id, completed);` // Ensure no non-standard spaces/chars here
    );

    // --- Other Tables (Assuming standard whitespace) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS filter_lists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT,
        ids TEXT,
        enabled INTEGER,
        is_exclude INTEGER,
        filter_type TEXT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT,
        settings TEXT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS celestial_data (
        system_id INTEGER PRIMARY KEY,
        system_name TEXT,
        celestial_data TEXT,
        last_updated TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ship_types (
        ship_type_id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT,
        tier TEXT,
        last_updated TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pinned_systems (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        system_id INTEGER NOT NULL,
        stargate_name VARCHAR(255) NOT NULL,
        system_name VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, system_id, stargate_name)
      );
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_pinned_systems_user_id ON pinned_systems(user_id);`
    );
    try {
      await client.query(`
        ALTER TABLE pinned_systems
        ADD COLUMN IF NOT EXISTS system_name VARCHAR(255);
      `);
      console.log("Ensured 'system_name' column exists in 'pinned_systems'.");
    } catch (alterErr) {
      if (alterErr.code !== "42701") {
        // Ignore "duplicate column" error (already exists)
        console.error(
          "Error attempting to add 'system_name' column to pinned_systems:",
          alterErr
        );
        // Decide if you want to throw the error or just log it
        // throw alterErr;
      } else {
        console.log(
          "'system_name' column likely already exists in pinned_systems."
        );
      }
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS expired_camps (
        id SERIAL PRIMARY KEY,
        camp_unique_id TEXT UNIQUE NOT NULL,
        system_id INTEGER NOT NULL,
        stargate_name TEXT NOT NULL,
        max_probability INTEGER,
        camp_start_time TIMESTAMP,
        last_kill_time TIMESTAMP NOT NULL,
        camp_end_time TIMESTAMP,
        processing_time TIMESTAMP DEFAULT NOW(),
        total_value NUMERIC,
        camp_type TEXT,
        final_kill_count INTEGER,
        camp_details JSONB,
        classifier INTEGER DEFAULT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS map_denormalize (
        itemID INTEGER PRIMARY KEY,
        typeID INTEGER,
        groupID INTEGER,
        solarSystemID INTEGER,
        constellationID INTEGER,
        regionID INTEGER,
        orbitID INTEGER,
        x DOUBLE PRECISION,
        y DOUBLE PRECISION,
        z DOUBLE PRECISION,
        radius DOUBLE PRECISION,
        itemName TEXT,
        security DOUBLE PRECISION,
        celestialIndex INTEGER,
        orbitIndex INTEGER
      );
    `);

    console.log("Database tables ensured.");
  } catch (err) {
    console.error("Database initialization error:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function initializeMapData() {
  try {
    console.log("Initializing map data...");

    // Create table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS map_denormalize (
        itemID INTEGER PRIMARY KEY,
        typeID INTEGER,
        groupID INTEGER,
        solarSystemID INTEGER,
        constellationID INTEGER,
        regionID INTEGER,
        orbitID INTEGER,
        x DOUBLE PRECISION,
        y DOUBLE PRECISION,
        z DOUBLE PRECISION,
        radius DOUBLE PRECISION,
        itemName TEXT,
        security DOUBLE PRECISION,
        celestialIndex INTEGER,
        orbitIndex INTEGER
      )
    `);

    // Fetch the JSON data from the external source
    console.log(
      "Fetching map data from https://sde.zzeve.com/mapDenormalize.json"
    );
    const response = await axios.get(
      "https://sde.zzeve.com/mapDenormalize.json"
    );

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error("Invalid data format received from the source");
    }

    const mapData = response.data;
    console.log(`Fetched ${mapData.length} map entries`);

    // Process in batches for better performance
    const BATCH_SIZE = 500;
    for (let i = 0; i < mapData.length; i += BATCH_SIZE) {
      const batch = mapData.slice(i, i + BATCH_SIZE);

      // Build placeholders for batch insert
      const placeholders = batch
        .map((_, idx) => {
          const base = idx * 15 + 1;
          return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${
            base + 4
          }, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${
            base + 9
          }, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${
            base + 14
          })`;
        })
        .join(", ");

      const params = batch.flatMap((item) => [
        item.itemID,
        item.typeID,
        item.groupID,
        item.solarSystemID,
        item.constellationID,
        item.regionID,
        item.orbitID,
        item.x,
        item.y,
        item.z,
        item.radius,
        item.itemName,
        item.security,
        item.celestialIndex,
        item.orbitIndex,
      ]);

      await pool.query(
        `
        INSERT INTO map_denormalize (
          itemID, typeID, groupID, solarSystemID, constellationID, regionID, orbitID,
          x, y, z, radius, itemName, security, celestialIndex, orbitIndex
        ) VALUES ${placeholders}
        ON CONFLICT (itemID) DO UPDATE SET
          typeID = EXCLUDED.typeID,
          groupID = EXCLUDED.groupID,
          solarSystemID = EXCLUDED.solarSystemID,
          constellationID = EXCLUDED.constellationID,
          regionID = EXCLUDED.regionID,
          orbitID = EXCLUDED.orbitID,
          x = EXCLUDED.x,
          y = EXCLUDED.y,
          z = EXCLUDED.z,
          radius = EXCLUDED.radius,
          itemName = EXCLUDED.itemName,
          security = EXCLUDED.security,
          celestialIndex = EXCLUDED.celestialIndex,
          orbitIndex = EXCLUDED.orbitIndex
      `,
        params
      );

      console.log(
        `Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          mapData.length / BATCH_SIZE
        )}`
      );
    }

    console.log("Map data initialization complete");
  } catch (error) {
    console.error("Error initializing map data:", error);
    throw error;
  }
}

app.get("/api/nearby-systems/:systemId", (req, res) => {
  const systemId = req.params.systemId;
  const maxJumpsParam = req.query.jumps ? parseInt(req.query.jumps) : 2; // Allow specifying jumps via query param, default 2

  if (!systemId) {
    return res.status(400).json({ error: "System ID parameter is required." });
  }
  // Validate maxJumps to be reasonable (e.g., 0, 1, or 2 as per requirement)
  const maxJumps = Math.max(0, Math.min(2, maxJumpsParam));

  try {
    // Use the globally populated systemConnectivity map
    if (systemConnectivity.size === 0) {
      console.warn(
        "/api/nearby-systems: systemConnectivity map is empty. Was buildSystemConnectivityMap run?"
      );
      return res
        .status(503)
        .json({ error: "Connectivity data not available yet." });
    }

    const nearbyData = getNearbySystems(systemId, maxJumps);
    res.json(nearbyData);
  } catch (error) {
    console.error(`Error getting nearby systems for ${systemId}:`, error);
    res.status(500).json({ error: "Failed to calculate nearby systems." });
  }
});

// CLOUDFLARE
app.get("/api/turnstile-config", (req, res) => {
  res.json({ siteKey: process.env.TURNSTILE_SITE_KEY });
});

app.post("/api/verify-turnstile", async (req, res) => {
  const { token } = req.body;

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
      }),
    }
  );

  const data = await response.json();

  if (data.success) {
    // If verification is successful, emit requestInitialKillmails to the client's socket
    const clientSocket = io.sockets.sockets.get(req.headers["x-socket-id"]);
    if (clientSocket) {
      clientSocket.emit("turnstileVerified");
    }
  }

  res.json(data);
});

app.get("/api/route/:origin/:destination", async (req, res) => {
  const { origin, destination } = req.params;
  const flag = req.query.flag || "shortest"; // Default to shortest route

  // Validate IDs (simple integer check)
  const originId = parseInt(origin);
  const destinationId = parseInt(destination);

  if (isNaN(originId) || isNaN(destinationId)) {
    console.error(
      `[API Route] Invalid system IDs: origin=${origin}, destination=${destination}`
    );
    return res
      .status(400)
      .json({ error: "Invalid origin or destination system ID." });
  }

  const esiUrl = `https://esi.evetech.net/latest/route/${originId}/${destinationId}/`;
  const params = {
    datasource: "tranquility",
    flag: flag,
  };

  console.log(
    `[API Route] Proxying request to ESI: ${esiUrl} with params:`,
    params
  );

  try {
    // Use axios (already imported) for server-side request
    const esiResponse = await axios.get(esiUrl, {
      params: params,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache", // Request fresh data from ESI
        // ESI doesn't typically require User-Agent, but good practice
        "User-Agent": "KM-Hunter Application (Server Proxy)",
      },
      timeout: 15000, // Add a timeout (e.g., 15 seconds)
    });

    console.log(
      `[API Route] ESI responded with status ${esiResponse.status} for route ${originId}->${destinationId}`
    );
    // Axios puts data directly in response.data
    res.json(esiResponse.data);
  } catch (error) {
    const status = error.response?.status || 500;
    // Axios puts error details in error.response.data
    const message =
      error.response?.data?.error ||
      error.message ||
      "Failed to fetch route from ESI";
    console.error(
      `[API Route] Error fetching route from ESI (${status}): ${message}`
    );
    console.error(`[API Route] ESI URL was: ${esiUrl}`);
    console.error(`[API Route] ESI Params were:`, params);
    if (error.response) {
      console.error(`[API Route] ESI Response Data:`, error.response.data);
    } else {
      console.error(
        `[API Route] Axios error details:`,
        error.toJSON ? error.toJSON() : error
      );
    }

    // Send specific error status back to client
    res.status(status).json({ error: message });
  }
});

// Fetch trophy page data
app.get("/api/trophy/:characterId", async (req, res) => {
  const characterId = req.params.characterId;

  if (!characterId || isNaN(parseInt(characterId))) {
    return res.status(400).json({ error: "Invalid Character ID" });
  }

  try {
    // --- Fetch Character Name, Bashbucks, AND NEW Crushed Count ---
    const userQuery = `
        SELECT character_name, bashbucks, camps_crushed_count  -- Fetch new count
        FROM users
        WHERE character_id = $1
      `;
    const userResult = await pool.query(userQuery, [characterId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Character not found" });
    }
    const userData = userResult.rows[0];

    // --- Removed the old successfulAttacks query ---

    // --- Fetch Leaderboard Rank (Based on New Count) ---
    let rank = null; // Default to null if not found
    try {
      // Rank based primarily on camps_crushed_count, secondarily on bashbucks
      const leaderboardQuery = `
              SELECT
                  u.character_id
              FROM users u
              -- Optional: Only rank characters present in camp_crushers?
              -- JOIN camp_crushers cc ON cc.character_id = u.character_id
              ORDER BY
                  u.camps_crushed_count DESC, -- Primary sort: Higher crush count is better
                  u.bashbucks DESC           -- Secondary sort: Higher bashbucks breaks ties
          `;
      const leaderboardResult = await pool.query(leaderboardQuery);

      // Find the 0-based index (+1 for rank)
      const rankIndex = leaderboardResult.rows.findIndex(
        (player) => player.character_id === characterId
      );

      if (rankIndex !== -1) {
        rank = rankIndex + 1; // Rank is index + 1
      }
      console.log(
        `[API Trophy] Calculated rank ${rank} (based on camps_crushed_count) for character ${characterId}`
      );
    } catch (leaderboardError) {
      console.error(
        `[API Trophy] Error fetching leaderboard to determine rank for ${characterId}:`,
        leaderboardError
      );
      // Continue without rank if leaderboard fetch fails
    }
    // --- END: Leaderboard Fetch ---

    // --- Send Response ---
    res.json({
      characterName: userData.character_name,
      bashbucks: userData.bashbucks || 0,
      successfulAttacks: userData.camps_crushed_count || 0, // Use the new count column
      rank: rank, // Include the calculated rank
    });
  } catch (error) {
    console.error(
      `[API Trophy] Error fetching data for character ${characterId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

// This endpoint fetches map data from the database and returns it to the client
app.get("/api/map-data", async (req, res) => {
  try {
    console.log("API: Received request for map data");

    // Fetch ALL Region definitions (typeID=3)
    // Fetch only K-Space Systems (typeID=5 AND regionID < 11000000)
    // Fetch only K-Space Stargates (groupID=10 AND regionID < 11000000)
    const { rows } = await pool.query(`
          SELECT * FROM map_denormalize
          WHERE typeID = 3
             OR (typeID = 5 AND regionID < 11000000)
             OR (groupID = 10 AND regionID < 11000000)
      `);
    // --- END CORRECTED QUERY ---

    console.log(`API: Found ${rows.length} total map entries`);
    // These logs will now correctly reflect the number of regions found by the query
    console.log(
      `API: Regions: ${rows.filter((item) => item.typeid === 3).length}`
    );
    console.log(
      `API: Solar Systems: ${rows.filter((item) => item.typeid === 5).length}`
    );
    console.log(
      `API: Stargates: ${rows.filter((item) => item.groupid === 10).length}`
    );

    if (rows.length > 0) {
      // Find a sample that ISN'T a region if possible for better context
      const sampleEntry = rows.find((item) => item.typeid === 5) || rows[0];
      console.log("API: Sample entry:", sampleEntry);
    }

    res.json(rows);
  } catch (error) {
    console.error("Error fetching map data:", error);
    res.status(500).json({ error: "Failed to fetch map data" });
  }
});

// Get pinned systems for the current user
app.get("/api/pinned-systems", async (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM pinned_systems WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error("Error fetching pinned systems:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add a new pinned system
// Add a new pinned system
app.post("/api/pinned-systems", async (req, res) => {
  // 1. Authentication Check
  if (!req.session?.user?.id) {
    console.error(
      "[Pin System] Error: User not authenticated for POST /api/pinned-systems"
    );
    return res.status(401).json({ error: "Not authenticated" });
  }

  // 2. Extract Data from Request Body (including system_name)
  const { system_id, stargate_name, system_name } = req.body; // <-- Added system_name
  const userId = req.session.user.id;

  console.log(
    `[Pin System] Received request: userId=${userId}, systemId=${system_id}, gate=${stargate_name}, systemName=${system_name} (from client)`
  );

  // 3. Input Validation (including system_name)
  if (
    !system_id ||
    typeof system_id !== "number" ||
    !stargate_name ||
    typeof stargate_name !== "string" ||
    stargate_name.trim() === "" ||
    (system_name !== null && typeof system_name !== "string") || // Allow null, but if present must be string
    (typeof system_name === "string" && system_name.length > 255) // Optional: Length check
  ) {
    console.error(
      `[Pin System] Invalid input: system_id=${system_id} (type: ${typeof system_id}), stargate_name=${stargate_name} (type: ${typeof stargate_name}), system_name=${system_name} (type: ${typeof system_name})`
    );
    return res.status(400).json({
      error: "Missing or invalid system_id, stargate_name, or system_name",
    });
  }

  // 4. Use the system_name provided by the client directly
  const finalSystemName = system_name; // Use the validated name (could be null)

  // 5. Database Interaction
  try {
    console.log(
      `[Pin System] Attempting to insert/find pin using client-provided name: userId=${userId}, systemId=${system_id}, gate=${stargate_name}, systemName=${finalSystemName}`
    );

    // Attempt INSERT, returning the full row if successful
    const { rows: insertRows } = await pool.query(
      `INSERT INTO pinned_systems (user_id, system_id, stargate_name, system_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, system_id, stargate_name) DO NOTHING
       RETURNING id, user_id, system_id, stargate_name, system_name, created_at`, // <-- Return all columns
      [userId, system_id, stargate_name, finalSystemName] // <-- Use client-provided name
    );

    if (insertRows.length > 0) {
      // Pin was newly created, use the data returned from INSERT
      const newPin = insertRows[0];
      console.log("[Pin System] Pin created successfully:", newPin);

      // Emit update to user sockets (wrapped in try-catch)
      try {
        const userRoomId = userId.toString();
        console.log(
          `[Pin System] Emitting 'systemPinned' to room: ${userRoomId}`
        );
        io.to(userRoomId).emit("systemPinned", newPin); // Emit the complete pin data
      } catch (emitError) {
        console.error(
          `[Pin System] Error emitting 'systemPinned' after pin creation:`,
          emitError
        );
      }

      res.status(201).json(newPin); // Respond with the complete pin data (201 Created)
    } else {
      // Pin already existed (ON CONFLICT DO NOTHING was triggered)
      // Fetch the existing pin data to return it
      console.log(
        `[Pin System] Pin already exists for userId=${userId}, systemId=${system_id}, gate=${stargate_name}. Fetching existing.`
      );
      const { rows: existingRows } = await pool.query(
        `SELECT id, user_id, system_id, stargate_name, system_name, created_at
           FROM pinned_systems
           WHERE user_id = $1 AND system_id = $2 AND stargate_name = $3`,
        [userId, system_id, stargate_name]
      );

      if (existingRows.length > 0) {
        res.status(200).json(existingRows[0]); // Return existing pin data (200 OK)
      } else {
        // This case should ideally not happen if ON CONFLICT worked correctly
        console.error(
          "[Pin System] Conflict occurred but could not fetch existing pin."
        );
        res
          .status(409)
          .json({ message: "Pin already exists but could not be retrieved." }); // 409 Conflict
      }
    }
  } catch (error) {
    // Enhanced CATCH BLOCK
    console.error("--------------------------------------------------");
    console.error("[Pin System] !!! DATABASE ERROR in /api/pinned-systems !!!");
    console.error("Timestamp:", new Date().toISOString());
    console.error("Request Body:", req.body);
    console.error("User Session ID:", req.session?.user?.id);
    console.error("Error Message:", error.message);
    console.error("Error Code:", error.code); // Log specific DB error code if available
    console.error("Error Detail:", error.detail); // Log specific DB error details if available
    console.error("Error Stack Trace:", error.stack);
    console.error("--------------------------------------------------");

    // Send a generic 500 response, log details server-side
    res.status(500).json({
      error:
        "Server error while pinning system. Check server logs for details.",
    });
  }
});

// Delete a pinned system
app.delete("/api/pinned-systems/:id", async (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const id = req.params.id;
  try {
    const { rows } = await pool.query(
      "DELETE FROM pinned_systems WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, req.session.user.id]
    );

    if (rows.length > 0) {
      // Notify connected clients
      io.to(req.session.user.id.toString()).emit("systemUnpinned", {
        id: rows[0].id,
      });

      res.json({ success: true, id: rows[0].id });
    } else {
      res.status(404).json({ error: "Pinned system not found" });
    }
  } catch (error) {
    console.error("Error unpinning system:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// CAMPCRUSHERS API
app.get("/api/campcrushers/stats", async (req, res) => {
  if (!req.session?.user?.character_id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const sessionCharacterId = req.session.user.character_id;
  const sessionCharacterName = req.session.user.character_name; // Get name from session

  try {
    // --- MODIFIED QUERY ---
    // Check if player is in camp_crushers AND fetch bashbucks from users table
    const query = `
      SELECT
        cc.character_id,
        u.bashbucks
      FROM camp_crushers cc
      JOIN users u ON cc.character_id = u.character_id
      WHERE cc.character_id = $1
    `;
    const { rows } = await pool.query(query, [sessionCharacterId]);
    // --- END MODIFIED QUERY ---

    if (rows.length === 0) {
      // User exists in session (and presumably 'users' table), but not in 'camp_crushers'.
      // Initialize them in camp_crushers (without bashbucks).
      console.log(
        `Initializing character ${sessionCharacterId} in camp_crushers.`
      );
      await pool.query(
        // --- MODIFIED INSERT (Removed bashbucks) ---
        "INSERT INTO camp_crushers (character_id, character_name) VALUES ($1, $2) ON CONFLICT (character_id) DO NOTHING",
        [sessionCharacterId, sessionCharacterName] // Use name from session
        // --- END MODIFIED INSERT ---
      );

      // Since they were just initialized or their stats weren't joined, fetch bashbucks directly from users table
      const userBashbucksQuery = await pool.query(
        "SELECT bashbucks FROM users WHERE character_id = $1",
        [sessionCharacterId]
      );
      const userBashbucks = userBashbucksQuery.rows[0]?.bashbucks || 0;

      return res.json({ bashbucks: userBashbucks });
    }

    // User found in both tables, return bashbucks from users table result
    return res.json({ bashbucks: rows[0].bashbucks || 0 });
  } catch (error) {
    console.error("Error fetching camp crusher stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) {
          console.error("Error destroying session:", err);
          reject(err);
          return;
        }
        resolve();
      });
    });

    // Clear the session cookie by setting it to expire in the past
    res.clearCookie("km_sid", {
      expires: new Date(0),
      path: "/",
      domain:
        process.env.NODE_ENV === "production"
          ? new URL(PUBLIC_URL).hostname
          : undefined,
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ success: false, message: "Error during logout" });
  }
});

app.post("/api/campcrushers/target", async (req, res) => {
  if (!req.session?.user?.character_id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { campId, systemId, stargateName } = req.body;
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour

  try {
    // Check for existing active target
    const { rows } = await pool.query(
      `SELECT id FROM camp_crusher_targets 
       WHERE character_id = $1 AND completed = FALSE 
       AND end_time > CURRENT_TIMESTAMP`,
      [req.session.user.character_id]
    );

    if (rows.length > 0) {
      return res.status(400).json({ error: "Active target already exists" });
    }

    // Create new target with more camp details
    await pool.query(
      `INSERT INTO camp_crusher_targets 
       (character_id, camp_id, system_id, stargate_name, start_time, end_time) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.session.user.character_id,
        campId,
        systemId,
        stargateName,
        startTime,
        endTime,
      ]
    );

    res.json({ success: true, endTime });
  } catch (error) {
    console.error("Error setting camp crusher target:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/campcrushers/leaderboard", async (req, res) => {
  try {
    // --- MODIFIED QUERY ---
    // Join users table, get bashbucks & camps_crushed_count, order by crushes
    const query = `
        SELECT
            cc.character_id,          -- ID from camp_crushers table (participants)
            cc.character_name,        -- Name from camp_crushers table
            u.bashbucks,              -- Bashbucks from users table
            u.camps_crushed_count     -- NEW crush count from users table
            -- Keep LATERAL JOIN if you want to display current target on leaderboard UI
            , current_target.camp_id AS target_camp_id
            , current_target.start_time AS target_start_time
        FROM
            camp_crushers cc          -- Start from participants table
        JOIN users u ON cc.character_id = u.character_id -- Join users to get stats
        LEFT JOIN LATERAL (           -- Optional: To show current target
            SELECT cct.camp_id, cct.start_time
            FROM camp_crusher_targets cct
            WHERE cct.character_id = cc.character_id
              AND cct.completed = FALSE
              AND cct.end_time > CURRENT_TIMESTAMP
            ORDER BY cct.start_time DESC
            LIMIT 1
        ) current_target ON true
        ORDER BY
            u.camps_crushed_count DESC, -- Order primarily by new crush count
            u.bashbucks DESC           -- Secondary sort by bashbucks
      `;
    const { rows } = await pool.query(query);
    // --- END MODIFIED QUERY ---

    if (!rows || !Array.isArray(rows)) {
      return res.json([]);
    }

    // Map to the format our frontend expects
    const leaderboard = rows.map((player) => ({
      character_id: player.character_id,
      character_name: player.character_name,
      bashbucks: player.bashbucks || 0,
      target_camp_id: player.target_camp_id, // Include if LATERAL JOIN kept
      target_start_time: player.target_start_time, // Include if LATERAL JOIN kept
      total_camps_crushed: player.camps_crushed_count || 0, // USE THE VALUE FROM DB
      recent_crushes: [], // Keep as placeholder for now
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error("[Leaderboard] Error fetching leaderboard:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

app.get("/health", async (_, res) => {
  try {
    if (!isDatabaseInitialized) {
      return res.status(503).json({
        status: "initializing",
        killmails: killmails.length,
        lastPoll: new Date().toISOString(),
      });
    }

    const result = await pool.query("SELECT 1 as health_check");
    if (result.rows?.[0]?.health_check === 1) {
      return res.status(200).json({
        status: "healthy",
        killmails: killmails.length,
        lastPoll: new Date().toISOString(),
        redisConnected: redisClient.isReady,
        socketConnections: io.engine.clientsCount,
        memoryUsage: {
          ...process.memoryUsage(),
          formattedHeapUsed: `${Math.round(
            process.memoryUsage().heapUsed / 1024 / 1024
          )}MB`,
        },
        cache: {
          killmailsLast6h: killmails.filter(
            // Changed from 24h to 6h
            (km) =>
              new Date(km.killmail.killmail_time) >
              new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours instead of 24
          ).length,
          killmailsLast2h: killmails.filter(
            (km) =>
              new Date(km.killmail.killmail_time) >
              new Date(Date.now() - 2 * 60 * 60 * 1000)
          ).length,
          oldestKillmail:
            killmails.length > 0
              ? Math.min(
                  ...killmails.map((km) =>
                    new Date(km.killmail.killmail_time).getTime()
                  )
                )
              : null,
          newestKillmail:
            killmails.length > 0
              ? Math.max(
                  ...killmails.map((km) =>
                    new Date(km.killmail.killmail_time).getTime()
                  )
                )
              : null,
        },
      });
    } else {
      throw new Error("Database query returned unexpected result");
    }
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(500).json({
      status: "unhealthy",
      error: error.message,
      killmails: killmails.length,
      lastPoll: new Date().toISOString(),
    });
  }
});

// Parent market group IDs for ship categories
const PARENT_MARKET_GROUPS = {
  STRUCTURES: [477, 99, 383, 1320], //deployables, structures, and starbases
  FIGHTERS: [157], // Fighters
  SHUTTLES: [391, 1618], // INCLUDES SPECIAL EDITION
  CORVETTES: 1815,
  FRIGATES: [1361, 1838, 1619], // includes special edition
  DESTROYERS: [1372, 2350], // includes special edition
  CRUISERS: [1367, 1837], // includes special edition
  BATTLECRUISERS: [1374, 1698], // includes special edition
  BATTLESHIPS: [1376, 1620], // includes special edition
  CAPITALS: [1381, 2288], // Capital Ships & Supercapital Ships
  INDUSTRIAL: 1382, // Haulers and Industrial Ships
  MINING: 1384, // Mining Barges
};

// Function to check if a killmail is within the last 24 hours
function isWithinLast6Hours(killmailTime) {
  // Rename function to match new purpose
  const now = new Date();
  const killTime = new Date(killmailTime);
  const timeDiff = now - killTime;
  return timeDiff <= 6 * 60 * 60 * 1000; // 6 hours in milliseconds
}

function isNPC(shipTypeID, killmail) {
  const victim = killmail.killmail.victim;

  // Check victim ship type
  if (victim.ship_type_id === shipTypeID) {
    if (
      !victim.character_id &&
      victim.corporation_id > 1 &&
      victim.corporation_id < 1999999
    ) {
      return true;
    }

    if (victim.character_id > 3999999) {
      return false;
    }

    if (victim.corporation_id > 1999999) {
      return false;
    }
  }

  // Check attackers for the specific ship type
  for (const attacker of killmail.killmail.attackers) {
    if (attacker.ship_type_id === shipTypeID) {
      if (attacker.character_id > 3999999) {
        return false;
      }

      if (attacker.corporation_id > 1999999) {
        return false;
      }

      if (!attacker.character_id) {
        return true;
      }
    }
  }

  return true;
}

async function getShipCategoryFromDb(shipTypeId) {
  try {
    const { rows } = await pool.query(
      "SELECT category, name, tier FROM ship_types WHERE ship_type_id = $1",
      [shipTypeId]
    );
    return rows[0];
  } catch (err) {
    console.error(`Database error fetching ship type ${shipTypeId}:`, err);
    throw err;
  }
}

async function storeShipCategory(shipTypeId, shipData) {
  try {
    await pool.query(
      `INSERT INTO ship_types 
        (ship_type_id, category, name, tier, last_updated) 
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (ship_type_id) 
        DO UPDATE SET 
          category = $2, 
          name = $3, 
          tier = $4, 
          last_updated = NOW()`,
      [shipTypeId, shipData.category, shipData.name, shipData.tier]
    );
  } catch (error) {
    console.error(`Database error storing ship type ${shipTypeId}:`, error);
    throw error;
  }
}
// function serializeData(data) {
//   if (typeof data === "bigint") {
//     return data.toString();
//   } else if (Array.isArray(data)) {
//     return data.map(serializeData);
//   } else if (typeof data === "object" && data !== null) {
//     return Object.fromEntries(
//       Object.entries(data).map(([key, value]) => [key, serializeData(value)])
//     );
//   }
//   return data;
// }

// async function isCapitalShip(marketGroupId) {
//   try {
//     while (marketGroupId) {
//       const marketResponse = await axios.get(
//         `https://esi.evetech.net/latest/markets/groups/${marketGroupId}/`
//       );

//       // Check if this is a capital ships parent group
//       if (marketGroupId === 1381 || marketGroupId === 2288) {
//         return true;
//       }

//       marketGroupId = marketResponse.data.parent_group_id;
//       if (!marketGroupId) break;
//     }
//     return false;
//   } catch (error) {
//     console.error(
//       `Error checking market group ${marketGroupId}:`,
//       error.message
//     );
//     return false;
//   }
// }

async function determineShipCategory(typeId, killmail) {
  try {
    // --- Step 1: Get Type Info (Still needs ESI or better caching) ---
    // Check your existing cache first (e.g., shipTypeCache or a dedicated type cache)
    // For simplicity, we'll assume an ESI call here, but OPTIMIZE THIS SEPARATELY!
    // Ideally, cache this response aggressively (in memory/Redis).
    let typeResponseData;
    try {
      // TODO: Implement robust caching for this ESI call
      const response = await axios.get(
        `https://esi.evetech.net/latest/universe/types/${typeId}/?datasource=tranquility`
      );
      typeResponseData = response.data;
    } catch (esiError) {
      console.error(
        `[determineShipCategory] ESI Error fetching type ${typeId}:`,
        esiError.response?.data || esiError.message
      );
      // Return a default/unknown if type info fails
      return { category: "unknown", name: `TypeID ${typeId}`, tier: "T1" };
    }

    const shipName = typeResponseData.name || `TypeID ${typeId}`;
    const initialMarketGroupId = typeResponseData.market_group_id;
    const groupId = typeResponseData.group_id; // Get group_id for specific checks

    let tier = "T1"; // Default tier
    let category = "unknown"; // Default category

    // --- Step 2: Handle Special Cases (No Market Group Traversal Needed) ---
    if (groupId === 1180) {
      // CONCORD group
      return { category: "concord", name: shipName, tier: tier };
    }
    if (groupId === 29) {
      // Capsule group
      return { category: "capsule", name: shipName, tier: tier };
    }
    // Check NPC *after* special groups but *before* market group traversal
    if (killmail && isNPC(typeId, killmail)) {
      return { category: "npc", name: shipName, tier: tier };
    }

    // --- Step 3: Traverse Market Group Hierarchy using the Cache ---
    if (!initialMarketGroupId || marketGroupInfo.size === 0) {
      console.warn(
        `[determineShipCategory] No initial market group ID for type ${typeId} or market group cache is empty. Category unknown.`
      );
      // Return unknown if no market group or cache failed to load
      return { category: "unknown", name: shipName, tier: tier };
    }

    let currentMarketGroupId = initialMarketGroupId;
    const visitedGroups = new Set(); // Prevent infinite loops in case of bad SDE data

    while (currentMarketGroupId && !visitedGroups.has(currentMarketGroupId)) {
      visitedGroups.add(currentMarketGroupId); // Mark as visited

      const groupInfo = marketGroupInfo.get(currentMarketGroupId);
      if (!groupInfo) {
        // This group ID wasn't found in our cache - indicates incomplete SDE or new group
        console.warn(
          `[determineShipCategory] Market group ${currentMarketGroupId} not found in cache for type ${typeId}.`
        );
        break; // Stop traversal
      }

      const marketGroupName = groupInfo.name;

      // Check market group name for tier - only look for "Advanced" or T2 variations
      // Be careful with naming variations (e.g., "Tech II")
      if (
        marketGroupName.includes("Advanced") ||
        marketGroupName.startsWith("Tech II")
      ) {
        // Adjusted check
        tier = "T2";
      }
      // Could add T3 checks here if needed based on group names or specific IDs

      // Category checks - set category once (using the CONSTANT IDs)
      if (category === "unknown") {
        if (PARENT_MARKET_GROUPS.CAPITALS.includes(currentMarketGroupId)) {
          category = "capital";
        } else if (
          PARENT_MARKET_GROUPS.STRUCTURES.includes(currentMarketGroupId)
        ) {
          category = "structure";
        } else if (
          PARENT_MARKET_GROUPS.SHUTTLES.includes(currentMarketGroupId)
        ) {
          category = "shuttle";
        } else if (
          PARENT_MARKET_GROUPS.FIGHTERS.includes(currentMarketGroupId)
        ) {
          category = "fighter";
        } else if (currentMarketGroupId === PARENT_MARKET_GROUPS.CORVETTES) {
          category = "corvette";
        } else if (
          PARENT_MARKET_GROUPS.FRIGATES.includes(currentMarketGroupId)
        ) {
          category = "frigate";
        } else if (
          PARENT_MARKET_GROUPS.DESTROYERS.includes(currentMarketGroupId)
        ) {
          category = "destroyer";
        } else if (
          PARENT_MARKET_GROUPS.CRUISERS.includes(currentMarketGroupId)
        ) {
          category = "cruiser";
        } else if (
          PARENT_MARKET_GROUPS.BATTLECRUISERS.includes(currentMarketGroupId)
        ) {
          category = "battlecruiser";
        } else if (
          PARENT_MARKET_GROUPS.BATTLESHIPS.includes(currentMarketGroupId)
        ) {
          category = "battleship";
        } else if (currentMarketGroupId === PARENT_MARKET_GROUPS.INDUSTRIAL) {
          category = "industrial";
        } else if (currentMarketGroupId === PARENT_MARKET_GROUPS.MINING) {
          category = "mining";
        }
        // Add more categories here if needed
      }

      // Stop if we've determined category and tier? Maybe not, hierarchy might define tier higher up.
      // Stop if we've reached a known top-level group or a null parent
      if (currentMarketGroupId === 4 || groupInfo.parentId === null) {
        break; // Reached top ship group or actual root
      }

      // Move to the parent using the cache
      currentMarketGroupId = groupInfo.parentId;
    } // End while loop

    // --- Step 4: Return Result ---
    // If category is still unknown after traversal, keep it as unknown
    if (category === "unknown") {
      console.log(
        `[determineShipCategory] Category remained unknown for Type ID: ${typeId}, Initial Market Group: ${initialMarketGroupId}, Name: ${shipName}`
      );
    }

    return {
      category: category,
      name: shipName,
      tier: tier,
    };
  } catch (error) {
    // Catch any unexpected errors during the process
    console.error(
      `[determineShipCategory] Unexpected error processing type ${typeId}:`,
      error
    );
    return { category: "unknown", name: `TypeID ${typeId}`, tier: "T1" }; // Safe default
  }
}

async function getShipCategory(shipTypeId, killmail) {
  if (!shipTypeId) return null;

  try {
    // Check memory cache first
    if (shipTypeCache.has(shipTypeId)) {
      return shipTypeCache.get(shipTypeId);
    }

    // Then check database
    const shipData = await getShipCategoryFromDb(shipTypeId);
    if (shipData?.name && shipData?.tier) {
      const result = {
        category: shipData.category,
        name: shipData.name,
        tier: shipData.tier,
      };

      // Add to cache
      if (shipTypeCache.size >= MAX_SHIP_CACHE_SIZE) {
        // Remove oldest entry when cache is full
        const firstKey = shipTypeCache.keys().next().value;
        shipTypeCache.delete(firstKey);
      }
      shipTypeCache.set(shipTypeId, result);

      return result;
    }

    // Finally fetch from ESI and store
    const newShipData = await determineShipCategory(shipTypeId, killmail);
    await storeShipCategory(shipTypeId, newShipData);

    // Add to cache
    if (shipTypeCache.size >= MAX_SHIP_CACHE_SIZE) {
      const firstKey = shipTypeCache.keys().next().value;
      shipTypeCache.delete(firstKey);
    }
    shipTypeCache.set(shipTypeId, newShipData);

    return newShipData;
  } catch (error) {
    console.error(`Error getting ship category for ${shipTypeId}:`, error);
    return null;
  }
}

async function addShipCategoriesToKillmail(killmail) {
  try {
    console.log("Processing killmail:", killmail.killID);

    // Process victim ship type
    const victimShipId = killmail.killmail.victim.ship_type_id;
    const victimCategory = await getShipCategory(victimShipId, killmail);

    if (!victimCategory) {
      console.log("No valid victim category found");
      return killmail;
    }

    killmail.shipCategories = {
      victim: victimCategory,
      attackers: [],
    };

    // Get unique attacker ship types using a Set
    const attackerShipTypeSet = new Set();
    killmail.killmail.attackers.forEach((attacker) => {
      if (attacker.ship_type_id) {
        attackerShipTypeSet.add(attacker.ship_type_id);
      }
    });

    const uniqueAttackerShipTypes = Array.from(attackerShipTypeSet);
    console.log(
      `Processing ${uniqueAttackerShipTypes.length} unique attacker ship types`
    );

    // Process all ship types in parallel
    const attackerCategoryPromises = uniqueAttackerShipTypes.map(
      async (shipTypeId) => {
        try {
          const category = await getShipCategory(shipTypeId, killmail);
          return category ? { shipTypeId, ...category } : null;
        } catch (err) {
          console.error(`Error processing ship type ${shipTypeId}:`, err);
          return null;
        }
      }
    );

    const attackerCategories = await Promise.all(attackerCategoryPromises);

    // Filter out any null results and add to killmail
    killmail.shipCategories.attackers = attackerCategories.filter(Boolean);

    return killmail;
  } catch (error) {
    console.error("Fatal error in addShipCategoriesToKillmail:", error);
    return killmail; // Return original killmail instead of throwing
  }
}

// Function to get the total size of a user's filter lists
async function getFilterListsSize(userId) {
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM filter_lists WHERE user_id = $1",
      [userId]
    );
    return parseInt(rows[0].count);
  } catch (err) {
    console.error("Error getting filter lists size:", err);
    throw err;
  }
}

// Add to server.js
async function cleanupCelestialData() {
  await pool.query(`
    DELETE FROM celestial_data 
    WHERE last_updated < NOW() - INTERVAL '7 days'
  `);
}

async function cleanupProcessedKillIds() {
  console.log(
    "[DB Cleanup] Cleaning up processed kill IDs older than 12 hours..."
  );
  try {
    const result = await pool.query(`
      DELETE FROM processed_kill_ids
      WHERE processed_at < NOW() - INTERVAL '12 hours'
      `);
    console.log(
      `[DB Cleanup] Removed ${result.rowCount} old processed kill IDs.`
    );
  } catch (err) {
    console.error("[DB Cleanup] Error cleaning processed kill IDs:", err);
  }
}

// Run cleanup daily
setInterval(cleanupCelestialData, 24 * 60 * 60 * 1000);

const CLEANUP_KILLMAIL_INTERVAL = 10 * 60 * 1000; // Example: Run every 10 minutes

setInterval(() => {
  const originalCount = killmails.length;
  killmails = cleanKillmailsCache(killmails); // Reassign the filtered array back
  const removedCount = originalCount - killmails.length;
  if (removedCount > 0) {
    console.log(
      `[Killmail Cleanup] Removed ${removedCount} old killmails. Cache size: ${killmails.length}`
    );
  }
}, CLEANUP_KILLMAIL_INTERVAL);

async function cleanupShipTypes() {
  await pool.query(`
    DELETE FROM ship_types 
    WHERE last_updated < NOW() - INTERVAL '30 days'
  `);
}

// Run cleanup weekly
setInterval(cleanupShipTypes, 7 * 24 * 60 * 60 * 1000);

function inferCelestialType(row) {
  if (!row) return "Unknown";

  const name = row.itemname || "";
  const typeId = row.typeid;
  const groupId = row.groupid;

  // Prioritize groupID/typeID checks for more accuracy
  if (groupId === 6) return "Sun"; // GroupID for Suns
  if (groupId === 7) return "Planet"; // GroupID for Planets
  if (groupId === 8) return "Moon"; // GroupID for Moons
  if (typeId === 14) return "Moon"; // TypeID for Moons is also reliable
  if (groupId === 10) return "Stargate"; // GroupID for Stargates
  if (groupId === 9) return "Asteroid Belt"; // GroupID for Asteroid Belts
  if (groupId === 15) return "Station"; // GroupID for NPC Stations
  if (typeId === 57) return "Station"; // TypeID for Conquerable Stations

  // Fallback to name checking (less reliable but necessary without full SDE)
  if (name.includes("Sun") || name.includes("Star")) return "Sun";
  if (name.includes("Planet")) return "Planet"; // Covers Barren, Gas etc.
  if (name.includes("Moon")) return "Moon";
  if (name.includes("Stargate")) return "Stargate";
  if (name.includes("Asteroid Belt")) return "Asteroid Belt";
  if (name.includes("Station")) return "Station";
  if (name.includes("Customs Office")) return "Customs Office"; // Example of another type

  // If none of the above match, return a generic or unknown type
  return "Unknown";
}

async function fetchCelestialData(systemId) {
  const numericSystemId = parseInt(systemId);
  if (isNaN(numericSystemId)) {
    console.error(
      `[fetchCelestialData] Invalid non-numeric systemId provided: ${systemId}`
    );
    return []; // Return empty array for invalid input
  }

  console.log(
    `[fetchCelestialData] Fetching data for system ${numericSystemId} from map_denormalize (Using Region Cache, No Stargate Dest Map)`
  );

  const DB_TIMEOUT = 5000; // 5 seconds timeout for the DB query

  try {
    // Query includes the system row itself (itemID = $1) and objects within the system (solarSystemID = $1)
    // Ensure all needed columns are selected.
    const queryText = `
    SELECT
        itemid, itemname, typeid, groupid, solarsystemid,
        constellationid, regionid, orbitid, x, y, z, security
    FROM map_denormalize
    WHERE solarSystemID = $1 OR itemID = $1
    `;

    // Execute query with timeout race condition
    const dbPromise = pool.query(queryText, [numericSystemId]);
    const { rows } = await Promise.race([
      dbPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `DB query timeout (map_denormalize) for system ${numericSystemId}`
              )
            ),
          DB_TIMEOUT
        )
      ),
    ]);

    // Handle case where no data is found
    if (!rows || rows.length === 0) {
      console.warn(
        `[fetchCelestialData] No items found for system ${numericSystemId}.`
      );
      return [];
    }

    // --- Derive System Name AND Region Name ---

    // 1. Find the row representing the System itself (typeid=5 and itemid matches the input systemId)
    const systemObject = rows.find(
      (r) => r.typeid === 5 && r.itemid === numericSystemId
    );

    // Determine the canonical system name
    const commonSystemName =
      systemObject?.itemname || `System ${numericSystemId}`;

    // Get the region ID from the system object (this is likely a number from the DB)
    const regionIdFromSystem = systemObject?.regionid;

    // 2. Look up Region Name using the globally populated regionNameCache
    let commonRegionName = "Unknown Region"; // Default value
    if (regionIdFromSystem != null && regionNameCache.size > 0) {
      // Ensure regionId exists and cache was built
      const regionIdStr = String(regionIdFromSystem); // Convert to STRING for cache lookup
      commonRegionName =
        regionNameCache.get(regionIdStr) || `Unknown Region [${regionIdStr}]`; // Use String key

      // Log if lookup failed (indicates region missing from cache)
      if (commonRegionName.startsWith("Unknown Region")) {
        console.warn(
          `[fetchCelestialData] Region name lookup failed in cache for region ID: ${regionIdStr} (System: ${commonSystemName})`
        );
      }
    } else if (systemObject && regionIdFromSystem == null) {
      // Log if system object found but has no region ID
      console.warn(
        `[fetchCelestialData] System object found for ${commonSystemName}, but it has no regionid.`
      );
    } else if (!systemObject) {
      // Log if the system object itself wasn't found in the results
      console.warn(
        `[fetchCelestialData] Could not find system object (typeid=5) for ID ${numericSystemId} in results.`
      );
      // Attempt fallback using regionid from the *first* row if it exists (less reliable)
      const firstRegionId = rows[0]?.regionid;
      if (firstRegionId != null && regionNameCache.size > 0) {
        const firstRegionIdStr = String(firstRegionId);
        commonRegionName =
          regionNameCache.get(firstRegionIdStr) ||
          `Unknown Region [${firstRegionIdStr}]`;
      }
    }
    // --- End Name Derivation ---

    // Step 3: Map all fetched rows to the final output format
    const finalResults = rows.map((row) => {
      // Infer the type name (e.g., "Planet", "Stargate", "Sun")
      const inferredTypeName = inferCelestialType(row);

      // *** Stargate destination lookup removed ***
      // Since buildSystemConnectivityMap_FromJson doesn't build stargateDestinationMap,
      // we set destinationID to null.
      const destinationId = null;

      // Construct the final object, ensuring IDs are strings
      const finalObject = {
        itemid: String(row.itemid),
        itemname: row.itemname,
        typename: inferredTypeName,
        typeid: String(row.typeid),
        solarsystemname: commonSystemName, // Use the derived System Name
        solarsystemid: String(row.solarsystemid ?? numericSystemId), // Use system's ID, fallback to input ID
        constellationid: String(row.constellationid), // Ensure string
        regionid: String(row.regionid), // Ensure string
        regionname: commonRegionName, // Use the derived Region Name
        orbitid: row.orbitid ? String(row.orbitid) : null, // String if exists, else null
        x: String(row.x), // Ensure string
        y: String(row.y), // Ensure string
        z: String(row.z), // Ensure string
        destinationID: destinationId, // Now always null
      };
      return finalObject;
    });

    console.log(
      `[fetchCelestialData] Successfully processed ${finalResults.length} objects for system ${numericSystemId}. System: ${commonSystemName}, Region: ${commonRegionName}`
    );
    return finalResults; // Return the array of processed objects
  } catch (error) {
    // Log errors, including potential timeouts
    console.error(
      `[fetchCelestialData] Error processing system ${numericSystemId}:`,
      error
    );
    return []; // Return empty array on any error
  }
}

app.post("/api/eve-sso/state", async (req, res) => {
  const state = req.body.state;
  if (!state) {
    return res.status(400).json({ error: "No state provided" });
  }
  await saveState(state);
  res.json({ success: true });
});

app.post("/api/refresh-token", async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: "No refresh token provided" });
    }

    try {
      const tokenResponse = await axios.post(
        "https://login.eveonline.com/v2/oauth/token",
        `grant_type=refresh_token&refresh_token=${refresh_token}`,
        {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                `${EVE_SSO_CONFIG.client_id}:${EVE_SSO_CONFIG.client_secret}`
              ).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
            Host: "login.eveonline.com",
          },
        }
      );

      const {
        access_token,
        refresh_token: new_refresh_token,
        expires_in,
      } = tokenResponse.data;
      const token_expiry = Math.floor(Date.now() / 1000) + expires_in;

      // Update database and session
      if (req.session?.user?.character_id) {
        await pool.query(
          `UPDATE users SET access_token = $1, refresh_token = $2, token_expiry = $3 WHERE character_id = $4`,
          [
            access_token,
            new_refresh_token,
            token_expiry,
            req.session.user.character_id,
          ]
        );

        // Update session with new tokens
        req.session.user = {
          ...req.session.user,
          access_token,
          refresh_token: new_refresh_token,
          token_expiry,
        };

        // Save session
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error("Session save error:", err);
              reject(err);
              return;
            }
            resolve();
          });
        });
      }

      res.json({
        access_token,
        refresh_token: new_refresh_token,
        token_expiry,
      });
    } catch (error) {
      console.error(
        "EVE SSO token refresh error:",
        error.response?.data || error.message
      );

      // Check for specific error codes that indicate invalid refresh token
      if (
        error.response?.status === 400 &&
        (error.response?.data?.error === "invalid_grant" ||
          error.response?.data?.error === "invalid_token")
      ) {
        // Clear the user's session
        req.session.destroy((err) => {
          if (err) console.error("Session destruction error:", err);
        });

        return res.status(401).json({
          error: "Your EVE Online session has expired",
          sessionExpired: true,
        });
      }

      throw error; // Re-throw for general error handling
    }
  } catch (error) {
    console.error("Token refresh failed:", error);
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

// Account registration route
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Username and password are required" });
  }

  try {
    const hashedPassword = await hash(password, 10);

    await pool.query(
      "INSERT INTO users (username, password, settings) VALUES ($1, $2, $3)",
      [username, hashedPassword, JSON.stringify({})]
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === "23505") {
      // PostgreSQL unique violation error code
      res
        .status(409)
        .json({ success: false, message: "Username already exists" });
    } else {
      console.error("Registration error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
});

app.post("/api/filter-list", async (req, res) => {
  console.log(
    `[API /api/filter-list POST] Request received for path: ${req.path}`
  );

  if (!req.session?.user?.id) {
    console.log("[API /api/filter-list POST] User not authenticated");
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }

  const userId = req.session.user.id;
  console.log(`[API /api/filter-list POST] Authenticated User ID: ${userId}`);

  try {
    const { name, ids, enabled = true, isExclude, filterType } = req.body; // Default enabled to true

    console.log(
      "[API /api/filter-list POST] Processing filter list creation:",
      { userId, name, idsLength: ids?.length, enabled, isExclude, filterType }
    );

    let processedIds;
    if (Array.isArray(ids)) {
      processedIds = ids.map((id) => String(id).trim());
    } else if (typeof ids === "string") {
      processedIds = ids
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id);
    } else {
      console.warn(
        "[API /api/filter-list POST] Invalid 'ids' format received:",
        ids
      );
      processedIds = [];
    }
    console.log("[API /api/filter-list POST] Processed IDs:", processedIds);

    // --- Database Insert ---
    console.log("[API /api/filter-list POST] Attempting database insert...");
    const result = await pool.query(
      `INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        userId,
        name,
        JSON.stringify(processedIds),
        enabled ? 1 : 0, // Store initial enabled state in DB too
        isExclude ? 1 : 0,
        filterType || null,
      ]
    );
    console.log(
      "[API /api/filter-list POST] Database insert result:",
      result.rows
    );

    if (!result.rows || result.rows.length === 0) {
      console.error(
        "[API /api/filter-list POST] Failed to insert filter list into database."
      );
      return res.status(500).json({
        success: false,
        message: "Database error: Failed to create filter list.",
      });
    }
    const newListId = result.rows[0].id.toString(); // Get the new ID as string
    console.log(
      "[API /api/filter-list POST] Database insert successful. New ID:",
      newListId
    );

    // --- Update Session State ---
    req.session.currentFilterStates = req.session.currentFilterStates || {};
    req.session.currentFilterStates[newListId] = Boolean(enabled); // Store initial state in session

    // Save session asynchronously (fire and forget is okay here, or await if critical)
    req.session.save((err) => {
      if (err) {
        console.error(
          "[API /api/filter-list POST] Error saving session after creating filter list:",
          err
        );
        // Continue anyway, but log the error
      } else {
        console.log(
          "[API /api/filter-list POST] Session saved with new filter state for ID:",
          newListId
        );
      }
    });

    // --- Prepare Response/Emit ---
    const newFilterList = {
      id: newListId,
      user_id: userId.toString(),
      name,
      ids: processedIds,
      enabled: Boolean(enabled), // Use the actual initial state
      is_exclude: Boolean(isExclude),
      filter_type: filterType || null,
    };

    console.log(
      "[API /api/filter-list POST] Emitting 'filterListCreated' to user room:",
      userId.toString(),
      newFilterList
    );

    if (io && typeof io.to === "function") {
      // Ensure user is in their room (might need to be added on login/connection)
      const userSocket = Array.from(io.sockets.sockets.values()).find(
        (s) => s.request.session?.user?.id === userId
      );
      if (userSocket) {
        userSocket.join(userId.toString()); // Ensure they are in the room
      }
      io.to(userId.toString()).emit("filterListCreated", newFilterList);
      console.log(
        "[API /api/filter-list POST] 'filterListCreated' event emitted successfully."
      );
    } else {
      console.error(
        "[API /api/filter-list POST] 'io' object is not available or 'to' is not a function."
      );
    }

    res.status(201).json({ success: true, filterList: newFilterList });
  } catch (error) {
    console.error(
      "[API /api/filter-list POST] Error creating filter list:",
      error
    );
    res.status(500).json({
      success: false,
      message: "Server error while creating filter list.",
    });
  }
});

app.post("/api/profile", async (req, res) => {
  if (!req.session?.user?.id) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }

  try {
    const { name, settings, filterLists } = req.body;
    const userId = req.session.user.id;
    const profileData = JSON.stringify({ settings, filterLists });

    const result = await pool.query(
      "INSERT INTO user_profiles (user_id, name, settings) VALUES ($1, $2, $3) RETURNING id",
      [userId, name, profileData]
    );

    const newProfile = {
      id: result.rows[0].id,
      name,
      settings: profileData,
    };

    // Broadcast to all connected clients for this user
    io.to(userId.toString()).emit("profileSaved", newProfile);

    res.json({ success: true, profile: newProfile });
  } catch (error) {
    console.error("Error saving profile:", error);
    res.status(500).json({ success: false, message: "Error saving profile" });
  }
});

app.get("/api/filter-lists/:userId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM filter_lists WHERE user_id = $1",
      [req.params.userId]
    );

    const filterLists = rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      user_id: row.user_id.toString(),
      ids: JSON.parse(row.ids || "[]"),
      enabled: Boolean(row.enabled),
      is_exclude: Boolean(row.is_exclude),
      filter_type: row.filter_type || null,
    }));

    res.json({ success: true, filterLists });
  } catch (err) {
    console.error("Error fetching filter lists:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching filter lists" });
  }
});

app.get("/api/eve-sso-config", (req, res) => {
  res.json({
    clientId: process.env.EVE_CLIENT_ID,
    callbackUrl: process.env.EVE_CALLBACK_URL,
  });
});

app.get("/api/session", async (req, res) => {
  console.log("[API GET /api/session] Request received.");
  if (!req.session?.user) {
    console.log("[API GET /api/session] No active session found.");
    return res.status(401).json({
      error: "No active session",
      debug: { hasSession: !!req.session, sessionID: req.sessionID },
    });
  }
  const userId = req.session.user.id;
  console.log(`[API GET /api/session] Session found for User ID: ${userId}`);

  try {
    // Fetch filter lists from DB
    console.log(
      `[API GET /api/session] Fetching filter lists from DB for User ID: ${userId}`
    );
    const { rows: filterListsFromDb } = await pool.query(
      "SELECT * FROM filter_lists WHERE user_id = $1",
      [userId]
    );
    console.log(
      `[API GET /api/session] Found ${filterListsFromDb.length} lists in DB.`
    );

    // Fetch profiles from DB
    console.log(
      `[API GET /api/session] Fetching profiles from DB for User ID: ${userId}`
    );
    const { rows: profilesFromDb } = await pool.query(
      "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
      [userId]
    );
    console.log(
      `[API GET /api/session] Found ${profilesFromDb.length} profiles in DB.`
    );

    // Process Filter Lists using Session State
    console.log(
      "[API GET /api/session] Processing filter lists with session state:",
      req.session.currentFilterStates
    );
    const processedFilterLists = processFilterListsWithSessionState(
      filterListsFromDb,
      req.session.currentFilterStates // Pass the session state
    );
    console.log("[API GET /api/session] Finished processing filter lists.");

    const processedProfiles = profilesFromDb.map((profile) => ({
      id: profile.id.toString(),
      name: profile.name,
      settings: JSON.parse(profile.settings || "{}"), // Add default empty object
    }));
    console.log("[API GET /api/session] Finished processing profiles.");

    // --- START MODIFICATION ---
    res.json({
      user: {
        id: req.session.user.id,
        character_id: req.session.user.character_id,
        character_name: req.session.user.character_name,
        // UNCOMMENT these lines so tokenManager.js receives the data it needs
        access_token: req.session.user.access_token,
        refresh_token: req.session.user.refresh_token,
        token_expiry: req.session.user.token_expiry, // Ensure this is also present in the session user object
      },
      filterLists: processedFilterLists,
      profiles: processedProfiles,
    });
    // --- END MODIFICATION ---
    console.log(
      "[API GET /api/session] Sent session data response (including tokens)."
    ); // Modified log
  } catch (err) {
    console.error("[API GET /api/session] Error fetching session data:", err);
    res.status(500).json({ error: "Server error fetching session data" });
  }
});

// Normal login route for people who don't want their character tracked.
app.post("/api/login", async (req, res) => {
  console.log("[API POST /api/login] Request received.");
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      console.log("[API POST /api/login] Missing username or password.");
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    console.log(
      `[API POST /api/login] Attempting login for username: ${username}`
    );
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    const user = rows[0];
    if (!user) {
      console.log(`[API POST /api/login] User not found: ${username}`);
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    console.log(
      `[API POST /api/login] Comparing password for user ID: ${user.id}`
    );
    const match = await compare(password, user.password);
    if (!match) {
      console.log(
        `[API POST /api/login] Invalid password for user ID: ${user.id}`
      );
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }
    console.log(
      `[API POST /api/login] Login successful for user ID: ${user.id}`
    );

    // Fetch filter lists and profiles
    const { rows: filterListsFromDb } = await pool.query(
      "SELECT * FROM filter_lists WHERE user_id = $1",
      [user.id]
    );
    const { rows: profilesFromDb } = await pool.query(
      "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
      [user.id]
    );

    // Prepare session data
    const sessionUser = {
      id: user.id,
      username: user.username,
      character_id: user.character_id,
      character_name: user.character_name,
      // Don't store sensitive tokens directly if not needed immediately after login via this route
    };

    // --- Initialize/Load Filter States into Session ---
    // Try loading from DB user settings if we stored it there, otherwise initialize
    // For now, we'll just initialize it empty on login via this route,
    // assuming /api/session will handle loading/merging later.
    // Or, better: try to load existing session if possible, otherwise init.
    // Safest: Just initialize `currentFilterStates` if it doesn't exist.
    if (!req.session.currentFilterStates) {
      req.session.currentFilterStates = {};
      console.log(
        `[API POST /api/login] Initialized empty currentFilterStates in session for user ID: ${user.id}`
      );
      // Optionally pre-populate based on DB 'enabled' column as a default starting point
      filterListsFromDb.forEach((list) => {
        req.session.currentFilterStates[list.id.toString()] = Boolean(
          list.enabled
        );
      });
      console.log(
        `[API POST /api/login] Pre-populated session filter states from DB for user ID: ${user.id}`
      );
    } else {
      console.log(
        `[API POST /api/login] Found existing currentFilterStates in session for user ID: ${user.id}`
      );
    }

    // Process lists/profiles using session state
    const processedFilterLists = processFilterListsWithSessionState(
      filterListsFromDb,
      req.session.currentFilterStates
    );
    const processedProfiles = profilesFromDb.map((p) => ({
      id: p.id.toString(),
      name: p.name,
      settings: JSON.parse(p.settings || "{}"),
    }));

    // Set user and save session
    req.session.user = sessionUser;
    console.log(`[API POST /api/login] Saving session for user ID: ${user.id}`);
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error("[API POST /api/login] Session save error:", err);
          reject(err);
          return;
        }
        console.log(
          `[API POST /api/login] Session saved successfully for user ID: ${user.id}`
        );
        resolve();
      });
    });

    res.json({
      success: true,
      user: sessionUser,
      filterLists: processedFilterLists,
      profiles: processedProfiles,
    });
  } catch (err) {
    console.error("[API POST /api/login] Login error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during login" });
  }
});

app.post("/api/campcrushers/cancel-target", async (req, res) => {
  // 1. Authentication Check
  if (!req.session?.user?.character_id) {
    console.error("[Cancel Target] User not authenticated.");
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }

  const userId = req.session.user.character_id;
  console.log(`[Cancel Target] Request received for user: ${userId}`);

  try {
    // 2. Find the user's currently active (not completed, not expired) target
    const findActiveTargetQuery = `
      SELECT id
      FROM camp_crusher_targets
      WHERE character_id = $1
        AND completed = FALSE
        AND end_time > NOW()
      ORDER BY start_time DESC
      LIMIT 1;
    `;
    const { rows: activeTargets } = await pool.query(findActiveTargetQuery, [
      userId,
    ]);

    if (activeTargets.length === 0) {
      console.log(`[Cancel Target] No active target found for user: ${userId}`);
      // It's okay if no target is active, client might be out of sync
      return res.json({
        success: true,
        message: "No active target to cancel.",
      });
    }

    const targetToCancelId = activeTargets[0].id;
    console.log(
      `[Cancel Target] Found active target ID: ${targetToCancelId} for user: ${userId}`
    );

    // 3. Mark the target as inactive (e.g., set end_time to now or completed to true)
    // Setting completed=TRUE is simpler and aligns with successful completion logic
    const cancelTargetQuery = `
      UPDATE camp_crusher_targets
      SET completed = TRUE, end_time = NOW() -- Optionally set end_time too
      WHERE id = $1 AND character_id = $2 -- Ensure ownership
      RETURNING id;
    `;
    const { rowCount } = await pool.query(cancelTargetQuery, [
      targetToCancelId,
      userId,
    ]);

    if (rowCount > 0) {
      console.log(
        `[Cancel Target] Successfully marked target ${targetToCancelId} as completed for user: ${userId}`
      );
      // 4. Emit event to potentially update other client instances (optional but good practice)
      io.to(userId.toString()).emit("targetCancelled", {
        targetId: targetToCancelId,
      }); // Use a specific event name
      res.json({ success: true, message: "Target cancelled successfully." });
    } else {
      // This shouldn't ideally happen if the SELECT found a target, but handles race conditions/errors
      console.warn(
        `[Cancel Target] Failed to update target ${targetToCancelId} for user: ${userId} (maybe already completed/expired?).`
      );
      res.status(400).json({
        success: false,
        error: "Failed to cancel target (might be already inactive).",
      });
    }
  } catch (error) {
    console.error("[Cancel Target] Error processing cancel request:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// for user login
// --- MODIFIED EVE SSO Callback route ---
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  console.log(
    "[GET /callback] Received callback. Code:",
    code ? "Present" : "Missing",
    "State:",
    state
  );
  // console.log("[GET /callback] Session BEFORE processing:", req.session); // Debug session state

  try {
    // State validation
    const stateData = await getState(state);
    if (!stateData) {
      console.error("[GET /callback] Invalid or expired state:", state);
      return res.redirect("/?login=error&reason=invalid_state");
    }
    console.log("[GET /callback] State verified:", state);

    // Token acquisition
    console.log("[GET /callback] Requesting EVE SSO tokens...");
    const tokenResponse = await axios.post(
      "https://login.eveonline.com/v2/oauth/token",
      `grant_type=authorization_code&code=${code}`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${EVE_SSO_CONFIG.client_id}:${EVE_SSO_CONFIG.client_secret}`
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          Host: "login.eveonline.com",
        },
      }
    );
    console.log("[GET /callback] Token response received.");
    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      console.error(
        "[GET /callback] Missing token data in response:",
        tokenResponse.data
      );
      return res.redirect("/?login=error&reason=invalid_token");
    }

    const token_expiry = Math.floor(Date.now() / 1000) + expires_in;

    // Character info extraction
    const tokenParts = access_token.split(".");
    const tokenPayload = JSON.parse(
      Buffer.from(tokenParts[1], "base64").toString()
    );
    const characterId = tokenPayload.sub.split(":")[2];
    const characterName = tokenPayload.name;
    console.log("[GET /callback] Character data extracted:", {
      characterId,
      characterName,
    });

    if (!characterId || !characterName) {
      console.error(
        "[GET /callback] Invalid character data from token:",
        tokenPayload
      );
      return res.redirect("/?login=error&reason=invalid_character");
    }

    // --- Database Operations ---
    console.log("[GET /callback] Starting database operations...");
    const { rows: existingUser } = await pool.query(
      "SELECT id, settings FROM users WHERE character_id = $1",
      [characterId]
    );

    let userId;
    let userDbSettings = "{}"; // Default settings string

    if (existingUser.length > 0) {
      console.log(
        `[GET /callback] Updating existing user (ID: ${existingUser[0].id})`
      );
      userId = existingUser[0].id;
      userDbSettings = existingUser[0].settings || "{}";
      await pool.query(
        `UPDATE users
            SET access_token = $1, refresh_token = $2, character_name = $3, token_expiry = $4
            WHERE character_id = $5`,
        [access_token, refresh_token, characterName, token_expiry, characterId]
      );
    } else {
      console.log("[GET /callback] Creating new user...");
      const result = await pool.query(
        `INSERT INTO users
            (character_id, character_name, access_token, refresh_token, token_expiry, settings, bashbucks)
            VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`, // Ensure bashbucks defaults to 0
        [
          characterId,
          characterName,
          access_token,
          refresh_token,
          token_expiry,
          "{}", // Default empty settings JSON
        ]
      );
      userId = result.rows[0].id;
      console.log(`[GET /callback] New user created with ID: ${userId}`);
    }

    // Ensure camp_crushers entry
    console.log("[GET /callback] Ensuring camp_crushers entry exists...");
    await pool.query(
      `INSERT INTO camp_crushers (character_id, character_name)
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM camp_crushers WHERE character_id = $3
         )`,
      [characterId, characterName, characterId]
    );

    // Fetch filter lists and profiles
    console.log(
      `[GET /callback] Fetching filter lists and profiles for User ID: ${userId}`
    );
    const { rows: filterListsFromDb } = await pool.query(
      "SELECT * FROM filter_lists WHERE user_id = $1",
      [userId]
    );
    const { rows: profilesFromDb } = await pool.query(
      "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
      [userId]
    );
    console.log(
      `[GET /callback] Found ${filterListsFromDb.length} lists, ${profilesFromDb.length} profiles.`
    );

    // --- Session Setup ---
    const sessionUser = {
      id: userId,
      character_id: characterId,
      character_name: characterName,
      access_token, // Store tokens in session for immediate use
      refresh_token,
      token_expiry,
      // settings: JSON.parse(userDbSettings), // Store DB settings initially
    };
    req.session.user = sessionUser;
    console.log("[GET /callback] User data set in session.");

    // --- Initialize/Load Filter States into Session ---
    if (!req.session.currentFilterStates) {
      req.session.currentFilterStates = {};
      console.log(
        `[GET /callback] Initialized empty currentFilterStates in session for user ID: ${userId}`
      );
      // Pre-populate based on DB 'enabled' column
      filterListsFromDb.forEach((list) => {
        req.session.currentFilterStates[list.id.toString()] = Boolean(
          list.enabled
        );
      });
      console.log(
        `[GET /callback] Pre-populated session filter states from DB.`
      );
    } else {
      console.log(
        `[GET /callback] Found existing currentFilterStates in session.`
      );
      // Optional: Merge logic could go here if needed, but session usually overrides
    }

    // Process lists/profiles using the (potentially newly initialized) session state
    const processedFilterLists = processFilterListsWithSessionState(
      filterListsFromDb,
      req.session.currentFilterStates
    );
    const processedProfiles = profilesFromDb.map((p) => ({
      id: p.id.toString(),
      name: p.name,
      settings: JSON.parse(p.settings || "{}"),
    }));

    // Save the session explicitly *after* all updates
    console.log("[GET /callback] Saving session to Redis...");
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error("[GET /callback] Session save error:", err);
          reject(err);
          return;
        }
        console.log("[GET /callback] Session saved successfully.");
        // console.log("[GET /callback] Session AFTER saving:", req.session); // Debug session state
        resolve();
      });
    });

    // Socket notification (optional, client might fetch via /api/session anyway)
    console.log(
      `[GET /callback] Emitting loginSuccess to room ${userId.toString()}`
    );
    // Ensure the user's socket joins the room if connected
    const userSockets = await io.in(userId.toString()).fetchSockets();
    if (userSockets.length > 0) {
      console.log(
        `[GET /callback] Found ${userSockets.length} socket(s) for user ${userId}, emitting loginSuccess.`
      );
      io.to(userId.toString()).emit("loginSuccess", {
        user: sessionUser, // Send user info back
        settings: JSON.parse(userDbSettings), // Send initial DB settings
        filterLists: processedFilterLists,
        profiles: processedProfiles,
      });
    } else {
      console.log(
        `[GET /callback] No active sockets found for user ${userId} to emit loginSuccess.`
      );
    }

    // Redirect user back to the application
    console.log("[GET /callback] Redirecting user to /?authenticated=true");
    return res.redirect("/?authenticated=true");
  } catch (error) {
    console.error("[GET /callback] EVE SSO Callback Error:", {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });
    // Ensure session is destroyed or cleaned up on major error? Maybe not necessary.
    return res.redirect("/?login=error&reason=sso_error");
  }
});

// checks to see if the eve user needs to log in again with SSO.
app.get("/api/check-session", async (req, res) => {
  try {
    if (!req.session?.user?.character_id) {
      // Check URL parameters for EVE SSO callback
      const params = new URLSearchParams(req.url.split("?")[1] || "");
      if (params.get("authenticated") === "true") {
        // SSO callback successful, return success without showing welcome screen
        return res.json({
          validSession: true,
          user: req.session.user,
          ssoCallback: true,
        });
      }
      return res.status(401).json({ error: "No session found" });
    }

    // Get stored refresh token from database
    const { rows } = await pool.query(
      "SELECT refresh_token, token_expiry FROM users WHERE character_id = $1",
      [req.session.user.character_id]
    );

    if (!rows[0]?.refresh_token) {
      return res.status(401).json({ error: "No refresh token found" });
    }

    // Check if we need to refresh the token
    const now = Math.floor(Date.now() / 1000);
    if (now >= rows[0].token_expiry - 60) {
      try {
        // Attempt token refresh
        const tokenResponse = await axios.post(
          "https://login.eveonline.com/v2/oauth/token",
          `grant_type=refresh_token&refresh_token=${rows[0].refresh_token}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(
                `${EVE_SSO_CONFIG.client_id}:${EVE_SSO_CONFIG.client_secret}`
              ).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        const token_expiry = Math.floor(Date.now() / 1000) + expires_in;

        // Update database and session with new tokens
        await pool.query(
          `UPDATE users SET access_token = $1, refresh_token = $2, token_expiry = $3 WHERE character_id = $4`,
          [
            access_token,
            refresh_token,
            token_expiry,
            req.session.user.character_id,
          ]
        );

        req.session.user = {
          ...req.session.user,
          access_token,
          refresh_token,
          token_expiry,
        };

        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        return res.json({
          validSession: true,
          user: req.session.user,
        });
      } catch (error) {
        console.error("Token refresh failed:", error);
        return res.status(401).json({ error: "Token refresh failed" });
      }
    }

    // Session is valid and token doesn't need refresh
    res.json({
      validSession: true,
      user: req.session.user,
    });
  } catch (error) {
    console.error("Session check error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/celestials/system/:systemId", async (req, res) => {
  try {
    const systemId = req.params.systemId;
    const numericSystemId = parseInt(systemId);

    if (isNaN(numericSystemId)) {
      return res.status(400).json({ error: "Invalid system ID format" });
    }

    // 1. Fetch celestial objects using the existing function
    const celestialData = await fetchCelestialData(systemId); // Assuming this still just returns the array of celestials

    // 2. Get connected system IDs from the global map
    const neighborIdsSet =
      systemConnectivity.get(String(numericSystemId)) || new Set();
    const neighborIdsArray = Array.from(neighborIdsSet);

    // 3. Look up names for connected systems
    const connectedSystems = neighborIdsArray.map((id) => {
      return {
        id: id, // Keep ID as string
        name: systemIdToNameMap.get(id) || `System ${id}`, // Lookup name, fallback if not found
      };
    });

    // 4. Return combined data structure
    res.json({
      celestials: celestialData,
      connectedSystems: connectedSystems, // Array of {id: string, name: string}
    });
  } catch (error) {
    console.error(
      `Error getting celestial/connectivity data for system ${req.params.systemId}:`,
      error
    );
    res.status(500).json({ error: "Failed to get system data" });
  }
});

app.get("/api/celestials/:killmailId", async (req, res) => {
  try {
    const killmailId = parseInt(req.params.killmailId);
    const killmail = killmails.find((km) => km.killID === killmailId);

    if (!killmail) {
      return res.status(404).json({ error: "Killmail not found" });
    }

    const systemId = killmail.killmail.solar_system_id;

    try {
      const celestialData = await fetchCelestialData(systemId);

      const response = [
        {
          id: killmailId.toString(),
          name: "Killmail Location",
          typeid: 0,
          x: killmail.killmail.position?.x || 0,
          y: killmail.killmail.position?.y || 0,
          z: killmail.killmail.position?.z || 0,
          killmail_x: killmail.killmail.position?.x || 0,
          killmail_y: killmail.killmail.position?.y || 0,
          killmail_z: killmail.killmail.position?.z || 0,
        },
        ...celestialData,
      ];

      res.json(response);
    } catch (error) {
      console.error(
        `Error fetching celestial data for system ${systemId}:`,
        error
      );
      res.status(500).json({ error: "Failed to retrieve celestial data" });
    }
  } catch (error) {
    console.error("Error processing celestial request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Helper Function to Process Filter Lists with Session State ---
function processFilterListsWithSessionState(dbRows, sessionFilterStates) {
  const states = sessionFilterStates || {}; // Default to empty object if no session state

  return dbRows.map((row) => {
    const listId = row.id.toString();
    const enabledFromSession = states[listId]; // Check if state exists for this ID

    // Use session state if available, otherwise default (e.g., from DB or true)
    // Let's default new/unstored lists to true initially, unless DB says otherwise
    const finalEnabled =
      typeof enabledFromSession === "boolean"
        ? enabledFromSession
        : Boolean(row.enabled); // Fallback to DB value (or default if DB column is null)

    return {
      id: listId, // Ensure string ID
      user_id: row.user_id.toString(),
      name: row.name,
      ids: JSON.parse(row.ids || "[]"),
      enabled: finalEnabled, // Apply the resolved state
      is_exclude: Boolean(row.is_exclude),
      filter_type: row.filter_type || null,
    };
  });
}

function calculatePinpoints(celestials, killPosition) {
  // Early validation
  if (!killPosition?.x || !killPosition?.y || !killPosition?.z) {
    console.error("Invalid kill position:", killPosition);
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: false,
      nearestCelestial: null,
      triangulationPossible: false,
      triangulationType: null,
    };
  }

  // Find nearest celestial
  let nearest = null;
  let minDistance = Infinity;
  let bestPoints = [];
  let minVolume = Infinity;
  let triangulationType = null;

  celestials.forEach((celestial) => {
    if (celestial.id === "killmail" || !celestial.itemname) return;

    const distance = Math.sqrt(
      Math.pow(celestial.x - killPosition.x, 2) +
        Math.pow(celestial.y - killPosition.y, 2) +
        Math.pow(celestial.z - killPosition.z, 2)
    );

    if (distance < minDistance) {
      minDistance = distance;
      nearest = {
        name: celestial.itemname,
        distance: distance,
        position: {
          x: celestial.x,
          y: celestial.y,
          z: celestial.z,
        },
      };
    }
  });

  // If we're at or very near a celestial
  if (nearest) {
    if (minDistance <= THRESHOLDS.AT_CELESTIAL) {
      return {
        hasTetrahedron: false,
        points: [],
        atCelestial: true,
        nearestCelestial: nearest,
        triangulationPossible: true,
        triangulationType: "at_celestial",
      };
    }

    if (minDistance <= THRESHOLDS.DIRECT_WARP) {
      return {
        hasTetrahedron: false,
        points: [],
        atCelestial: false,
        nearestCelestial: nearest,
        triangulationPossible: true,
        triangulationType: "direct_warp",
      };
    }

    if (minDistance <= THRESHOLDS.NEAR_CELESTIAL) {
      return {
        hasTetrahedron: false,
        points: [],
        atCelestial: false,
        nearestCelestial: nearest,
        triangulationPossible: true,
        triangulationType: "near_celestial",
      };
    }
  }

  // Process celestials for tetrahedron calculation
  const validCelestials = celestials.filter(
    (cel) =>
      cel.id !== "killmail" &&
      cel.x !== undefined &&
      cel.y !== undefined &&
      cel.z !== undefined
  );

  // Need at least 4 celestials for tetrahedron
  if (validCelestials.length >= 4) {
    // Try all possible tetrahedrons (removed arbitrary limit)
    for (let i = 0; i < validCelestials.length - 3; i++) {
      for (let j = i + 1; j < validCelestials.length - 2; j++) {
        for (let k = j + 1; k < validCelestials.length - 1; k++) {
          for (let l = k + 1; l < validCelestials.length; l++) {
            const tetraPoints = [
              validCelestials[i],
              validCelestials[j],
              validCelestials[k],
              validCelestials[l],
            ];

            const tetraVectors = tetraPoints.map((p) => ({
              position: { x: p.x, y: p.y, z: p.z },
              name: p.itemname,
              distance: Math.sqrt(
                Math.pow(p.x - killPosition.x, 2) +
                  Math.pow(p.y - killPosition.y, 2) +
                  Math.pow(p.z - killPosition.z, 2)
              ),
            }));

            if (
              isPointInTetrahedron(
                killPosition,
                tetraPoints,
                THRESHOLDS.EPSILON
              )
            ) {
              const volume = calculateTetrahedronVolume(
                tetraPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }))
              );

              // Accept larger volumes but track if it requires bookspamming
              if (volume < minVolume) {
                minVolume = volume;
                bestPoints = tetraVectors;
                triangulationType =
                  volume < THRESHOLDS.MAX_BOX_SIZE ? "direct" : "via_bookspam";
              }
            }
          }
        }
      }
    }

    if (bestPoints.length === 4) {
      return {
        hasTetrahedron: true,
        points: bestPoints.map((point) => ({
          name: point.name,
          distance: point.distance,
          position: {
            x: parseFloat(point.position.x),
            y: parseFloat(point.position.y),
            z: parseFloat(point.position.z),
          },
        })),
        atCelestial: false,
        nearestCelestial: nearest,
        triangulationPossible: true,
        triangulationType: triangulationType,
      };
    }
  }

  // Default case when no triangulation is possible
  return {
    hasTetrahedron: false,
    points: [],
    atCelestial: false,
    nearestCelestial: nearest,
    triangulationPossible: nearest && minDistance <= THRESHOLDS.NEAR_CELESTIAL,
    triangulationType: null,
  };
}

function calculateBarycentricCoordinates(p, a, b, c, d) {
  // Convert vertices to vectors
  const vap = subtractVectors(p, a);
  const vbp = subtractVectors(p, b);
  const vcp = subtractVectors(p, c);
  const vdp = subtractVectors(p, d);

  const vab = subtractVectors(b, a);
  const vac = subtractVectors(c, a);
  const vad = subtractVectors(d, a);

  // Calculate volume of the entire tetrahedron
  const totalVolume = Math.abs(dotProduct(crossProduct(vab, vac), vad) / 6.0);

  if (totalVolume === 0) return null; // Degenerate tetrahedron

  // Calculate volumes of sub-tetrahedra formed with the point
  const v1 = Math.abs(dotProduct(crossProduct(vbp, vcp), vdp)) / 6.0;
  const v2 = Math.abs(dotProduct(crossProduct(vap, vcp), vdp)) / 6.0;
  const v3 = Math.abs(dotProduct(crossProduct(vap, vbp), vdp)) / 6.0;
  const v4 = Math.abs(dotProduct(crossProduct(vap, vbp), vcp)) / 6.0;

  // Calculate barycentric coordinates
  return {
    a: v1 / totalVolume,
    b: v2 / totalVolume,
    c: v3 / totalVolume,
    d: v4 / totalVolume,
    total: (v1 + v2 + v3 + v4) / totalVolume,
  };
}

function isPointInTetrahedron(point, tetraPoints, epsilon = 0.01) {
  const p = {
    x: parseFloat(point.x),
    y: parseFloat(point.y),
    z: parseFloat(point.z),
  };

  const [a, b, c, d] = tetraPoints.map((vertex) => ({
    x: parseFloat(vertex.x),
    y: parseFloat(vertex.y),
    z: parseFloat(vertex.z),
  }));

  const coords = calculateBarycentricCoordinates(p, a, b, c, d);
  if (!coords) return false;

  // Check if barycentric coordinates sum to approximately 1
  // and each coordinate is between 0 and 1 (with epsilon tolerance)
  const isValid =
    Math.abs(coords.total - 1.0) < epsilon &&
    coords.a >= -epsilon &&
    coords.a <= 1 + epsilon &&
    coords.b >= -epsilon &&
    coords.b <= 1 + epsilon &&
    coords.c >= -epsilon &&
    coords.c <= 1 + epsilon &&
    coords.d >= -epsilon &&
    coords.d <= 1 + epsilon;

  return isValid;
}

function calculateTetrahedronVolume(points) {
  const [a, b, c, d] = points;

  const ab = subtractVectors(b, a);
  const ac = subtractVectors(c, a);
  const ad = subtractVectors(d, a);

  const crossProduct = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };

  const volume =
    Math.abs(
      crossProduct.x * ad.x + crossProduct.y * ad.y + crossProduct.z * ad.z
    ) / 6;

  return volume;
}

function subtractVectors(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dotProduct(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossProduct(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// Update a filter list
app.put("/api/filter-list/:id", async (req, res) => {
  const { name, ids, enabled, isExclude, filterType } = req.body;
  const id = req.params.id;

  try {
    // Get the user ID for this filter list
    const { rows } = await pool.query(
      "SELECT user_id FROM filter_lists WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Filter list not found" });
    }

    // Check if updating this list would exceed the size limit
    // Get the user ID for this filter list first
    const { rows: oldList } = await pool.query(
      "SELECT * FROM filter_lists WHERE id = $1",
      [id]
    );
    if (oldList.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Filter list not found" });
    }

    // Check if updating this list would exceed the size limit
    const currentSize = await getFilterListsSize(oldList[0].user_id);
    const newListSize = JSON.stringify({
      name,
      ids,
      enabled,
      isExclude,
      filterType,
    }).length;
    const oldListSize = JSON.stringify(oldList[0]).length;
    if (currentSize - oldListSize + newListSize > 1024 * 1024) {
      // 1MB limit
      return res
        .status(400)
        .json({ success: false, message: "Filter lists size limit exceeded" });
    }

    try {
      await pool.query(
        "UPDATE filter_lists SET name = $1, ids = $2, enabled = $3, is_exclude = $4, filter_type = $5 WHERE id = $6",
        [
          name,
          JSON.stringify(ids),
          enabled ? 1 : 0,
          isExclude ? 1 : 0,
          filterType || null,
          id,
        ]
      );
      console.log("Updated filter list:", {
        id,
        name,
        ids,
        enabled,
        isExclude,
        filterType,
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Error updating filter list:", err);
      res
        .status(500)
        .json({ success: false, message: "Error updating filter list" });
    }
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Delete a filter list
app.delete("/api/filter-list/:id", async (req, res) => {
  const listId = req.params.id;
  console.log(`[API DELETE /api/filter-list/${listId}] Request received.`);

  if (!req.session?.user?.id) {
    console.log(
      `[API DELETE /api/filter-list/${listId}] User not authenticated.`
    );
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  const userId = req.session.user.id;
  console.log(
    `[API DELETE /api/filter-list/${listId}] Authenticated User ID: ${userId}`
  );

  try {
    // 1. Verify ownership & Delete from DB
    const { rowCount } = await pool.query(
      "DELETE FROM filter_lists WHERE id = $1 AND user_id = $2",
      [listId, userId]
    );

    if (rowCount === 0) {
      console.log(
        `[API DELETE /api/filter-list/${listId}] Filter list not found or user ${userId} does not own it.`
      );
      return res.status(404).json({
        success: false,
        message: "Filter list not found or unauthorized",
      });
    }
    console.log(
      `[API DELETE /api/filter-list/${listId}] Successfully deleted from database.`
    );

    // 2. Remove from Session State
    if (
      req.session.currentFilterStates &&
      req.session.currentFilterStates[listId] !== undefined
    ) {
      delete req.session.currentFilterStates[listId];
      console.log(
        `[API DELETE /api/filter-list/${listId}] Removed list state from session.`
      );

      // Save session
      req.session.save((err) => {
        if (err) {
          console.error(
            `[API DELETE /api/filter-list/${listId}] Error saving session after deleting filter state:`,
            err
          );
        } else {
          console.log(
            `[API DELETE /api/filter-list/${listId}] Session saved successfully.`
          );
        }
      });
    } else {
      console.log(
        `[API DELETE /api/filter-list/${listId}] No state found in session for this list ID.`
      );
    }

    // 3. Emit update (optional, if client handles optimistic delete)
    console.log(
      `[API DELETE /api/filter-list/${listId}] Emitting filterListDeleted to room ${userId.toString()}`
    );
    io.to(userId.toString()).emit("filterListDeleted", { id: listId });

    res.json({ success: true, message: "Filter list deleted" });
  } catch (err) {
    console.error(`[API DELETE /api/filter-list/${listId}] Error:`, err);
    res
      .status(500)
      .json({ success: false, message: "Error deleting filter list" });
  }
});

// Add Redis error handling
redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

redisClient.on("connect", () => {
  console.log("Connected to Redis");
});

redisClient.on("reconnecting", () => {
  console.log("Reconnecting to Redis...");
});

function isDuplicateKillmail(killmail, existingKillmails) {
  return existingKillmails.some(
    (existing) => existing.killID === killmail.killID
  );
}

// processKillmailData with added timing logs
async function processKillmailData(killmail) {
  // Expects killmail object
  const killID = killmail?.killID;
  if (!killID) {
    console.warn("[ProcessKM] Received killmail without killID.");
    return null; // Cannot process without ID
  }

  const processingStartTime = performance.now();
  console.log(
    `[ProcessKM ${killID}] START processing. Current queue: ${killmailProcessingQueue.queue.length}, Running: ${killmailProcessingQueue.running}`
  );

  // Basic validation (keep existing)
  if (
    !killmail ||
    !killmail.killmail ||
    !killmail.killmail.killmail_time ||
    !killmail.killmail.solar_system_id ||
    !killmail.killmail.attackers ||
    !killmail.killmail.victim
  ) {
    console.warn(
      `[ProcessKM ${killID}] Skipping invalid killmail data (missing core fields).`
    );
    return null;
  }
  const killTime = new Date(killmail.killmail.killmail_time);
  if (isNaN(killTime.getTime())) {
    console.warn(
      `[ProcessKM ${killID}] Skipping killmail due to invalid kill time.`
    );
    return null;
  }

  try {
    // 1. Add ship categories
    const shipCatStartTime = performance.now();
    const killmailWithShips = await addShipCategoriesToKillmail(killmail);
    const shipCatEndTime = performance.now();
    console.log(
      `[ProcessKM ${killID}] Ship categories added. Duration: ${(
        shipCatEndTime - shipCatStartTime
      ).toFixed(2)}ms`
    );
    if (!killmailWithShips) {
      console.warn(
        `[ProcessKM ${killID}] Skipping: Failed to add ship categories.`
      );
      return null;
    }

    // 2. Calculate Pinpoints and Celestial Data
    let systemInfo = {}; // Define outside block
    if (!killmailWithShips.killmail?.victim?.position) {
      console.warn(
        `[ProcessKM ${killID}] Missing victim position data needed for pinpoints. Adding default.`
      );
      // Assign default structure (keep existing)
      killmailWithShips.pinpoints = {
        /* ... default structure ... */
      };
    } else {
      const celestialStartTime = performance.now();
      const systemId = killmailWithShips.killmail.solar_system_id;
      const celestialData = await fetchCelestialData(systemId);
      const celestialEndTime = performance.now();
      console.log(
        `[ProcessKM ${killID}] Celestial data fetched. Duration: ${(
          celestialEndTime - celestialStartTime
        ).toFixed(2)}ms`
      );

      const pinpointStartTime = performance.now();
      const pinpointData = calculatePinpoints(
        celestialData,
        killmailWithShips.killmail.victim.position
      );
      const pinpointEndTime = performance.now();
      console.log(
        `[ProcessKM ${killID}] Pinpoints calculated. Duration: ${(
          pinpointEndTime - pinpointStartTime
        ).toFixed(2)}ms`
      );

      killmailWithShips.pinpoints = pinpointData;
      systemInfo = celestialData?.[0]; // Use the previously fetched data
      // Assign celestialData to pinpoints (keep existing)
      killmailWithShips.pinpoints.celestialData = systemInfo
        ? {
            /* ... */
          }
        : {
            /* ... default ... */
          };
    }

    // 3. Process KM with Activity Manager (synchronous call, timing less critical unless it blocks)
    const activityMgrStartTime = performance.now();
    serverActivityManager.processKillmailActivity(killmailWithShips);
    const activityMgrEndTime = performance.now();
    console.log(
      `[ProcessKM ${killID}] Activity Manager processed. Duration: ${(
        activityMgrEndTime - activityMgrStartTime
      ).toFixed(2)}ms`
    );

    // --- Define commonly used variables --- (keep existing)
    const systemId = killmailWithShips.killmail.solar_system_id;
    // ... other variables ...
    const killLocation = {
      /* ... */
    };

    // --- 4. Camp Crush Detection Logic ---
    const crushDetectStartTime = performance.now();
    try {
      const relevantTargetsQuery = `...`; // Your query
      const { rows: relevantTargets } = await pool.query(relevantTargetsQuery, [
        killTime,
        systemId,
      ]);
      console.log(
        `[ProcessKM ${killID}] Crush Detect: Found ${relevantTargets.length} potential targets.`
      );
      // ... rest of crush detection logic ...
      if (currentCampersOnKm < lossThreshold) {
        // Inside the successful crush detection
        const client = await pool.connect();
        const dbCrushStartTime = performance.now();
        try {
          await client.query("BEGIN");
          // ... UPDATE users ...
          // ... UPDATE camp_crusher_targets ...
          await client.query("COMMIT");
          const dbCrushEndTime = performance.now();
          console.log(
            `[ProcessKM ${killID}] Crush DB updates committed. Duration: ${(
              dbCrushEndTime - dbCrushStartTime
            ).toFixed(2)}ms`
          );
          // ... emit etc ...
        } catch (dbError) {
          // ... rollback ...
        } finally {
          client.release();
        }
      }
    } catch (crushError) {
      console.error(
        `[ProcessKM ${killID}] Error during crush detection phase:`,
        crushError
      );
    }
    const crushDetectEndTime = performance.now();
    console.log(
      `[ProcessKM ${killID}] Crush detection finished. Duration: ${(
        crushDetectEndTime - crushDetectStartTime
      ).toFixed(2)}ms`
    );
    // --- END: Camp Crush Detection Logic ---

    // --- 5. Bashbucks Reward/Penalty Logic ---
    const bashbucksStartTime = performance.now();
    try {
      // ... logic for victim penalty ...
      if (victimCharacterId) {
        // ... query victimTargets ...
        // ... loop targets ...
        if (killLocation.isNearTargetGate(target.stargate_name)) {
          if (!awardedBashbucksCrushers.has(victimCharacterId)) {
            const dbPenaltyStartTime = performance.now();
            await pool.query(
              `UPDATE users SET bashbucks = GREATEST(0, bashbucks - $1) WHERE character_id = $2`,
              [BASHBUCKS_DEATH_PENALTY, victimCharacterId]
            );
            const dbPenaltyEndTime = performance.now();
            console.log(
              `[ProcessKM ${killID}] Bashbucks victim penalty DB update duration: ${(
                dbPenaltyEndTime - dbPenaltyStartTime
              ).toFixed(2)}ms`
            );
            // ... rest of penalty logic ...
          }
        }
      }

      // ... logic for attacker reward ...
      for (const attackerId of attackerCharacterIds) {
        // ... query attackerTargets ...
        if (killLocation.isNearTargetGate(target.stargate_name)) {
          // ... skip if already completed by crush ...
          const client = await pool.connect();
          const dbRewardStartTime = performance.now();
          try {
            await client.query("BEGIN");
            // ... UPDATE users ...
            // ... UPDATE camp_crusher_targets ...
            await client.query("COMMIT");
            const dbRewardEndTime = performance.now();
            console.log(
              `[ProcessKM ${killID}] Bashbucks attacker reward DB updates committed. Duration: ${(
                dbRewardEndTime - dbRewardStartTime
              ).toFixed(2)}ms`
            );
            // ... emit etc ...
          } catch (dbError) {
            // ... rollback ...
          } finally {
            client.release();
          }
        }
      }
    } catch (bashbucksError) {
      console.error(
        `[ProcessKM ${killID}] Error processing Bashbucks rewards:`,
        bashbucksError
      );
    }
    const bashbucksEndTime = performance.now();
    console.log(
      `[ProcessKM ${killID}] Bashbucks logic finished. Duration: ${(
        bashbucksEndTime - bashbucksStartTime
      ).toFixed(2)}ms`
    );
    // --- END: Bashbucks Logic ---

    // --- 6. Final Steps ---
    // Add killmail to in-memory cache only if it's genuinely new
    const duplicateCheckStartTime = performance.now();
    const isDuplicate = isDuplicateKillmail(killmailWithShips, killmails); // Assuming killmails is accessible here
    const duplicateCheckEndTime = performance.now();
    // console.log(`[ProcessKM ${killID}] In-memory duplicate check duration: ${(duplicateCheckEndTime - duplicateCheckStartTime).toFixed(2)}ms`); // Can be noisy

    if (!isDuplicate) {
      killmails.push(killmailWithShips);
      // Broadcast the new, fully processed killmail
      io.to("live-updates").emit("newKillmail", killmailWithShips);
      console.log(`[ProcessKM ${killID}] Added to cache and broadcasted.`);
    } else {
      console.log(
        `[ProcessKM ${killID}] Skipped adding to cache/broadcast (in-memory duplicate).`
      );
    }

    const processingEndTime = performance.now();
    console.log(
      `[ProcessKM ${killID}] END processing. Total Duration: ${(
        processingEndTime - processingStartTime
      ).toFixed(2)}ms. Final queue: ${
        killmailProcessingQueue.queue.length
      }, Running: ${killmailProcessingQueue.running}`
    );
    return killmailWithShips; // Return the processed killmail
  } catch (error) {
    const processingEndTime = performance.now();
    console.error(
      `[ProcessKM ${killID}] FATAL error during processing. Duration: ${(
        processingEndTime - processingStartTime
      ).toFixed(2)}ms`,
      error
    );
    return null; // Return null on failure
  }
} // End of processKillmailData // End of processKillmailData
// --- Socket.IO Connection Handler ---
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  let connectionUserId = null; // Track user ID for this connection for logging

  // --- Join user-specific room on connection if authenticated ---
  if (socket.request.session?.user?.id) {
    connectionUserId = socket.request.session.user.id; // Store user ID
    const userIdStr = connectionUserId.toString();
    socket.join(userIdStr);
    console.log(
      `Socket ${socket.id} joined room ${userIdStr} for user ${
        socket.request.session.user.character_name ||
        socket.request.session.user.username ||
        userIdStr
      }`
    );
  } else {
    console.log(`Socket ${socket.id} connected without authentication.`);
  }

  // Initial Data Requests (Keep existing)
  socket.on("requestInitialKillmails", async () => {
    console.log(
      `Socket ${socket.id} requested initial killmails. Cache size:`,
      killmails.length
    );
    try {
      const cacheSnapshot = [...killmails]; // Take snapshot to avoid mutation during send
      const cacheSize = cacheSnapshot.length;

      console.log(
        `Socket ${socket.id}: Starting cache sync. Sending ${cacheSize} killmails`
      );
      socket.emit("cacheInitStart", { totalSize: cacheSize });

      const CHUNK_SIZE = 500;
      for (let i = 0; i < cacheSnapshot.length; i += CHUNK_SIZE) {
        const chunk = cacheSnapshot.slice(i, i + CHUNK_SIZE);
        socket.emit("cacheChunk", {
          chunk,
          currentCount: i + chunk.length,
          totalSize: cacheSize,
        });
        // Small delay to allow processing and prevent flooding
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      console.log(`Socket ${socket.id}: Finished sending cache chunks.`);
      // Client should now emit 'cacheSyncComplete'
    } catch (error) {
      console.error(`Socket ${socket.id}: Error sending initial cache:`, error);
      socket.emit("error", { message: "Failed to initialize cache" });
    }
  });

  socket.on("requestActivities", () => {
    console.log(`Socket ${socket.id} requested current activities.`);
    try {
      const currentActivities = serverActivityManager.getActiveActivities();
      socket.emit("activityUpdate", currentActivities); // Emit the unified update
      console.log(
        `Socket ${socket.id}: Sent ${currentActivities.length} activities.`
      );
    } catch (error) {
      console.error(
        `Socket ${socket.id}: Error fetching/sending activities:`,
        error
      );
      socket.emit("error", { message: "Failed to fetch activities" });
    }
  });

  socket.on("cacheSyncComplete", () => {
    console.log(
      `Socket ${socket.id} confirmed cache sync complete. Joining live updates.`
    );
    socket.emit("syncVerified", { success: true }); // Acknowledge completion
    socket.join("live-updates"); // Join the room for live killmail broadcasts
  });

  // --- Filter List Fetch ---
  socket.on("fetchFilterLists", async () => {
    console.log(`Socket ${socket.id} requested filter lists.`);
    if (!socket.request.session?.user?.id) {
      console.log(
        `Socket ${socket.id} - Not authenticated for fetchFilterLists.`
      );
      return socket.emit("error", { message: "Not authenticated" });
    }
    const userId = socket.request.session.user.id; // Use the ID stored at connection time if available
    try {
      console.log(
        `Workspaceing filter lists from DB for user ${userId} (Socket ${socket.id})`
      );
      const { rows: filterListsFromDb } = await pool.query(
        "SELECT * FROM filter_lists WHERE user_id = $1",
        [userId]
      );
      console.log(
        `Found ${filterListsFromDb.length} lists in DB for user ${userId} (Socket ${socket.id})`
      );

      // Process with session state
      const processedLists = processFilterListsWithSessionState(
        filterListsFromDb,
        socket.request.session.currentFilterStates // Access session state here
      );
      console.log(
        `Processed ${processedLists.length} lists, sending 'filterListsFetched' to socket ${socket.id}`
      );
      socket.emit("filterListsFetched", processedLists);
    } catch (error) {
      console.error(
        `Error fetching filter lists for user ${userId} (Socket ${socket.id}):`,
        error
      );
      socket.emit("error", { message: "Failed to fetch filter lists" });
    }
  });

  // --- Login via Socket ---
  socket.on("login", async ({ username, password }) => {
    console.log(
      `Socket ${socket.id} attempting login for username: ${username}`
    );
    try {
      const { rows } = await pool.query(
        "SELECT id, username, password, settings, character_id, character_name, access_token FROM users WHERE username = $1",
        [username]
      );
      const user = rows[0];

      if (user) {
        const match = await compare(password, user.password);
        if (match) {
          console.log(
            `Socket ${socket.id} - Login successful for user ID: ${user.id}`
          );
          const sessionUser = {
            id: Number(user.id),
            username: String(user.username),
            character_id: user.character_id ? String(user.character_id) : null,
            character_name: user.character_name
              ? String(user.character_name)
              : null,
            // Avoid sending tokens unless strictly needed by client on socket login
            // access_token: user.access_token ? String(user.access_token) : null,
          };

          // --- IMPORTANT: Update session state for this socket ---
          socket.request.session.user = sessionUser;
          connectionUserId = sessionUser.id; // Update connection's user ID tracker

          // Fetch lists/profiles for this user
          const { rows: filterLists } = await pool.query(
            "SELECT * FROM filter_lists WHERE user_id = $1",
            [user.id]
          );
          const { rows: profiles } = await pool.query(
            "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
            [user.id]
          );

          // Initialize/Load Filter States into Session
          if (!socket.request.session.currentFilterStates) {
            socket.request.session.currentFilterStates = {};
            console.log(
              `[Socket Login] Initialized empty currentFilterStates for user ID: ${user.id}`
            );
            filterLists.forEach((list) => {
              socket.request.session.currentFilterStates[list.id.toString()] =
                Boolean(list.enabled);
            });
            console.log(
              `[Socket Login] Pre-populated session filter states from DB.`
            );
          } else {
            console.log(
              `[Socket Login] Found existing currentFilterStates in session.`
            );
          }

          // Join the user-specific room *after* successful login
          const userIdStr = user.id.toString();
          socket.join(userIdStr);
          console.log(
            `Socket ${socket.id} joined room ${userIdStr} after login.`
          );

          // Save the updated session
          await new Promise((resolve, reject) => {
            socket.request.session.save((err) => {
              if (err) {
                console.error("[Socket Login] Session save error:", err);
                reject(err);
                return;
              }
              console.log(
                `[Socket Login] Session saved for user ID: ${user.id}`
              );
              resolve();
            });
          });

          // Process lists/profiles using the potentially updated session state
          const processedFilterLists = processFilterListsWithSessionState(
            filterLists,
            socket.request.session.currentFilterStates
          );
          const processedProfiles = profiles.map((profile) => ({
            id: profile.id.toString(),
            name: profile.name,
            settings: JSON.parse(profile.settings || "{}"),
          }));

          socket.emit("loginSuccess", {
            user: sessionUser, // Send user info back
            settings: user.settings ? JSON.parse(user.settings) : {},
            filterLists: processedFilterLists, // Send processed lists
            profiles: processedProfiles,
          });
        } else {
          console.log(
            `Socket ${socket.id} - Invalid password for username: ${username}`
          );
          socket.emit("loginError", { message: "Invalid credentials" });
        }
      } else {
        console.log(`Socket ${socket.id} - User not found: ${username}`);
        socket.emit("loginError", { message: "User not found" });
      }
    } catch (err) {
      console.error(`Socket ${socket.id} - Login error:`, err);
      socket.emit("loginError", { message: "Error during login" });
    }
  });

  // --- Settings Update ---
  socket.on("updateSettings", async (newSettings) => {
    // Use connectionUserId or re-check session
    const currentUserId = socket.request.session?.user?.id;
    if (currentUserId) {
      console.log(
        `Socket ${socket.id} (User ${currentUserId}) updating settings.`
      );
      try {
        await pool.query("UPDATE users SET settings = $1 WHERE id = $2", [
          JSON.stringify(newSettings),
          currentUserId,
        ]);
        console.log(`Settings updated for user: ${currentUserId}`);
        // Optionally emit confirmation back to the specific socket
        // socket.emit('settingsUpdated', newSettings);
      } catch (err) {
        console.error(
          `Error updating settings for user ${currentUserId}:`,
          err
        );
        socket.emit("error", { message: "Failed to update settings" });
      }
    } else {
      console.log(
        `Socket ${socket.id} - Not authenticated for updateSettings.`
      );
      socket.emit("error", { message: "Not authenticated" });
    }
  });

  // --- Profile Fetch/Save/Load/Delete ---
  socket.on("fetchProfiles", async () => {
    const currentUserId = socket.request.session?.user?.id;
    if (!currentUserId) {
      console.log(`Socket ${socket.id} - Not authenticated for fetchProfiles.`);
      return socket.emit("error", { message: "Not authenticated" });
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) fetching profiles.`
    );
    try {
      const { rows: profiles } = await pool.query(
        "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
        [currentUserId]
      );
      const processedProfiles = profiles.map((profile) => ({
        id: profile.id.toString(),
        name: profile.name,
        settings: JSON.parse(profile.settings || "{}"),
      }));
      console.log(
        `Socket ${socket.id}: Sending ${processedProfiles.length} profiles to client.`
      );
      socket.emit("profilesFetched", processedProfiles);
    } catch (error) {
      console.error(
        `Error fetching profiles for user ${currentUserId}:`,
        error
      );
      socket.emit("error", { message: "Failed to fetch profiles" });
    }
  });

  socket.on("saveProfile", async (data) => {
    const currentUserId = socket.request.session?.user?.id;
    if (!currentUserId) {
      console.log(`Socket ${socket.id} - Not authenticated for saveProfile.`);
      return socket.emit("error", { message: "Not authenticated" });
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) saving profile: ${data?.name}`
    );
    try {
      const { name, settings, filterLists: profileFilterLists } = data; // Rename to avoid conflict
      if (!name) {
        return socket.emit("error", { message: "Profile name is required" });
      }

      // Ensure filter lists are correctly formatted (IDs as strings)
      const serializedFilterLists = (profileFilterLists || []).map((list) => ({
        ...list,
        id: list.id.toString(), // Make sure ID is string
        ids: list.ids || [], // Ensure ids exists
        enabled: typeof list.enabled === "boolean" ? list.enabled : false, // Ensure boolean
        is_exclude:
          typeof list.is_exclude === "boolean" ? list.is_exclude : false, // Ensure boolean
      }));

      const profileData = JSON.stringify({
        settings: settings || {}, // Ensure settings exists
        filterLists: serializedFilterLists,
      });

      // Check if profile exists to decide between INSERT and UPDATE
      const { rows: existingProfile } = await pool.query(
        "SELECT id FROM user_profiles WHERE user_id = $1 AND name = $2",
        [currentUserId, name]
      );

      let profileId;
      if (existingProfile.length > 0) {
        profileId = existingProfile[0].id;
        console.log(
          `Updating existing profile ID ${profileId} for user ${currentUserId}`
        );
        await pool.query(
          "UPDATE user_profiles SET settings = $1 WHERE id = $2 AND user_id = $3",
          [profileData, profileId, currentUserId]
        );
      } else {
        console.log(
          `Inserting new profile named "${name}" for user ${currentUserId}`
        );
        const result = await pool.query(
          "INSERT INTO user_profiles (user_id, name, settings) VALUES ($1, $2, $3) RETURNING id",
          [currentUserId, name, profileData]
        );
        profileId = result.rows[0].id;
      }

      const savedProfile = {
        id: profileId.toString(),
        name,
        settings: JSON.parse(profileData), // Send back parsed data
      };

      console.log(
        `Profile ${savedProfile.name} (ID: ${savedProfile.id}) saved successfully for user ${currentUserId}. Emitting 'profileSaved'.`
      );
      // Emit confirmation back to the requesting socket
      socket.emit("profileSaved", savedProfile);
      // Optionally broadcast to other user sockets? Maybe not necessary for save.
      // socket.to(currentUserId.toString()).emit("profileSaved", savedProfile);
    } catch (error) {
      console.error(`Error saving profile for user ${currentUserId}:`, error);
      socket.emit("error", { message: "Error saving profile" });
    }
  });

  socket.on("loadProfile", async (profileId) => {
    const currentUserId = socket.request.session?.user?.id;
    if (!currentUserId) {
      console.log(`Socket ${socket.id} - Not authenticated for loadProfile.`);
      return socket.emit("error", { message: "Not authenticated" });
    }
    if (!profileId) {
      return socket.emit("error", { message: "No profile ID provided" });
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) loading profile ID: ${profileId}`
    );
    try {
      const { rows } = await pool.query(
        "SELECT settings, name FROM user_profiles WHERE id = $1 AND user_id = $2",
        [profileId, currentUserId]
      );

      if (rows.length === 0) {
        console.log(
          `Profile ID ${profileId} not found for user ${currentUserId}.`
        );
        return socket.emit("error", {
          message: "Profile not found or unauthorized",
        });
      }

      const profileData = JSON.parse(rows[0].settings || "{}"); // Default to empty object if settings are null/invalid
      const profileName = rows[0].name;

      console.log(
        `Profile "${profileName}" loaded successfully for user ${currentUserId}. Emitting 'profileLoaded'.`
      );

      // --- Update Session Filter States based on Loaded Profile ---
      if (profileData.filterLists && Array.isArray(profileData.filterLists)) {
        socket.request.session.currentFilterStates =
          socket.request.session.currentFilterStates || {};
        // Reset session states based ONLY on the loaded profile lists
        const newSessionStates = {};
        profileData.filterLists.forEach((list) => {
          newSessionStates[list.id.toString()] = Boolean(list.enabled);
        });
        socket.request.session.currentFilterStates = newSessionStates;
        console.log(
          `Updated session filter states based on loaded profile "${profileName}" for user ${currentUserId}.`
        );

        // Save the session with the new filter states
        await new Promise((resolve, reject) => {
          socket.request.session.save((err) => {
            if (err) {
              console.error(
                `[Socket LoadProfile] Session save error for user ${currentUserId}:`,
                err
              );
              reject(err);
              return;
            }
            console.log(
              `[Socket LoadProfile] Session saved successfully for user ${currentUserId}.`
            );
            resolve();
          });
        });
      } else {
        console.log(
          `Loaded profile "${profileName}" has no filterLists array, session filter state not changed.`
        );
      }
      // --- End Session Filter State Update ---

      // Emit the loaded data back to the requesting client
      socket.emit("profileLoaded", {
        id: profileId.toString(),
        name: profileName,
        settings: profileData.settings || {}, // Ensure settings object exists
        filterLists: profileData.filterLists || [], // Ensure filterLists array exists
      });

      // Optionally broadcast to other user sockets?
      // socket.to(currentUserId.toString()).emit('profileLoaded', { /* ... same data ... */ });
    } catch (error) {
      console.error(
        `Error loading profile ${profileId} for user ${currentUserId}:`,
        error
      );
      socket.emit("error", { message: "Error loading profile" });
    }
  });

  socket.on("deleteProfile", async ({ id }) => {
    const profileIdToDelete = id; // Rename
    const currentUserId = socket.request.session?.user?.id;
    if (!currentUserId) {
      console.log(`Socket ${socket.id} - Not authenticated for deleteProfile.`);
      return socket.emit("error", { message: "Not authenticated" });
    }
    if (!profileIdToDelete) {
      return socket.emit("error", {
        message: "No profile ID provided for deletion",
      });
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) deleting profile ID: ${profileIdToDelete}`
    );
    try {
      const result = await pool.query(
        "DELETE FROM user_profiles WHERE id = $1 AND user_id = $2",
        [profileIdToDelete, currentUserId]
      );

      if (result.rowCount > 0) {
        console.log(
          `Profile ID ${profileIdToDelete} deleted successfully for user ${currentUserId}. Emitting 'profileDeleted'.`
        );
        // Emit confirmation only to the requesting socket
        socket.emit("profileDeleted", profileIdToDelete);
        // Optionally broadcast to other user sockets
        socket
          .to(currentUserId.toString())
          .emit("profileDeleted", profileIdToDelete);
      } else {
        console.log(
          `Profile ID ${profileIdToDelete} not found or user ${currentUserId} does not own it.`
        );
        socket.emit("error", { message: "Profile not found or unauthorized" });
      }
    } catch (error) {
      console.error(
        `Server error deleting profile ${profileIdToDelete} for user ${currentUserId}:`,
        error
      );
      socket.emit("error", { message: "Error deleting profile" });
    }
  });

  // --- Filter List Create/Delete via Socket ---
  socket.on("createFilterList", async (data) => {
    const currentUserId = socket.request.session?.user?.id;
    if (!currentUserId) {
      console.log(
        `Socket ${socket.id} - Not authenticated for createFilterList.`
      );
      return socket.emit("error", { message: "Not authenticated" });
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) creating filter list: ${data?.name}`
    );

    try {
      const { name, ids, enabled = true, is_exclude, filter_type } = data;
      if (!name || !ids || !filter_type) {
        console.warn(
          `Socket ${socket.id} - Missing data for createFilterList:`,
          data
        );
        return socket.emit("error", {
          message: "Missing required fields (name, ids, type)",
        });
      }

      const processedIds = Array.isArray(ids)
        ? ids.map((id) => String(id).trim())
        : ids
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id);

      // Insert into DB
      const result = await pool.query(
        "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [
          currentUserId,
          name,
          JSON.stringify(processedIds),
          enabled ? 1 : 0,
          is_exclude ? 1 : 0,
          filter_type,
        ]
      );
      const newListId = result.rows[0].id.toString();
      console.log(
        `Inserted new filter list with ID ${newListId} for user ${currentUserId}.`
      );

      // Update Session State
      socket.request.session.currentFilterStates =
        socket.request.session.currentFilterStates || {};
      socket.request.session.currentFilterStates[newListId] = Boolean(enabled);
      console.log(
        `Updated session state for new list ${newListId}: enabled=${Boolean(
          enabled
        )}`
      );

      // Save Session
      await new Promise((resolve, reject) => {
        socket.request.session.save((err) => {
          if (err) {
            console.error("[Socket CreateFilterList] Session save error:", err);
            reject(err);
            return;
          }
          console.log(
            `[Socket CreateFilterList] Session saved for user ${currentUserId}.`
          );
          resolve();
        });
      });

      // Prepare and Emit
      const newFilterList = {
        id: newListId,
        user_id: currentUserId.toString(),
        name,
        ids: processedIds,
        enabled: Boolean(enabled),
        is_exclude: Boolean(is_exclude),
        filter_type,
      };

      console.log(
        `Emitting 'filterListCreated' to room ${currentUserId.toString()} for list ${newListId}`
      );
      // Emit only to the user's room
      io.to(currentUserId.toString()).emit("filterListCreated", newFilterList);
    } catch (error) {
      console.error(
        `Error creating filter list for user ${currentUserId}:`,
        error
      );
      socket.emit("error", { message: "Failed to create filter list" });
    }
  });

  socket.on("deleteFilterList", async ({ id }) => {
    const listIdToDelete = id; // Rename
    const currentUserId = socket.request.session?.user?.id;
    if (!currentUserId) {
      console.log(
        `Socket ${socket.id} - Not authenticated for deleteFilterList.`
      );
      return socket.emit("error", { message: "Not authenticated" });
    }
    if (!listIdToDelete) {
      return socket.emit("error", {
        message: "No filter list ID provided for deletion",
      });
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) deleting filter list ID: ${listIdToDelete}`
    );

    try {
      // Verify ownership & Delete from DB
      const { rowCount } = await pool.query(
        "DELETE FROM filter_lists WHERE id = $1 AND user_id = $2",
        [listIdToDelete, currentUserId]
      );

      if (rowCount === 0) {
        console.log(
          `Filter list ${listIdToDelete} not found or user ${currentUserId} does not own it.`
        );
        return socket.emit("error", {
          message: "Filter list not found or unauthorized",
        });
      }
      console.log(
        `Deleted filter list ${listIdToDelete} from DB for user ${currentUserId}.`
      );

      // Remove from Session State
      if (
        socket.request.session.currentFilterStates &&
        socket.request.session.currentFilterStates[listIdToDelete] !== undefined
      ) {
        delete socket.request.session.currentFilterStates[listIdToDelete];
        console.log(`Removed list state for ${listIdToDelete} from session.`);

        // Save Session
        await new Promise((resolve, reject) => {
          socket.request.session.save((err) => {
            if (err) {
              console.error(
                "[Socket DeleteFilterList] Session save error:",
                err
              );
              reject(err);
              return;
            }
            console.log(
              `[Socket DeleteFilterList] Session saved for user ${currentUserId}.`
            );
            resolve();
          });
        });
      } else {
        console.log(
          `No session state found for list ID ${listIdToDelete} to delete.`
        );
      }

      // Emit deletion event only to the user's room
      console.log(
        `Emitting 'filterListDeleted' to room ${currentUserId.toString()} for list ${listIdToDelete}`
      );
      io.to(currentUserId.toString()).emit("filterListDeleted", {
        id: listIdToDelete,
      });
    } catch (error) {
      console.error(
        `Error deleting filter list ${listIdToDelete} for user ${currentUserId}:`,
        error
      );
      socket.emit("error", { message: "Failed to delete filter list" });
    }
  });

  // --- NEW: Handler for Filter List State Update ---
  socket.on("updateFilterState", async ({ id, enabled }) => {
    const listId = id; // Rename for clarity
    const currentUserId = socket.request.session?.user?.id; // Check auth *inside* handler

    // Basic validation
    if (!currentUserId) {
      console.log(
        `Socket ${socket.id} - Not authenticated for updateFilterState (List ID: ${listId}).`
      );
      return; // Silently ignore if not authenticated
    }
    if (typeof enabled !== "boolean" || !listId) {
      console.warn(
        `Socket ${socket.id} (User ${currentUserId}) sent invalid data for updateFilterState: ID=${listId}, Enabled=${enabled}`
      );
      return; // Ignore invalid updates
    }
    console.log(
      `Socket ${socket.id} (User ${currentUserId}) received updateFilterState for ID: ${listId}, Enabled: ${enabled}`
    );

    try {
      // Initialize session state if it doesn't exist (should be rare here)
      socket.request.session.currentFilterStates =
        socket.request.session.currentFilterStates || {};

      // --- Optional: Verify list ownership before updating state ---
      // const { rowCount } = await pool.query("SELECT 1 FROM filter_lists WHERE id = $1 AND user_id = $2", [listId, currentUserId]);
      // if (rowCount === 0) {
      //     console.warn(`User ${currentUserId} attempted to update state for list ${listId} they don't own (or doesn't exist).`);
      //     return; // Ignore
      // }
      // --- End Optional Verification ---

      // Update the state in the session object
      socket.request.session.currentFilterStates[listId] = enabled;
      console.log(
        `Updated session state for list ${listId}: enabled=${enabled} for user ${currentUserId}`
      );

      // Save the session to persist the change
      await new Promise((resolve, reject) => {
        socket.request.session.save((err) => {
          if (err) {
            console.error(
              `[Socket UpdateFilterState] Error saving session for user ${currentUserId}:`,
              err
            );
            socket.emit("error", { message: "Failed to save filter state" });
            reject(err);
          } else {
            console.log(
              `[Socket UpdateFilterState] Session saved successfully for user ${currentUserId}.`
            );
            // Optional: Emit confirmation back to the *requesting* socket
            // socket.emit('filterStateUpdated', { id: listId, enabled });
            resolve();
          }
        });
      });

      // Broadcast the change to other sockets of the same user in the room
      console.log(
        `Broadcasting 'filterStateChanged' to room ${currentUserId.toString()} (except sender ${
          socket.id
        }) for list ${listId}`
      );
      socket
        .to(currentUserId.toString())
        .emit("filterStateChanged", { id: listId, enabled });
    } catch (error) {
      console.error(
        `Error processing updateFilterState for user ${currentUserId}, list ${listId}:`,
        error
      );
      socket.emit("error", { message: "Server error updating filter state" }); // Inform client of failure
    }
  });

  // --- Disconnect Handler ---
  socket.on("disconnect", (reason) => {
    console.log(
      `Socket disconnected: ${socket.id}. User: ${
        connectionUserId || "N/A"
      }. Reason: ${reason}`
    );
    // User is automatically removed from rooms on disconnect
  });
}); // End of io.on('connection')

// Function to poll for new killmails from RedisQ
// Function to poll for new killmails from RedisQ with added logging
async function pollRedisQ() {
  const pollStartTime = performance.now();
  // console.log(`[Poll] Starting poll cycle at ${new Date().toISOString()}`); // Can be noisy

  try {
    const response = await axios.get(REDISQ_URL, { timeout: 30000 });
    if (response.status === 200 && response.data.package) {
      const killmail = response.data.package;
      const killID = killmail.killID;
      const fetchEndTime = performance.now();
      console.log(
        `[Poll ${killID}] Fetched killmail. Fetch duration: ${(
          fetchEndTime - pollStartTime
        ).toFixed(2)}ms`
      );

      // --- Database Duplicate Check ---
      let isNewKill = false;
      const dbCheckStartTime = performance.now();
      try {
        await pool.query(
          "INSERT INTO processed_kill_ids (kill_id) VALUES ($1)",
          [killID]
        );
        isNewKill = true;
      } catch (dbError) {
        if (dbError.code === "23505") {
          // Unique violation
          isNewKill = false;
        } else {
          console.error(
            `[Poll ${killID}] Database error checking kill ID:`,
            dbError
          );
          isNewKill = false;
        }
      }
      const dbCheckEndTime = performance.now();
      console.log(
        `[Poll ${killID}] DB Check: New = ${isNewKill}. Check duration: ${(
          dbCheckEndTime - dbCheckStartTime
        ).toFixed(2)}ms`
      );
      // --- End Database Check ---

      // Proceed only if it's a new kill according to the DB AND within time window
      const isRecent = isWithinLast6Hours(killmail.killmail.killmail_time);
      if (isNewKill && isRecent) {
        console.log(`[Poll ${killID}] Kill is new and recent. Enqueuing...`);
        // Enqueue processing, passing killID for better logging
        killmailProcessingQueue
          .enqueue(async () => {
            // The async function that TaskQueue will execute
            try {
              await processKillmailData(killmail); // processKillmailData now needs killmail obj
            } catch (error) {
              console.error(
                `[Poll ${killID}] Error processing killmail in queue task:`,
                error
              );
            }
          }, `KM_${killID}`) // Pass killID as taskId
          .catch((err) => {
            console.error(`[Poll ${killID}] Error enqueueing task:`, err);
          });
      } else {
        console.log(
          `[Poll ${killID}] Skipping enqueue. New: ${isNewKill}, Recent: ${isRecent}`
        );
      }
    } else if (response.status === 200 && !response.data.package) {
      // No new killmail from RedisQ, this is normal
      // console.log("[Poll] No new killmail package received.");
    }
  } catch (error) {
    if (error.code !== "ECONNABORTED" && error.code !== "ETIMEDOUT") {
      // Avoid logging timeouts as errors unless persistent
      console.error("[Poll] Error polling RedisQ:", error.message);
    } else {
      // console.log("[Poll] Poll timed out or aborted."); // Can be noisy
    }
  } finally {
    const pollEndTime = performance.now();
    // console.log(`[Poll] Finished poll cycle. Duration: ${(pollEndTime - pollStartTime).toFixed(2)}ms. Scheduling next.`); // Can be noisy
    // Check queue status before scheduling next poll
    if (
      killmailProcessingQueue.queue.length >
      killmailProcessingQueue.concurrency * 2
    ) {
      console.warn(
        `[Poll] Killmail queue is large (${killmailProcessingQueue.queue.length}). Adding 1s delay before next poll.`
      );
      setTimeout(pollRedisQ, 1000); // Add a small delay if queue is very large
    } else {
      pollRedisQ(); // Schedule next poll immediately
    }
  }
}

function cleanKillmailsCache(killmails) {
  const now = new Date();
  return killmails.filter((km) => {
    const killTime = new Date(km.killmail.killmail_time);
    const timeDiff = now - killTime;
    return timeDiff <= 6 * 60 * 60 * 1000; // 6 hours instead of 24
  });
}

async function startServer() {
  try {
    await initializeDatabase();
    await initializeMapData();
    await buildMarketGroupHierarchyCache();
    await buildSystemConnectivityMap(); // for routes tracking during player movement without using fuzzworks
    isDatabaseInitialized = true;

    console.log("Starting server...");
    pollRedisQ(); // Start RedisQ polling

    setInterval(cleanupProcessedKillIds, 24 * 60 * 60 * 1000); // Run daily
    cleanupProcessedKillIds(); // Run once on startup as well

    return new Promise((resolve, reject) => {
      //
      server
        .listen(PORT, "0.0.0.0", () => {
          //
          console.log(`Server running on 0.0.0.0:${PORT}`); //
          resolve(); //
        })
        .on("error", (err) => {
          //
          reject(err); //
        });
    });
  } catch (err) {
    //
    console.error("Error starting server:", err); //
    process.exit(1); //
  }
}

// Serve build files with strict MIME types
app.use(
  "/build",
  express.static(path.join(__dirname, "../public/build"), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext];
      if (mimeType) {
        res.setHeader("Content-Type", mimeType);
      }
      // Add cache control for build assets
      res.setHeader("Cache-Control", "public, max-age=31536000");
    },
  })
);

// Serve public directory
app.use(
  express.static(path.join(__dirname, "../public"), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext];
      if (mimeType) {
        res.setHeader("Content-Type", mimeType);
      }
      // Add cache control for static assets
      res.setHeader("Cache-Control", "public, max-age=31536000"); // Function to poll for new killmails from RedisQ
    },
  })
);

// Error handler
app.use((err, req, res, next) => {
  console.error("Static file error:", {
    url: req.url,
    error: err.message,
    stack: err.stack,
    mime: MIME_TYPES[path.extname(req.url).toLowerCase()],
  });
  next(err);
});

app.get("/trophy-page/:characterId", (req, res) => {
  // We'll create trophy.html later
  res.sendFile(path.join(__dirname, "../public/trophy.html"));
});

// SPA fallback - must be last
app.get(/^(?!\/(api|trophy|trophy-page)\/).*/, (_, res) => {
  // <-- Modified regex
  // Exclude /api/, /trophy/, and /trophy-page/ routes from SPA fallback
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Cleaning up...");
  serverActivityManager.cleanup();
  await redisClient.quit();
  console.log("Cleanup finished. Exiting.");
  process.exit(0);
});

startServer();
