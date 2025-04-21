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
  constructor(concurrency = 5) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async enqueue(task) {
    return new Promise((resolve, reject) => {
      // Add task to queue
      this.queue.push({
        task,
        resolve,
        reject,
      });

      // Try to run task immediately
      this.runNext();
    });
  }

  async runNext() {
    // If at concurrency limit or no tasks, do nothing
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    // Get the next task
    const { task, resolve, reject } = this.queue.shift();
    this.running++;

    try {
      // Execute the task
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      // Reduce running count
      this.running--;

      // Try to run next task
      this.runNext();
    }
  }
}

// Caches for common items
const MAX_SHIP_CACHE_SIZE = 2000;
const shipTypeCache = new Map();

const killmailProcessingQueue = new TaskQueue(5);

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

const REDISQ_URL = "https://redisq.zkillboard.com/listen.php?queueID=zcamp";
let killmails = [];
let isDatabaseInitialized = false;

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
// Fetch trophy page data
app.get("/api/trophy/:characterId", async (req, res) => {
  const characterId = req.params.characterId;

  if (!characterId || isNaN(parseInt(characterId))) {
    return res.status(400).json({ error: "Invalid Character ID" });
  }

  try {
    // --- MODIFIED QUERY ---
    // Fetch Character Name and Bashbucks directly from the users table
    const userQuery = `
      SELECT character_name, bashbucks
      FROM users                -- Query users table
      WHERE character_id = $1    -- Find by character_id
    `;
    const userResult = await pool.query(userQuery, [characterId]);
    // --- END MODIFIED QUERY ---

    if (userResult.rows.length === 0) {
      // If user not found in the main users table, they don't exist for trophy purposes
      return res.status(404).json({ error: "Character not found" });
    }

    const userData = userResult.rows[0];

    // Fetch count of successful attacks (completed camp targets)
    // This part remains the same as it queries camp_crusher_targets
    const attacksQuery = `
      SELECT COUNT(*) as successfulAttacks
      FROM camp_crusher_targets
      WHERE character_id = $1 AND completed = TRUE
    `;
    const attacksResult = await pool.query(attacksQuery, [characterId]);
    const successfulAttacks = parseInt(
      attacksResult.rows[0].successfulattacks || 0
    );

    res.json({
      characterName: userData.character_name,
      bashbucks: userData.bashbucks || 0, // Use bashbucks from users table
      successfulAttacks: successfulAttacks,
    });
  } catch (error) {
    console.error(
      `[API Trophy] Error fetching data for character ${characterId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

// universe map data
// This endpoint fetches map data from the database and returns it to the client
app.get("/api/map-data", async (req, res) => {
  try {
    console.log("API: Received request for map data");

    // Only fetch relevant data (regions, systems, stargates)
    const { rows } = await pool.query(`
      SELECT * FROM map_denormalize
      WHERE (typeID = 3 AND regionID < 11000000) -- K-Space Regions
         OR (typeID = 5 AND regionID < 11000000) -- K-Space Solar Systems
         OR (groupID = 10 AND regionID < 11000000) -- K-Space Other
    `);

    console.log(`API: Found ${rows.length} total map entries`);
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
      console.log("API: Sample entry:", rows[0]);
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
    // Join with users table to get bashbucks and order by it
    const query = `
      SELECT
        cc.character_id,
        cc.character_name,
        u.bashbucks, -- Get bashbucks from users table
        current_target.camp_id AS target_camp_id,
        current_target.start_time AS target_start_time
      FROM
        camp_crushers cc
      JOIN users u ON cc.character_id = u.character_id -- Join users table
      LEFT JOIN LATERAL (
        SELECT
          cct.camp_id,
          cct.start_time
        FROM
          camp_crusher_targets cct
        WHERE
          cct.character_id = cc.character_id
          AND cct.completed = FALSE
          AND cct.end_time > CURRENT_TIMESTAMP
        ORDER BY
          cct.start_time DESC
        LIMIT 1
      ) current_target ON true
      ORDER BY
        u.bashbucks DESC -- Order by bashbucks from users table
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
      bashbucks: player.bashbucks || 0, // Use bashbucks from the joined users table
      target_camp_id: player.target_camp_id,
      target_start_time: player.target_start_time,
      total_camps_crushed: 0, // We can add this feature later
      recent_crushes: [], // We can add this feature later
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error("[Leaderboard] Error:", error);
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
    // Get ship type information from ESI first
    const response = await axios.get(
      `https://esi.evetech.net/latest/universe/types/${typeId}/`
    );

    // Get ship name and default tier
    const shipName = response.data.name;
    let tier = "T1";
    let category = "unknown";

    // Check for CONCORD group specifically
    if (response.data.group_id === 1180) {
      return {
        category: "concord",
        name: shipName,
        tier: tier,
      };
    }

    if (response.data.group_id === 29) {
      return {
        category: "capsule",
        name: shipName,
        tier: tier,
      };
    }

    // Check if it's an NPC based on killmail data
    if (killmail && isNPC(typeId, killmail)) {
      return {
        category: "npc",
        name: shipName,
        tier: tier,
      };
    }

    let marketGroupId = response.data.market_group_id;
    if (!marketGroupId) {
      return {
        category: "unknown",
        name: shipName,
        tier: tier,
      };
    }

    // Check market groups for both category and tier
    while (marketGroupId) {
      const marketResponse = await axios.get(
        `https://esi.evetech.net/latest/markets/groups/${marketGroupId}/`
      );

      const marketGroupName = marketResponse.data.name;

      // Check market group name for tier - only look for "Advanced"
      if (marketGroupName.includes("Advanced")) {
        tier = "T2";
      }

      // Category checks - set category once
      if (category === "unknown") {
        if (PARENT_MARKET_GROUPS.CAPITALS.includes(marketGroupId)) {
          category = "capital";
        } else if (PARENT_MARKET_GROUPS.STRUCTURES.includes(marketGroupId)) {
          category = "structure";
        } else if (PARENT_MARKET_GROUPS.SHUTTLES.includes(marketGroupId)) {
          category = "shuttle";
        } else if (PARENT_MARKET_GROUPS.FIGHTERS.includes(marketGroupId)) {
          category = "fighter";
        } else if (marketGroupId === PARENT_MARKET_GROUPS.CORVETTES) {
          category = "corvette";
        } else if (PARENT_MARKET_GROUPS.FRIGATES.includes(marketGroupId)) {
          category = "frigate";
        } else if (PARENT_MARKET_GROUPS.DESTROYERS.includes(marketGroupId)) {
          category = "destroyer";
        } else if (PARENT_MARKET_GROUPS.CRUISERS.includes(marketGroupId)) {
          category = "cruiser";
        } else if (
          PARENT_MARKET_GROUPS.BATTLECRUISERS.includes(marketGroupId)
        ) {
          category = "battlecruiser";
        } else if (PARENT_MARKET_GROUPS.BATTLESHIPS.includes(marketGroupId)) {
          category = "battleship";
        } else if (marketGroupId === PARENT_MARKET_GROUPS.INDUSTRIAL) {
          category = "industrial";
        } else if (marketGroupId === PARENT_MARKET_GROUPS.MINING) {
          category = "mining";
        }
      }

      // Stop if we've reached the top level "Ships" market group
      if (marketGroupId === 4) break;

      marketGroupId = marketResponse.data.parent_group_id;
    }

    return {
      category: category,
      name: shipName,
      tier: tier,
    };
  } catch (error) {
    console.error(`Error determining category for ship type ${typeId}:`, error);
    return {
      category: "unknown",
      name: "Unknown Ship",
      tier: "T1",
    };
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

async function fetchCelestialData(systemId) {
  console.log(`Fetching celestial data for system ${systemId}`);

  const DB_TIMEOUT = 5000; // 5 seconds

  try {
    // Check database first with increased timeout
    try {
      const dbPromise = pool.query(
        "SELECT celestial_data FROM celestial_data WHERE system_id = $1",
        [systemId]
      );

      const { rows } = await Promise.race([
        dbPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database timeout")), DB_TIMEOUT)
        ),
      ]);

      if (rows[0]?.celestial_data) {
        return JSON.parse(rows[0].celestial_data);
      }
    } catch (dbError) {
      console.error(`Database error for system ${systemId}:`, dbError);
    }

    // If not in database, fetch from API with a longer timeout
    const API_TIMEOUT = 8000; // 8 seconds
    const apiPromise = axios.get(
      `https://www.fuzzwork.co.uk/api/mapdata.php?solarsystemid=${systemId}&format=json`
    );

    const response = await Promise.race([
      apiPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("API timeout")), API_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(response.data)) {
      throw new Error(`Invalid API response for system ${systemId}`);
    }

    // Store in database non-blocking
    pool
      .query(
        `INSERT INTO celestial_data 
         (system_id, system_name, celestial_data, last_updated) 
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (system_id) 
       DO UPDATE SET 
         system_name = $2, 
         celestial_data = $3, 
         last_updated = NOW()`,
        [
          systemId,
          response.data[0]?.solarsystemname || String(systemId),
          JSON.stringify(response.data),
        ]
      )
      .catch((err) => {
        console.error(
          `Failed to store celestial data for system ${systemId}:`,
          err
        );
      });

    return response.data;
  } catch (error) {
    console.error(
      `Error fetching celestial data for system ${systemId}:`,
      error
    );
    throw error;
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
  // ADDED: Log entry into the route handler *before* any checks
  console.log(
    `[API /api/filter-list POST] Request received for path: ${req.path}`
  );

  // Check for user authentication in the session
  if (!req.session?.user?.id) {
    console.log("[API /api/filter-list POST] User not authenticated");
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }

  // ADDED: Log user ID after authentication check
  const userId = req.session.user.id;
  console.log(`[API /api/filter-list POST] Authenticated User ID: ${userId}`);

  try {
    // Destructure request body
    const { name, ids, enabled, isExclude, filterType } = req.body;

    // Log processing details
    console.log(
      "[API /api/filter-list POST] Processing filter list creation:",
      {
        // <-- Original log location
        userId,
        name,
        idsLength: ids?.length,
        enabled,
        isExclude,
        filterType,
      }
    );

    // Process IDs: Ensure it's an array of strings, trim whitespace.
    let processedIds;
    if (Array.isArray(ids)) {
      processedIds = ids.map((id) => String(id).trim()); // Ensure strings and trim
    } else if (typeof ids === "string") {
      processedIds = ids
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id); // Split, trim, remove empty strings
    } else {
      console.warn(
        "[API /api/filter-list POST] Invalid 'ids' format received:",
        ids
      );
      processedIds = []; // Default to empty array if format is unexpected
    }

    console.log("[API /api/filter-list POST] Processed IDs:", processedIds);

    // Insert the new filter list into the database
    console.log("[API /api/filter-list POST] Attempting database insert...");
    const result = await pool.query(
      `INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        userId, // User ID from session
        name, // Name of the filter list
        JSON.stringify(processedIds), // Store processed IDs as a JSON string
        enabled ? 1 : 0, // Convert boolean to integer (1 for true, 0 for false)
        isExclude ? 1 : 0, // Convert boolean to integer
        filterType || null, // Use provided filter type or null if none
      ]
    );

    // Log database insertion result
    console.log(
      "[API /api/filter-list POST] Database insert result:",
      result.rows
    );

    // Check if insertion was successful
    if (!result.rows || result.rows.length === 0) {
      console.error(
        "[API /api/filter-list POST] Failed to insert filter list into database."
      );
      return res.status(500).json({
        success: false,
        message: "Database error: Failed to create filter list.",
      });
    }
    console.log(
      "[API /api/filter-list POST] Database insert successful. New ID:",
      result.rows[0].id
    );

    // Prepare the new filter list object for response and socket emission
    // Ensure IDs are numbers where appropriate
    const newFilterList = {
      id: result.rows[0].id.toString(), // Convert BigInt ID to string
      user_id: userId.toString(), // User ID as string
      name, // Name as provided
      ids: processedIds, // Use the processed array of IDs
      enabled: Boolean(enabled), // Ensure boolean value
      is_exclude: Boolean(isExclude), // Ensure boolean value
      filter_type: filterType || null, // Use provided type or null
    };

    // Log the filter list object being emitted
    console.log(
      "[API /api/filter-list POST] Emitting 'filterListCreated' to user room:",
      userId.toString(),
      newFilterList
    );

    // Emit the 'filterListCreated' event to the specific user's room via socket.io
    // This notifies the client-side application in real-time
    // Ensure 'io' is correctly defined and accessible here
    if (io && typeof io.to === "function") {
      io.to(userId.toString()).emit("filterListCreated", newFilterList);
      console.log(
        "[API /api/filter-list POST] 'filterListCreated' event emitted successfully."
      );
    } else {
      console.error(
        "[API /api/filter-list POST] 'io' object is not available or 'to' is not a function. Cannot emit socket event."
      );
    }

    // Send a success response back to the client
    res.status(201).json({ success: true, filterList: newFilterList }); // Use 201 Created status
  } catch (error) {
    // Log any errors that occur during the process
    console.error(
      "[API /api/filter-list POST] Error creating filter list:",
      error
    );
    // Send a generic server error response
    res.status(500).json({
      success: false,
      message: "Server error while creating filter list.",
    });
  }
});

app.put("/api/filter-list/:id", async (req, res) => {
  const { name, ids, enabled, isExclude, filterType } = req.body;
  const id = req.params.id;

  try {
    const { rows } = await pool.query(
      "SELECT user_id FROM filter_lists WHERE id = $1",
      [id]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Filter list not found" });
    }

    const userId = rows[0].user_id;

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

    const updatedList = {
      id: id.toString(),
      user_id: userId.toString(),
      name,
      ids,
      enabled: Boolean(enabled),
      is_exclude: Boolean(isExclude),
      filter_type: filterType,
    };

    // Emit to all sockets in the user's room
    io.to(userId.toString()).emit("filterListUpdated", updatedList);
    res.json({ success: true, filterList: updatedList });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ success: false, message: "Server error" });
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
  if (!req.session?.user) {
    return res.status(401).json({
      error: "No active session",
      debug: {
        hasSession: !!req.session,
        sessionID: req.sessionID,
      },
    });
  }

  try {
    // Fetch filter lists
    const { rows: filterLists } = await pool.query(
      "SELECT * FROM filter_lists WHERE user_id = $1",
      [req.session.user.id]
    );

    // Add profile fetch
    const { rows: profiles } = await pool.query(
      "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
      [req.session.user.id]
    );

    const processedFilterLists = filterLists.map((list) => ({
      id: list.id.toString(),
      user_id: list.user_id.toString(),
      ids: JSON.parse(list.ids || "[]"),
      enabled: Boolean(list.enabled),
      is_exclude: Boolean(list.is_exclude),
      filter_type: list.filter_type || null,
    }));

    const processedProfiles = profiles.map((profile) => ({
      id: profile.id.toString(),
      name: profile.name,
      settings: JSON.parse(profile.settings),
    }));

    res.json({
      user: {
        id: req.session.user.id,
        character_id: req.session.user.character_id,
        character_name: req.session.user.character_name,
        access_token: req.session.user.access_token,
        refresh_token: req.session.user.refresh_token,
      },
      filterLists: processedFilterLists,
      profiles: processedProfiles, // Add this line
    });
  } catch (err) {
    console.error("Error fetching session data:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Normal login route for people who don't want their character tracked.
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const { rows } = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const match = await compare(password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Get user's filter lists
    // Get user's filter lists
    const { rows: filterLists } = await pool.query(
      "SELECT * FROM filter_lists WHERE user_id = $1",
      [user.id]
    );

    const processedFilterLists = filterLists.map((list) => ({
      ...list,
      ids: JSON.parse(list.ids || "[]"),
      enabled: Boolean(list.enabled),
      is_exclude: Boolean(list.is_exclude),
    }));

    const sessionUser = {
      id: user.id,
      username: user.username,
      character_id: user.character_id,
      character_name: user.character_name,
      access_token: user.access_token,
    };

    req.session.user = sessionUser;

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

    res.json({
      success: true,
      user: sessionUser,
      filterLists: processedFilterLists,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// for user login
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  console.log("Received callback with code:", code);
  console.log("Session at callback:", req.session);

  try {
    // State validation
    const stateData = await getState(state);
    if (!stateData) {
      console.error("Invalid state:", state);
      return res.redirect("/?login=error&reason=invalid_state");
    }

    // Token acquisition
    console.log("Requesting access token...");
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

    console.log("Token response received:", tokenResponse.data);
    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      console.error("Missing token data:", tokenResponse.data);
      return res.redirect("/?login=error&reason=invalid_token");
    }

    // Token expiry calculation
    const token_expiry = Math.floor(Date.now() / 1000) + expires_in;

    // Character info extraction
    const tokenParts = access_token.split(".");
    const tokenPayload = JSON.parse(
      Buffer.from(tokenParts[1], "base64").toString()
    );

    const characterId = tokenPayload.sub.split(":")[2];
    const characterName = tokenPayload.name;

    console.log("Character data extracted:", { characterId, characterName });

    if (!characterId || !characterName) {
      console.error("Invalid character data:", tokenPayload);
      return res.redirect("/?login=error&reason=invalid_character");
    }

    try {
      console.log("Starting database operations...");

      // User lookup/creation
      const { rows: existingUser } = await pool.query(
        "SELECT id, settings FROM users WHERE character_id = $1",
        [characterId]
      );

      let userId;
      let userSettings = {};

      if (existingUser.length > 0) {
        console.log("Updating existing user...");
        userId = existingUser[0].id;
        userSettings = JSON.parse(existingUser[0].settings || "{}");

        await pool.query(
          `UPDATE users 
           SET access_token = $1, refresh_token = $2, character_name = $3, token_expiry = $4 
           WHERE character_id = $5`,
          [
            access_token,
            refresh_token,
            characterName,
            token_expiry,
            characterId,
          ]
        );
      } else {
        console.log("Creating new user...");
        const result = await pool.query(
          `INSERT INTO users 
           (character_id, character_name, access_token, refresh_token, token_expiry, settings) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            characterId,
            characterName,
            access_token,
            refresh_token,
            token_expiry,
            "{}",
          ]
        );
        userId = result.rows[0].id;
      }

      console.log("Ensuring camp_crushers entry exists...");
      await pool.query(
        `INSERT INTO camp_crushers (character_id, character_name, bashbucks)
         SELECT $1, $2, 0
         WHERE NOT EXISTS (
           SELECT 1 FROM camp_crushers WHERE character_id = $3
         )`,
        [characterId, characterName, characterId]
      );

      // Fetch filter lists
      const { rows: filterLists } = await pool.query(
        "SELECT * FROM filter_lists WHERE user_id = $1",
        [userId]
      );

      // Fetch profiles
      const { rows: profiles } = await pool.query(
        "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
        [userId]
      );

      const processedFilterLists = filterLists.map((list) => ({
        id: list.id.toString(),
        user_id: list.user_id.toString(),
        name: list.name,
        ids: JSON.parse(list.ids || "[]"),
        enabled: Boolean(list.enabled),
        is_exclude: Boolean(list.is_exclude),
        filter_type: list.filter_type || null,
      }));

      const processedProfiles = profiles.map((profile) => ({
        id: profile.id.toString(),
        name: profile.name,
        settings: JSON.parse(profile.settings),
      }));

      console.log("Processed filter lists:", processedFilterLists);
      console.log("Processed profiles:", processedProfiles);

      // Session setup
      const sessionUser = {
        id: userId,
        character_id: characterId,
        character_name: characterName,
        access_token,
        refresh_token,
        token_expiry,
        settings: userSettings,
      };

      req.session.user = sessionUser;
      req.session.filterLists = processedFilterLists;
      req.session.profiles = processedProfiles;

      // Explicit session save
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            reject(err);
            return;
          }
          console.log("Session saved to Redis");
          resolve();
        });
      });

      // Socket notification
      io.to(userId.toString()).emit("loginSuccess", {
        settings: userSettings,
        filterLists: processedFilterLists,
        profiles: processedProfiles,
      });

      return res.redirect("/?authenticated=true");
    } catch (error) {
      console.error("Database/Session error:", error);
      return res.redirect("/?login=error&reason=database_error");
    }
  } catch (error) {
    console.error("EVE SSO Error:", {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });
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
    const celestialData = await fetchCelestialData(systemId);
    res.json(celestialData);
  } catch (error) {
    console.error(
      `Error getting celestial data for system ${req.params.systemId}:`,
      error
    );
    res.status(500).json({ error: "Failed to get celestial data" });
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
  try {
    await pool.query("DELETE FROM filter_lists WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
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

async function processKillmailData(killmail) {
  // Basic validation of killmail structure
  if (
    !killmail ||
    !killmail.killmail ||
    !killmail.killmail.killmail_time ||
    !killmail.killmail.solar_system_id ||
    !killmail.killmail.attackers ||
    !killmail.killmail.victim
  ) {
    console.warn(
      "Skipping invalid killmail data (missing core fields):",
      killmail?.killID
    );
    return null; // Return null if basic structure is invalid
  }
  // Validate time
  if (isNaN(new Date(killmail.killmail.killmail_time).getTime())) {
    console.warn(
      `Skipping killmail ${killmail.killID} due to invalid kill time.`
    );
    return null; // Return null if time is invalid
  }

  console.log("Starting processKillmailData", {
    killID: killmail.killID,
    systemId: killmail.killmail.solar_system_id,
    time: killmail.killmail.killmail_time,
  });

  try {
    // Add ship categories first
    const killmailWithShips = await addShipCategoriesToKillmail(killmail); //
    if (!killmailWithShips) {
      console.warn(
        `Skipping killmail ${killmail.killID}: Failed to add ship categories.`
      );
      return null; // Return null if adding categories fails
    }
    // killmailWithShips is now guaranteed to be defined and non-null here

    // Ensure nested properties exist before accessing for pinpoints
    if (
      !killmailWithShips.killmail ||
      !killmailWithShips.killmail.victim ||
      !killmailWithShips.killmail.victim.position
    ) {
      console.warn(
        `Skipping killmail ${killmail.killID}: Missing killmail, victim, or position data needed for pinpoints.`
      );
      // Decide if you want to continue without pinpoints or return null
      // For now, let's add default pinpoints and continue
      killmailWithShips.pinpoints = {
        hasTetrahedron: false,
        points: [],
        atCelestial: false,
        nearestCelestial: null,
        triangulationPossible: false,
        triangulationType: null,
        celestialData: {
          // Add default celestial data structure
          regionid: null,
          regionname: null,
          solarsystemid: killmailWithShips.killmail.solar_system_id,
          solarsystemname: null,
        },
      };
      // return null; // Option to stop processing if position is missing
    } else {
      // Fetch celestial data
      const systemId = killmailWithShips.killmail.solar_system_id; // [cite: 862]
      const celestialData = await fetchCelestialData(systemId); //
      // Calculate pinpoint data including nearest celestial
      const pinpointData = calculatePinpoints(
        //
        celestialData,
        killmailWithShips.killmail.victim.position // Safe to use now
      );
      // Add pinpoint and celestial info to the killmail object
      killmailWithShips.pinpoints = pinpointData; // [cite: 865]
      const systemInfo = celestialData?.[0]; // [cite: 865]
      killmailWithShips.pinpoints.celestialData = systemInfo // [cite: 866]
        ? {
            regionid: systemInfo.regionid, // [cite: 866]
            regionname: systemInfo.regionname, // [cite: 866]
            solarsystemid: systemInfo.solarsystemid, // [cite: 866]
            solarsystemname: systemInfo.solarsystemname, // [cite: 866]
          }
        : {
            regionid: null, // [cite: 866]
            regionname: null, // [cite: 866]
            solarsystemid: systemId, // [cite: 867]
            solarsystemname: null, // [cite: 867]
          };
    }

    // Process with the unified manager
    serverActivityManager.processKillmailActivity(killmailWithShips); // [cite: 868]

    // --- START: NEW Camp Crusher Reward Logic ---
    console.log("Checking camp crusher targets (New Logic)..."); // [cite: 869]
    const victimCharacterId = killmailWithShips.killmail.victim.character_id; // [cite: 870]
    const attackerCharacterIds = killmailWithShips.killmail.attackers // [cite: 870]
      .map((a) => a.character_id) // [cite: 870]
      .filter(Boolean); // Get IDs of all attackers // [cite: 870]

    const killLocation = {
      // [cite: 870]
      systemId: killmailWithShips.killmail.solar_system_id, // [cite: 870]
      // We need a way to check proximity to the stargate.
      // Using pinpoint data is the most accurate.
      // Let's check if the kill happened 'at' or 'near' the gate associated with the target.
      isNearTargetGate: (targetStargateName) => {
        // [cite: 870]
        if (
          !killmailWithShips.pinpoints?.nearestCelestial?.name ||
          !targetStargateName
        )
          return false; // [cite: 870]
        const killNearestGate =
          killmailWithShips.pinpoints.nearestCelestial.name; // [cite: 870]
        // Check if the kill's nearest gate matches the target gate name AND
        // if the triangulation type indicates proximity.
        return (
          // [cite: 870]
          killNearestGate
            .toLowerCase()
            .includes(targetStargateName.toLowerCase()) && // [cite: 870]
          (killmailWithShips.pinpoints.atCelestial || // [cite: 870]
            killmailWithShips.pinpoints.triangulationType === "direct_warp" || // [cite: 870]
            killmailWithShips.pinpoints.triangulationType === "near_celestial") // [cite: 870]
        );
      },
    };

    const BASHBUCKS_DEATH_PENALTY = 5; // [cite: 872]
    const BASHBUCKS_KILL_REWARD = 20; // [cite: 872]
    const awardedCrushers = new Set(); // Track who received points for this killmail // [cite: 872]

    try {
      // --- Check if Victim was a Crusher at their Target Location ---
      if (victimCharacterId) {
        // [cite: 872]
        const { rows: victimTargets } = await pool.query(
          // [cite: 872]
          `SELECT id, system_id, stargate_name
               FROM camp_crusher_targets
               WHERE character_id = $1 AND completed = FALSE AND end_time > NOW()`, // [cite: 872]
          [victimCharacterId] // [cite: 872]
        );

        for (const target of victimTargets) {
          // [cite: 872]
          // Check if the kill occurred in the target system AND near the target stargate
          if (
            target.system_id === killLocation.systemId &&
            killLocation.isNearTargetGate(target.stargate_name)
          ) {
            // [cite: 872]
            // Victim died at their target location
            if (!awardedCrushers.has(victimCharacterId)) {
              // Avoid double awarding if also attacker // [cite: 872]
              console.log(
                `Camp Crusher ${victimCharacterId} died at target location ${target.stargate_name}. Awarding ${BASHBUCKS_DEATH_PENALTY} Bashbucks.`
              ); // [cite: 872]
              // Award points to the user's main bashbucks count
              await pool.query(
                // [cite: 872]
                `UPDATE users SET bashbucks = bashbucks + $1 WHERE character_id = $2`, // [cite: 872]
                [BASHBUCKS_DEATH_PENALTY, victimCharacterId] // [cite: 872]
              );
              awardedCrushers.add(victimCharacterId); // [cite: 872]
              // Emit update to the specific user (optional: fetch new total first)
              io.to(victimCharacterId.toString()).emit("bashbucksUpdate", {
                change: BASHBUCKS_DEATH_PENALTY,
              }); // [cite: 872]
              break; // Only award once per killmail even if multiple targets match location // [cite: 872]
            }
          }
        }
      }

      // --- Check if Attacker was a Crusher who got a kill at their Target Location ---
      for (const attackerId of attackerCharacterIds) {
        // [cite: 872]
        if (awardedCrushers.has(attackerId)) continue; // Skip if already awarded for dying // [cite: 872]

        const { rows: attackerTargets } = await pool.query(
          // [cite: 872]
          `SELECT id, system_id, stargate_name
               FROM camp_crusher_targets
               WHERE character_id = $1 AND completed = FALSE AND end_time > NOW()`, // [cite: 872]
          [attackerId] // [cite: 872]
        );

        for (const target of attackerTargets) {
          // [cite: 872]
          // Check if the kill occurred in the target system AND near the target stargate
          if (
            target.system_id === killLocation.systemId &&
            killLocation.isNearTargetGate(target.stargate_name)
          ) {
            // [cite: 872]
            // Attacker got *a* kill at their target location. Award points and complete.
            if (!awardedCrushers.has(attackerId)) {
              // [cite: 872]
              console.log(
                `Camp Crusher ${attackerId} got a kill at target location ${target.stargate_name}. Awarding ${BASHBUCKS_KILL_REWARD} Bashbucks & completing target ${target.id}.`
              ); // [cite: 872]
              // Award Bashbucks
              await pool.query(
                // [cite: 872]
                `UPDATE users SET bashbucks = bashbucks + $1 WHERE character_id = $2`, // [cite: 872]
                [BASHBUCKS_KILL_REWARD, attackerId] // [cite: 872]
              );
              // Mark target as complete using its specific ID
              await pool.query(
                // [cite: 872]
                `UPDATE camp_crusher_targets SET completed = TRUE WHERE id = $1`, // [cite: 872]
                [target.id] // [cite: 872]
              );
              awardedCrushers.add(attackerId); // [cite: 872]
              // Emit updates
              io.to(attackerId.toString()).emit("bashbucksUpdate", {
                change: BASHBUCKS_KILL_REWARD,
              }); // [cite: 872]
              io.to(attackerId.toString()).emit("targetCompleted", {
                targetId: target.id,
              }); // [cite: 872]
              break; // Only award once per killmail even if multiple targets match location // [cite: 872]
            }
          }
        }
      }
      // --- END: NEW Camp Crusher Reward Logic ---
    } catch (error) {
      // Log specific camp crusher errors but don't stop overall processing
      console.error("Error processing camp crusher rewards:", error); // [cite: 882]
    }

    // Add killmail to in-memory cache (moved from pollRedisQ)
    // This ensures only fully processed killmails are added
    if (!isDuplicateKillmail(killmailWithShips, killmails)) {
      // [cite: 883, 855]
      killmails.push(killmailWithShips); // [cite: 883]
      // Optionally broadcast the new, fully processed killmail
      io.to("live-updates").emit("newKillmail", killmailWithShips); // [cite: 884]
    }

    return killmailWithShips; // Return the processed killmail // [cite: 885]
  } catch (error) {
    // Log the error with the original killID for reference
    console.error(
      // [cite: 885]
      `Fatal error in processKillmailData for kill ${
        killmail?.killID || "UNKNOWN"
      }:`, // [cite: 885]
      error // [cite: 885]
    );
    return null; // Return null on failure // [cite: 886]
  }
} // End of processKillmailData

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("requestInitialKillmails", async () => {
    console.log(
      "Received request for initial killmails. Cache size:",
      killmails.length
    );
    try {
      const cacheSnapshot = [...killmails];
      const cacheSize = cacheSnapshot.length;

      console.log(`Starting cache sync. Sending ${cacheSize} killmails`);
      socket.emit("cacheInitStart", { totalSize: cacheSize });

      // Send cache in chunks of 500
      const CHUNK_SIZE = 500;
      for (let i = 0; i < cacheSnapshot.length; i += CHUNK_SIZE) {
        const chunk = cacheSnapshot.slice(i, i + CHUNK_SIZE);
        socket.emit("cacheChunk", {
          chunk,
          currentCount: i + chunk.length,
          totalSize: cacheSize,
        });

        // Small delay to prevent overwhelming the client
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } catch (error) {
      console.error("Error sending initial cache:", error);
      socket.emit("error", { message: "Failed to initialize cache" });
    }
  });

  socket.on("requestActivities", () => {
    console.log(`Socket ${socket.id} requested current activities.`);
    const currentActivities = serverActivityManager.getActiveActivities();
    socket.emit("activityUpdate", currentActivities); // Emit the unified update
  });

  socket.on("cacheSyncComplete", () => {
    console.log(
      `Socket ${socket.id} confirmed cache sync complete. Joining live updates.`
    );
    socket.emit("syncVerified", { success: true });
    socket.join("live-updates"); // Join the room for live killmail broadcasts
  });

  socket.on("fetchFilterLists", async () => {
    if (
      !socket.request.session?.user?.id &&
      !socket.request.session?.user?.character_id
    ) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const { rows } = await pool.query(
        "SELECT * FROM filter_lists WHERE user_id = $1",
        [socket.request.session.user.id]
      );

      const processedLists = rows.map((list) => ({
        id: list.id.toString(),
        user_id: list.user_id.toString(),
        name: list.name,
        ids: JSON.parse(list.ids || "[]"),
        enabled: Boolean(list.enabled),
        is_exclude: Boolean(list.is_exclude),
        filter_type: list.filter_type || null,
      }));

      socket.emit("filterListsFetched", processedLists);
    } catch (error) {
      console.error("Error fetching filter lists:", error);
      socket.emit("error", { message: "Failed to fetch filter lists" });
    }
  });

  socket.on("login", async ({ username, password }) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, username, password, settings, character_id, character_name, access_token FROM users WHERE username = $1",
        [username]
      );

      const user = rows[0];
      if (user) {
        const match = await compare(password, user.password);
        if (match) {
          const sessionUser = {
            id: Number(user.id),
            username: String(user.username),
            character_id: user.character_id ? String(user.character_id) : null,
            character_name: user.character_name
              ? String(user.character_name)
              : null,
            access_token: user.access_token ? String(user.access_token) : null,
          };

          socket.request.session.user = sessionUser;
          await new Promise((resolve, reject) => {
            socket.request.session.save((err) => {
              if (err) {
                console.error("Session save error:", err);
                reject(err);
                return;
              }
              resolve();
            });
          });

          socket.username = username;

          // Fetch filter lists
          const { rows: filterLists } = await pool.query(
            "SELECT * FROM filter_lists WHERE user_id = $1",
            [socket.request.session.user.id]
          );

          // Fetch profiles
          const { rows: profiles } = await pool.query(
            "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
            [socket.request.session.user.id]
          );

          const processedFilterLists = filterLists.map((list) => ({
            id: list.id.toString(),
            user_id: list.user_id.toString(),
            name: list.name,
            ids: JSON.parse(list.ids || "[]"),
            enabled: Boolean(list.enabled),
            is_exclude: Boolean(list.is_exclude),
            filter_type: list.filter_type || null,
          }));

          const processedProfiles = profiles.map((profile) => ({
            id: profile.id.toString(),
            name: profile.name,
            settings: JSON.parse(profile.settings),
          }));

          socket.emit("loginSuccess", {
            settings: user.settings ? JSON.parse(user.settings) : {},
            filterLists: processedFilterLists,
            profiles: processedProfiles,
          });
        } else {
          socket.emit("loginError", { message: "Invalid credentials" });
        }
      } else {
        socket.emit("loginError", { message: "User not found" });
      }
    } catch (err) {
      console.error("Login error:", err);
      socket.emit("loginError", { message: "Error during login" });
    }
  });

  // Settings handling
  socket.on("updateSettings", async (newSettings) => {
    if (socket.username) {
      try {
        await pool.query("UPDATE users SET settings = $1 WHERE username = $2", [
          JSON.stringify(newSettings),
          socket.username,
        ]);
        console.log("Settings updated for user:", socket.username);
      } catch (err) {
        console.error("Error updating settings:", err);
        socket.emit("error", { message: "Failed to update settings" });
      }
    }
  });

  socket.on("fetchProfiles", async () => {
    try {
      if (
        !socket.request.session?.user?.id &&
        !socket.request.session?.user?.character_id
      ) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      const userId =
        socket.request.session.user.id ||
        socket.request.session.user.character_id;

      const { rows: profiles } = await pool.query(
        "SELECT id, name, settings FROM user_profiles WHERE user_id = $1",
        [userId]
      );

      const processedProfiles = profiles.map((profile) => ({
        id: profile.id.toString(),
        name: profile.name,
        settings: JSON.parse(profile.settings),
      }));

      console.log("Sending profiles to client:", processedProfiles);
      socket.emit("profilesFetched", processedProfiles);
    } catch (error) {
      console.error("Error fetching profiles:", error);
      socket.emit("error", { message: "Failed to fetch profiles" });
    }
  });

  // Filter list handling
  socket.on("createFilterList", async (data) => {
    if (
      !socket.request.session?.user?.id &&
      !socket.request.session?.user?.character_id
    ) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const { name, ids, enabled, is_exclude, filter_type } = data;
      const userId =
        socket.request.session.user.id ||
        socket.request.session.user.character_id;

      const processedIds = Array.isArray(ids)
        ? ids
        : ids.map((id) => id.trim());

      const result = await pool.query(
        "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [
          userId,
          name,
          JSON.stringify(processedIds),
          enabled ? 1 : 0,
          is_exclude ? 1 : 0,
          filter_type,
        ]
      );

      const newFilterList = {
        id: result.rows[0].id.toString(),
        user_id: userId.toString(),
        name,
        ids: processedIds,
        enabled: Boolean(enabled),
        is_exclude: Boolean(is_exclude),
        filter_type,
      };

      io.to(userId.toString()).emit("filterListCreated", newFilterList);
    } catch (error) {
      console.error("Error creating filter list:", error);
      socket.emit("error", { message: "Failed to create filter list" });
    }
  });

  // Profile handling
  socket.on("saveProfile", async (data) => {
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const userId =
        socket.request.session.user.id ||
        socket.request.session.user.character_id;
      const { name, settings, filterLists } = data;

      const serializedFilterLists = filterLists.map((list) => ({
        ...list,
        id: list.id.toString(),
      }));

      const profileData = JSON.stringify({
        settings,
        filterLists: serializedFilterLists,
      });

      const { rows: existingProfile } = await pool.query(
        "SELECT id FROM user_profiles WHERE user_id = $1 AND name = $2",
        [userId, name]
      );

      let profileId;
      if (existingProfile.length > 0) {
        await pool.query(
          "UPDATE user_profiles SET settings = $1 WHERE id = $2",
          [profileData, existingProfile[0].id]
        );
        profileId = existingProfile[0].id;
      } else {
        const result = await pool.query(
          "INSERT INTO user_profiles (user_id, name, settings) VALUES ($1, $2, $3) RETURNING id",
          [userId, name, profileData]
        );
        profileId = result.rows[0].id;
      }

      const savedProfile = {
        id: profileId.toString(),
        name,
        settings: JSON.parse(profileData),
      };

      socket.emit("profileSaved", savedProfile);
    } catch (error) {
      console.error("Error saving profile:", error);
      socket.emit("error", { message: "Error saving profile" });
    }
  });

  socket.on("loadProfile", async (profileId) => {
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const { rows } = await pool.query(
        "SELECT settings, name FROM user_profiles WHERE id = $1 AND user_id = $2",
        [profileId, socket.request.session.user.id]
      );

      if (!rows[0]) {
        socket.emit("error", { message: "Profile not found" });
        return;
      }

      const profileData = JSON.parse(rows[0].settings);
      socket.emit("profileLoaded", {
        id: profileId,
        name: rows[0].name,
        ...profileData,
      });
    } catch (error) {
      console.error("Error loading profile:", error);
      socket.emit("error", { message: "Error loading profile" });
    }
  });

  socket.on("deleteFilterList", async ({ id }) => {
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      // First verify the filter list belongs to this user
      const { rows } = await pool.query(
        "SELECT user_id FROM filter_lists WHERE id = $1",
        [id]
      );

      if (
        rows.length === 0 ||
        rows[0].user_id !== socket.request.session.user.id
      ) {
        socket.emit("error", {
          message: "Filter list not found or unauthorized",
        });
        return;
      }

      // Delete the filter list
      await pool.query("DELETE FROM filter_lists WHERE id = $1", [id]);

      // Emit the deletion event
      socket.emit("filterListDeleted", { id });
    } catch (error) {
      console.error("Error deleting filter list:", error);
      socket.emit("error", { message: "Failed to delete filter list" });
    }
  });

  socket.on("deleteProfile", async ({ id }) => {
    console.log("Server: Received deleteProfile request for id:", id);
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const result = await pool.query(
        "DELETE FROM user_profiles WHERE id = $1 AND user_id = $2",
        [id, socket.request.session.user.id]
      );

      if (result.rowCount > 0) {
        socket.emit("profileDeleted", id);
      } else {
        socket.emit("error", { message: "Profile not found" });
      }
    } catch (error) {
      console.error("Server: Error deleting profile:", error);
      socket.emit("error", { message: "Error deleting profile" });
    }
  });

  // socket.on("clearKills", () => {
  //   killmails = [];
  //   socket.emit("killmailsCleared");
  // });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Function to poll for new killmails from RedisQ
async function pollRedisQ() {
  try {
    const response = await axios.get(REDISQ_URL, { timeout: 30000 });
    if (response.status === 200 && response.data.package) {
      const killmail = response.data.package;
      const killID = killmail.killID; // Get the ID

      // --- Database Duplicate Check ---
      let isNewKill = false;
      try {
        // Attempt to insert the killID. If it succeeds, it's new.
        await pool.query(
          "INSERT INTO processed_kill_ids (kill_id) VALUES ($1)",
          [killID]
        );
        isNewKill = true;
        // console.log(`Kill ID ${killID} is new, inserting into processed_kill_ids.`);
      } catch (dbError) {
        if (dbError.code === "23505") {
          // PostgreSQL unique violation code
          // Kill ID already exists, it's a duplicate according to the DB
          // console.log(`Kill ID ${killID} already processed (DB check).`);
          isNewKill = false;
        } else {
          // Different database error, log it but maybe still try processing?
          // Or treat as duplicate to be safe? Let's log and skip.
          console.error(`Database error checking kill ID ${killID}:`, dbError);
          isNewKill = false; // Treat DB error as potentially processed
        }
      }
      // --- End Database Check ---

      // Proceed only if it's a new kill according to the DB AND within time window
      if (isNewKill && isWithinLast6Hours(killmail.killmail.killmail_time)) {
        // Check recency *after* DB check
        // Enqueue processing (no need for the in-memory processingKillIDs Set anymore)
        killmailProcessingQueue
          .enqueue(async () => {
            try {
              // Process killmail (adds ships, pinpoints, updates activities)
              const processedKillmail = await processKillmailData(killmail);

              // Add to in-memory cache only if successfully processed
              // Note: processKillmailData should ideally contain its own final duplicate check
              // against the 'killmails' array before push/emit as a last safeguard,
              // but the DB check prevents most duplicates from even reaching here.
              if (processedKillmail) {
                // Assuming processKillmailData handles adding to 'killmails' and emitting
                // (The original code did this)
              }
            } catch (error) {
              console.error(
                `Error processing killmail ${killID} in queue:`,
                error
              );
              // Should we remove from processed_kill_ids if processing fails catastrophically?
              // Potentially, but for simplicity, we leave it, assuming the error isn't recoverable by reprocessing.
            }
            // No 'finally' block needed here to remove from a Set
          })
          .catch((err) => {
            console.error(`Error enqueueing killmail task for ${killID}:`, err);
            // If enqueueing fails, the ID is already in the DB, preventing reprocessing later.
          });
      }
    }
  } catch (error) {
    if (error.code !== "ECONNABORTED" && error.code !== "ETIMEDOUT") {
      console.error("Error polling RedisQ:", error.message);
    }
  } finally {
    setTimeout(pollRedisQ, 50); // Schedule next poll
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
