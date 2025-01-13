// new server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import axios from "axios";
import { createClient as createSqlClient } from "@libsql/client";
import { isGateCamp, updateCamps } from "./campStore.js";
import roamStore, { activeRoams } from "./roamStore.js";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";
import session from "express-session";
import RedisStore from "connect-redis";
import { createClient as createRedisClient } from "redis";
import { compare } from "bcrypt";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
let activeCamps = new Map();
let isDatabaseInitialized = false;

const db = createSqlClient({
  url: process.env.LIBSQL_URL || "file:zcamp.db",
  authToken: process.env.LIBSQL_AUTH_TOKEN,
});

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
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    domain:
      process.env.NODE_ENV === "production"
        ? new URL(PUBLIC_URL).hostname
        : undefined,
    path: "/",
  },
  proxy: true, // Add this for proper HTTPS handling behind proxy
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
  console.log("Attempting to connect to database:", process.env.LIBSQL_URL);
  console.log("Auth token present:", !!process.env.LIBSQL_AUTH_TOKEN);

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        settings TEXT,
        character_id TEXT UNIQUE,
        character_name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry INTEGER
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS filter_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        ids TEXT,
        enabled INTEGER,
        is_exclude INTEGER,
        filter_type TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        settings TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS celestial_data (
        system_id INTEGER PRIMARY KEY,
        system_name TEXT,
        celestial_data TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS ship_types (
        ship_type_id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS camp_crushers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          character_name TEXT NOT NULL,
          target_camp_id TEXT,
          target_start_time DATETIME,
          bashbucks INTEGER DEFAULT 0,
          FOREIGN KEY(character_id) REFERENCES users(character_id)
      )
  `);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS camp_crusher_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        camp_id TEXT NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        FOREIGN KEY(character_id) REFERENCES users(character_id)
    )
`);

    console.log("Database initialized successfully");
    isDatabaseInitialized = true;
  } catch (err) {
    console.error("Error initializing database:", err);
    isDatabaseInitialized = false;
  }
}

// CAMPCRUSHERS API
app.get("/api/campcrushers/stats", async (req, res) => {
  if (!req.session?.user?.character_id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { rows } = await db.execute({
      sql: "SELECT character_name, bashbucks FROM camp_crushers WHERE character_id = ?",
      args: [req.session.user.character_id],
    });

    if (rows.length === 0) {
      // Initialize new player
      await db.execute({
        sql: "INSERT INTO camp_crushers (character_id, character_name, bashbucks) VALUES (?, ?, 0)",
        args: [req.session.user.character_id, req.session.user.character_name],
      });
      return res.json({ bashbucks: 0 });
    }

    return res.json({ bashbucks: rows[0].bashbucks });
  } catch (error) {
    console.error("Error fetching camp crusher stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/campcrushers/target", async (req, res) => {
  if (!req.session?.user?.character_id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { campId } = req.body;
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour

  try {
    // Check for existing active target
    const { rows } = await db.execute({
      sql: "SELECT id FROM camp_crusher_targets WHERE character_id = ? AND completed = FALSE AND end_time > CURRENT_TIMESTAMP",
      args: [req.session.user.character_id],
    });

    if (rows.length > 0) {
      return res.status(400).json({ error: "Active target already exists" });
    }

    // Create new target
    await db.execute({
      sql: "INSERT INTO camp_crusher_targets (character_id, camp_id, start_time, end_time) VALUES (?, ?, ?, ?)",
      args: [req.session.user.character_id, campId, startTime, endTime],
    });

    res.json({ success: true, endTime });
  } catch (error) {
    console.error("Error setting camp crusher target:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/campcrushers/leaderboard", async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT character_name, bashbucks FROM camp_crushers ORDER BY bashbucks DESC LIMIT 100",
    });

    res.json(rows);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add health check endpoint
app.get("/health", async (_, res) => {
  try {
    if (!isDatabaseInitialized) {
      console.log("Health check failed: Database not yet initialized");
      return res.status(503).json({
        status: "initializing",
        killmails: killmails.length,
        lastPoll: new Date().toISOString(),
      });
    }

    // Test database connection with a simple query
    const result = await db.execute("SELECT 1 as health_check");
    if (result.rows?.[0]?.health_check === 1) {
      console.log("Health check passed");
      return res.status(200).json({
        status: "healthy",
        killmails: killmails.length,
        lastPoll: new Date().toISOString(),
        redisConnected: redisClient.isReady,
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

const SHIP_CATEGORIES = {
  AT_SHIP_IDS: [
    2836, 74316, 42246, 32788, 33675, 33397, 32790, 35781, 32207, 74141, 35779,
    60764, 3516, 32209, 33395, 42245, 60765, 26842, 2834, 3518, 33673,
  ],
};

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
function isWithinLast24Hours(killmailTime) {
  const now = new Date();
  const killTime = new Date(killmailTime);
  const timeDiff = now - killTime;
  return timeDiff <= 24 * 60 * 60 * 1000; // 24 hours in milliseconds
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
    const { rows } = await db.execute({
      sql: "SELECT category FROM ship_types WHERE ship_type_id = ?",
      args: [shipTypeId],
    });
    return rows[0]?.category;
  } catch (err) {
    console.error(`Database error fetching ship type ${shipTypeId}:`, err);
    throw err;
  }
}

async function storeShipCategory(shipTypeId, category) {
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO ship_types (ship_type_id, category, last_updated) 
            VALUES (?, ?, CURRENT_TIMESTAMP)`,
      args: [shipTypeId, category],
    });
  } catch (error) {
    console.error(`Database error storing ship type ${shipTypeId}:`, error);
    throw error;
  }
}

function serializeData(data) {
  if (typeof data === "bigint") {
    return data.toString();
  } else if (Array.isArray(data)) {
    return data.map(serializeData);
  } else if (typeof data === "object" && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, serializeData(value)])
    );
  }
  return data;
}

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

    // Check for CONCORD group specifically
    if (response.data.group_id === 1180) {
      return "concord";
    }

    if (response.data.group_id === 29) {
      return "capsule";
    }

    // Check AT ships
    if (SHIP_CATEGORIES.AT_SHIP_IDS.includes(typeId)) {
      return "at_ship";
    }

    // Check if it's an NPC based on killmail data
    // Fixed version
    if (killmail && isNPC(typeId, killmail)) {
      return "npc";
    }

    let marketGroupId = response.data.market_group_id;
    if (!marketGroupId) {
      return "unknown";
    }

    // Market group checks for player ships
    while (marketGroupId) {
      const marketResponse = await axios.get(
        `https://esi.evetech.net/latest/markets/groups/${marketGroupId}/`
      );

      if (PARENT_MARKET_GROUPS.CAPITALS.includes(marketGroupId)) {
        return "capital";
      } else if (PARENT_MARKET_GROUPS.STRUCTURES.includes(marketGroupId)) {
        return "structure";
      } else if (PARENT_MARKET_GROUPS.SHUTTLES.includes(marketGroupId)) {
        return "shuttle";
      } else if (PARENT_MARKET_GROUPS.FIGHTERS.includes(marketGroupId)) {
        return "fighter";
      } else if (marketGroupId === PARENT_MARKET_GROUPS.CORVETTES) {
        return "corvette";
      } else if (PARENT_MARKET_GROUPS.FRIGATES.includes(marketGroupId)) {
        return "frigate";
      } else if (PARENT_MARKET_GROUPS.DESTROYERS.includes(marketGroupId)) {
        return "destroyer";
      } else if (PARENT_MARKET_GROUPS.CRUISERS.includes(marketGroupId)) {
        return "cruiser";
      } else if (PARENT_MARKET_GROUPS.BATTLECRUISERS.includes(marketGroupId)) {
        return "battlecruiser";
      } else if (PARENT_MARKET_GROUPS.BATTLESHIPS.includes(marketGroupId)) {
        return "battleship";
      } else if (marketGroupId === PARENT_MARKET_GROUPS.INDUSTRIAL) {
        return "industrial";
      } else if (marketGroupId === PARENT_MARKET_GROUPS.MINING) {
        return "mining";
      }

      marketGroupId = marketResponse.data.parent_group_id;
    }

    return "unknown";
  } catch (error) {
    console.error(`Error determining category for ship type ${typeId}:`, error);
    return "unknown";
  }
}

async function getShipCategory(shipTypeId, killmail) {
  if (!shipTypeId) return null;

  try {
    // First check database with await
    let category = await getShipCategoryFromDb(shipTypeId);

    // If not in database, determine category and store it
    if (!category) {
      category = await determineShipCategory(shipTypeId, killmail);
      // Ensure we wait for the storage operation to complete
      await storeShipCategory(shipTypeId, category);
      console.log(`Stored new ship category for ${shipTypeId}: ${category}`);
    }

    return category;
  } catch (error) {
    console.error(`Error getting ship category for ${shipTypeId}:`, error);
    return null;
  }
}

async function addShipCategoriesToKillmail(killmail) {
  console.log(
    "Starting addShipCategoriesToKillmail for killmail:",
    killmail.killID
  );

  try {
    console.log("Fetching victim ship category...");
    const victimCategory = await getShipCategory(
      killmail.killmail.victim.ship_type_id,
      killmail
    );
    console.log("Victim category:", victimCategory);

    if (!victimCategory) {
      console.log("No valid victim category found");
      return killmail;
    }

    killmail.shipCategories = {
      victim: victimCategory,
      attackers: [],
    };

    console.log("Processing attacker ship types...");
    const attackerShipTypes = killmail.killmail.attackers
      .map((attacker) => attacker.ship_type_id)
      .filter((shipTypeId) => shipTypeId);

    console.log("Unique attacker ship types:", attackerShipTypes);

    for (const shipTypeId of attackerShipTypes) {
      console.log(`Processing ship type: ${shipTypeId}`);
      const category = await getShipCategory(shipTypeId, killmail);
      console.log(`Category for ship type ${shipTypeId}:`, category);

      if (category) {
        killmail.shipCategories.attackers.push({
          shipTypeId,
          category,
        });
      }
    }

    console.log("Completed ship categories processing");
    return killmail;
  } catch (error) {
    console.error("Fatal error in addShipCategoriesToKillmail:", error);
    throw error;
  }
}

// Function to get the total size of a user's filter lists
async function getFilterListsSize(userId) {
  try {
    const { rows } = await db.execute({
      sql: "SELECT COUNT(*) as count FROM filter_lists WHERE user_id = ?",
      args: [userId],
    });
    return rows[0].count;
  } catch (err) {
    console.error("Error getting filter lists size:", err);
    throw err;
  }
}

async function fetchCelestialData(systemId) {
  console.log(`Fetching celestial data for system ${systemId}`);

  try {
    // Check database first - with a short timeout
    try {
      const dbPromise = db.execute({
        sql: "SELECT celestial_data FROM celestial_data WHERE system_id = ?",
        args: [systemId],
      });

      const { rows } = await Promise.race([
        dbPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database timeout")), 2000)
        ),
      ]);

      // If found in database, return it
      if (rows[0]?.celestial_data) {
        return JSON.parse(rows[0].celestial_data);
      }
    } catch (dbError) {
      console.error(`Database error for system ${systemId}:`, dbError);
      // Continue to API call if database fails
    }

    // If not in database, fetch from API - with its own timeout
    const apiPromise = axios.get(
      `https://www.fuzzwork.co.uk/api/mapdata.php?solarsystemid=${systemId}&format=json`
    );

    const response = await Promise.race([
      apiPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("API timeout")), 5000)
      ),
    ]);

    if (!Array.isArray(response.data)) {
      throw new Error(`Invalid API response for system ${systemId}`);
    }

    // Store in database - non-blocking
    db.execute({
      sql: `REPLACE INTO celestial_data 
            (system_id, system_name, celestial_data, last_updated) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        systemId,
        response.data[0]?.solarsystemname || String(systemId),
        JSON.stringify(response.data),
      ],
    }).catch((err) => {
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

    // Update database
    if (req.session?.user?.character_id) {
      await db.execute({
        sql: `UPDATE users SET access_token = ?, refresh_token = ?, token_expiry = ? WHERE character_id = ?`,
        args: [
          access_token,
          new_refresh_token,
          token_expiry,
          req.session.user.character_id,
        ],
      });
    }

    // Update session with new tokens
    req.session.user = {
      ...req.session.user,
      access_token,
      refresh_token: new_refresh_token,
      token_expiry,
    };

    // Explicitly save session to Redis
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          reject(err);
          return;
        }
        console.log("Session updated in Redis with new tokens");
        resolve();
      });
    });

    res.json({
      access_token,
      refresh_token: new_refresh_token,
      token_expiry,
    });
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

    await db.execute({
      sql: "INSERT INTO users (username, password, settings) VALUES (?, ?, ?)",
      args: [username, hashedPassword, JSON.stringify({})],
    });

    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint failed")) {
      res
        .status(409)
        .json({ success: false, message: "Username already exists" });
    } else {
      console.error("Registration error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
});

// Modify in server.js
app.post("/api/filter-list", async (req, res) => {
  console.log("Received filter list creation request:", req.body);

  if (!req.session?.user?.id) {
    console.log("User not authenticated");
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }

  try {
    const { name, ids, enabled, isExclude, filterType } = req.body;
    const userId = req.session.user.id;

    console.log("Processing filter list creation:", {
      userId,
      name,
      idsLength: ids?.length,
      enabled,
      isExclude,
      filterType,
    });

    // Process IDs based on filter type
    let processedIds;
    if (filterType === "region") {
      processedIds = Array.isArray(ids) ? ids : ids.split(",");
      processedIds = processedIds.map((id) => id.trim());
    } else {
      processedIds = Array.isArray(ids)
        ? ids
        : ids.split(",").map((id) => id.trim());
    }

    console.log("Processed IDs:", processedIds);

    // Insert into database
    const result = await db.execute({
      sql: "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        userId,
        name,
        JSON.stringify(processedIds),
        enabled ? 1 : 0,
        isExclude ? 1 : 0,
        filterType || null,
      ],
    });

    console.log("Database insert result:", result);

    // Convert BigInt to string for the ID
    const newFilterList = {
      id: result.lastInsertRowid.toString(),
      user_id: userId.toString(),
      name,
      ids: processedIds,
      enabled: Boolean(enabled),
      is_exclude: Boolean(isExclude),
      filter_type: filterType || null,
    };

    console.log("Emitting new filter list to clients:", newFilterList);

    // Emit to connected clients
    io.to(userId.toString()).emit("filterListCreated", newFilterList);

    res.json({ success: true, filterList: newFilterList });
  } catch (error) {
    console.error("Error creating filter list:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.put("/api/filter-list/:id", async (req, res) => {
  const { name, ids, enabled, isExclude, filterType } = req.body;
  const id = req.params.id;

  try {
    const { rows } = await db.execute({
      sql: "SELECT user_id FROM filter_lists WHERE id = ?",
      args: [id],
    });

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Filter list not found" });
    }

    const userId = rows[0].user_id;

    await db.execute({
      sql: "UPDATE filter_lists SET name = ?, ids = ?, enabled = ?, is_exclude = ?, filter_type = ? WHERE id = ?",
      args: [
        name,
        JSON.stringify(ids),
        enabled ? 1 : 0,
        isExclude ? 1 : 0,
        filterType || null,
        id,
      ],
    });

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

    const result = await db.execute({
      sql: "INSERT INTO user_profiles (user_id, name, settings) VALUES (?, ?, ?)",
      args: [userId, name, profileData],
    });

    const newProfile = {
      id: result.lastInsertRowid, // Use lastInsertRowid instead of lastInsertId
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
    const { rows } = await db.execute({
      sql: "SELECT * FROM filter_lists WHERE user_id = ?",
      args: [req.params.userId],
    });

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
  console.log("Session check details:", {
    hasSession: !!req.session,
    hasUser: !!req.session?.user,
    sessionID: req.sessionID,
    sessionData: req.session,
    cookies: req.headers.cookie,
  });

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
    // Add filter lists fetch
    const { rows: filterLists } = await db.execute({
      sql: "SELECT * FROM filter_lists WHERE user_id = ?",
      args: [req.session.user.id],
    });

    const processedFilterLists = filterLists.map((list) => ({
      ...list,
      id: list.id.toString(), // Convert ID to string
      user_id: list.user_id.toString(), // Convert user_id to string
      ids: JSON.parse(list.ids || "[]"),
      enabled: Boolean(list.enabled),
      is_exclude: Boolean(list.is_exclude),
      filter_type: list.filter_type || null, // Ensure filter_type is included
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

    const { rows } = await db.execute({
      sql: "SELECT * FROM users WHERE username = ?",
      args: [username],
    });

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
    const { rows: filterLists } = await db.execute({
      sql: "SELECT * FROM filter_lists WHERE user_id = ?",
      args: [user.id],
    });

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
      const { rows: existingUser } = await db.execute({
        sql: "SELECT id, settings FROM users WHERE character_id = ?",
        args: [characterId],
      });

      let userId;
      let userSettings = {};

      if (existingUser.length > 0) {
        console.log("Updating existing user...");
        userId = existingUser[0].id;
        userSettings = JSON.parse(existingUser[0].settings || "{}");

        await db.execute({
          sql: `UPDATE users 
                SET access_token = ?, refresh_token = ?, character_name = ?, token_expiry = ? 
                WHERE character_id = ?`,
          args: [
            access_token,
            refresh_token,
            characterName,
            token_expiry,
            characterId,
          ],
        });
      } else {
        console.log("Creating new user...");
        const result = await db.execute({
          sql: `INSERT INTO users 
                (character_id, character_name, access_token, refresh_token, token_expiry, settings) 
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            characterId,
            characterName,
            access_token,
            refresh_token,
            token_expiry,
            "{}",
          ],
        });
        userId = result.lastInsertRowid;
      }

      // Fetch filter lists
      const { rows: filterLists } = await db.execute({
        sql: "SELECT * FROM filter_lists WHERE user_id = ?",
        args: [userId],
      });

      const processedFilterLists = filterLists.map((list) => ({
        id: list.id.toString(),
        user_id: list.user_id.toString(),
        name: list.name,
        ids: JSON.parse(list.ids || "[]"),
        enabled: Boolean(list.enabled),
        is_exclude: Boolean(list.is_exclude),
        filter_type: list.filter_type || null,
      }));

      console.log("Processed filter lists:", processedFilterLists);

      // Session setup
      if (!req.session) {
        console.log("Creating new session...");
        req.session = {};
      }

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
  // Constants
  const KM_PER_AU = 149597870.7;
  const THRESHOLDS = {
    AT_CELESTIAL: 10000, // 10km
    NEAR_CELESTIAL: 10000000, // 10,000km
    MAX_BOX_SIZE: KM_PER_AU * 100,
  };

  // Early validation
  if (!killPosition?.x || !killPosition?.y || !killPosition?.z) {
    console.error("Invalid kill position:", killPosition);
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: false,
      nearestCelestial: null,
      triangulationPossible: false,
    };
  }

  // Find nearest celestial
  let nearest = null;
  let minDistance = Infinity;
  let bestPoints = [];
  let minVolume = Infinity;

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

  // If we're at or very near a celestial, no need for tetrahedron
  if (nearest && minDistance <= THRESHOLDS.AT_CELESTIAL) {
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: true,
      nearestCelestial: nearest,
      triangulationPossible: true,
    };
  }

  if (nearest && minDistance <= THRESHOLDS.NEAR_CELESTIAL) {
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: false,
      nearestCelestial: nearest,
      triangulationPossible: true,
    };
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
    // Try to find tetrahedron containing kill point
    for (let i = 0; i < Math.min(validCelestials.length - 3, 10); i++) {
      for (let j = i + 1; j < Math.min(validCelestials.length - 2, 11); j++) {
        for (let k = j + 1; k < Math.min(validCelestials.length - 1, 12); k++) {
          for (let l = k + 1; l < Math.min(validCelestials.length, 13); l++) {
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
                tetraPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }))
              )
            ) {
              const volume = calculateTetrahedronVolume(
                tetraPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }))
              );
              if (volume < minVolume && volume < THRESHOLDS.MAX_BOX_SIZE) {
                minVolume = volume;
                bestPoints = tetraVectors;
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
  };
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

function isPointInTetrahedron(point, tetraPoints) {
  const [a, b, c, d] = tetraPoints;

  const p = {
    x: parseFloat(point.x),
    y: parseFloat(point.y),
    z: parseFloat(point.z),
  };

  const vap = subtractVectors(p, a);
  const vbp = subtractVectors(p, b);
  const vcp = subtractVectors(p, c);
  const vdp = subtractVectors(p, d);

  const vab = subtractVectors(b, a);
  const vac = subtractVectors(c, a);
  const vad = subtractVectors(d, a);

  const va6 = calculateTetrahedronVolume([a, b, c, d]);
  const v1 = dotProduct(crossProduct(vab, vac), vad);

  const v2 = dotProduct(crossProduct(vap, vcp), vdp) / v1;
  const v3 = dotProduct(crossProduct(vab, vap), vdp) / v1;
  const v4 = dotProduct(crossProduct(vap, vac), vbp) / v1;
  const v5 = 1 - v2 - v3 - v4;

  const epsilon = 0.0001;
  return (
    v2 >= -epsilon &&
    v2 <= 1 + epsilon &&
    v3 >= -epsilon &&
    v3 <= 1 + epsilon &&
    v4 >= -epsilon &&
    v4 <= 1 + epsilon &&
    v5 >= -epsilon &&
    v5 <= 1 + epsilon
  );
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
    const result = await db.execute({
      sql: "SELECT user_id FROM filter_lists WHERE id = ?",
      args: [id],
    });
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Filter list not found" });
    }

    // Check if updating this list would exceed the size limit
    const currentSize = await getFilterListsSize(filterList.user_id);
    const newListSize = JSON.stringify({
      name,
      ids,
      enabled,
      isExclude,
      filterType,
    }).length;
    const oldListSize = JSON.stringify(
      await db.get("SELECT * FROM filter_lists WHERE id = ?", [id])
    ).length;
    if (currentSize - oldListSize + newListSize > 1024 * 1024) {
      // 1MB limit
      return res
        .status(400)
        .json({ success: false, message: "Filter lists size limit exceeded" });
    }

    db.run(
      "UPDATE filter_lists SET name = ?, ids = ?, enabled = ?, is_exclude = ?, filter_type = ? WHERE id = ?",
      [
        name,
        JSON.stringify(ids),
        enabled ? 1 : 0,
        isExclude ? 1 : 0,
        filterType || null,
        id,
      ],
      function (err) {
        if (err) {
          console.error("Error updating filter list:", err);
          res
            .status(500)
            .json({ success: false, message: "Error updating filter list" });
        } else {
          console.log("Updated filter list:", {
            id,
            name,
            ids,
            enabled,
            isExclude,
            filterType,
          });
          res.json({ success: true });
        }
      }
    );
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Delete a filter list
app.delete("/api/filter-list/:id", async (req, res) => {
  try {
    await db.execute({
      sql: "DELETE FROM filter_lists WHERE id = ?",
      args: [req.params.id],
    });
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

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.emit("initialCamps", Array.from(activeCamps.values()));

  const initialRoams = roamStore.getRoams();
  socket.emit("initialRoams", initialRoams);

  if (socket.request.session?.user?.id) {
    const userId = socket.request.session.user.id.toString();
    socket.join(userId);
    console.log(`User ${userId} joined their socket room`);
  }

  socket.on("fetchProfiles", async () => {
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const { rows } = await db.execute({
        sql: "SELECT id, name, settings FROM user_profiles WHERE user_id = ?",
        args: [socket.request.session.user.id],
      });

      const profiles = rows.map((row) => ({
        id: row.id,
        name: row.name,
        settings: JSON.parse(row.settings),
      }));

      socket.emit("profilesFetched", profiles);
    } catch (error) {
      console.error("Error fetching profiles:", error);
      socket.emit("error", { message: "Error fetching profiles" });
    }
  });

  socket.on("deleteProfile", async ({ id }) => {
    console.log("Server: Received deleteProfile request for id:", id);
    if (!socket.username) {
      socket.emit("error", { message: "Not logged in" });
      return;
    }

    try {
      const { rows } = await db.execute({
        sql: "SELECT id FROM users WHERE username = ?",
        args: [socket.username],
      });

      if (!rows[0]) {
        socket.emit("error", { message: "User not found" });
        return;
      }

      const result = await db.execute({
        sql: "DELETE FROM user_profiles WHERE id = ? AND user_id = ?",
        args: [id, rows[0].id],
      });

      if (result.rowsAffected > 0) {
        socket.emit("profileDeleted", id);
      } else {
        socket.emit("error", { message: "Profile not found" });
      }
    } catch (error) {
      console.error("Server: Error deleting profile:", error);
      socket.emit("error", { message: "Error deleting profile" });
    }
  });

  socket.on("clearKills", () => {
    killmails = [];
    socket.emit("killmailsCleared");
  });

  socket.on("updateSettings", async (newSettings) => {
    if (socket.username) {
      try {
        await db.execute({
          sql: "UPDATE users SET settings = ? WHERE username = ?",
          args: [JSON.stringify(newSettings), socket.username],
        });
        console.log("Settings updated for user:", socket.username);
      } catch (err) {
        console.error("Error updating settings:", err);
      }
    }
  });

  socket.on("createFilterList", async (data) => {
    console.log("Received createFilterList event:", data);

    if (!socket.request.session?.user?.id) {
      console.log("Rejecting createFilterList - user not authenticated");
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const { name, ids, enabled, is_exclude, filter_type } = data;
      const userId = socket.request.session.user.id;

      console.log("Processing filter list creation for user:", userId, {
        name,
        ids,
        enabled,
        is_exclude,
        filter_type,
      });

      // Process IDs based on filter type
      const processedIds = Array.isArray(ids)
        ? ids
        : ids.map((id) => id.trim());

      console.log(
        "Inserting filter list into database with processed IDs:",
        processedIds
      );

      const result = await db.execute({
        sql: "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          userId,
          name,
          JSON.stringify(processedIds),
          enabled ? 1 : 0,
          is_exclude ? 1 : 0,
          filter_type,
        ],
      });

      console.log("Database insert result:", result);

      const newFilterList = {
        id: result.lastInsertRowid.toString(),
        user_id: userId.toString(),
        name,
        ids: processedIds,
        enabled: Boolean(enabled),
        is_exclude: Boolean(is_exclude),
        filter_type,
      };

      console.log(
        "Broadcasting new filter list to room:",
        userId,
        newFilterList
      );

      // Emit to user's room
      io.to(userId.toString()).emit("filterListCreated", newFilterList);

      // Emit success back to sending socket
      socket.emit("filterListCreated", newFilterList);
    } catch (error) {
      console.error("Error creating filter list:", error);
      socket.emit("error", {
        message: "Failed to create filter list",
        details: error.message,
      });
    }
  });

  socket.on(
    "updateFilterList",
    async ({ id, name, ids, enabled, is_exclude, filter_type }) => {
      const processedIds = Array.isArray(ids)
        ? ids
        : typeof ids === "string"
        ? JSON.parse(ids)
        : ids;

      try {
        const { rows } = await db.execute({
          sql: "SELECT user_id FROM filter_lists WHERE id = ?",
          args: [id],
        });

        if (rows.length === 0) {
          socket.emit("error", { message: "Filter list not found" });
          return;
        }

        await db.execute({
          sql: "UPDATE filter_lists SET name = ?, ids = ?, enabled = ?, is_exclude = ?, filter_type = ? WHERE id = ?",
          args: [
            name,
            JSON.stringify(processedIds),
            enabled ? 1 : 0,
            is_exclude ? 1 : 0,
            filter_type,
            id,
          ],
        });

        const updatedList = {
          id: id.toString(),
          user_id: rows[0].user_id.toString(),
          name,
          ids: processedIds,
          enabled: Boolean(enabled),
          is_exclude: Boolean(is_exclude),
          filter_type,
        };

        // Emit to specific user's room
        io.to(rows[0].user_id.toString()).emit(
          "filterListUpdated",
          updatedList
        );
        socket.emit("filterListUpdated", updatedList);
      } catch (err) {
        console.error("Error updating filter list:", err);
        socket.emit("error", { message: "Failed to update filter list" });
      }
    }
  );
  socket.on("deleteFilterList", async ({ id }) => {
    try {
      await db.execute({
        sql: "DELETE FROM filter_lists WHERE id = ?",
        args: [id],
      });
      console.log("Deleted filter list:", id);
      socket.emit("filterListDeleted", { id });
    } catch (err) {
      console.error("Error deleting filter list:", err);
    }
  });

  socket.on("saveProfile", async (data) => {
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const userId = socket.request.session.user.id;
      const { name, settings, filterLists } = data;

      // Convert BigInt values to strings in filterLists
      const serializedFilterLists = filterLists.map((list) => ({
        ...list,
        id: list.id.toString(), // Convert BigInt to string
      }));

      const profileData = JSON.stringify({
        settings,
        filterLists: serializedFilterLists,
      });

      // Check if the profile already exists
      const { rows: existingProfile } = await db.execute({
        sql: "SELECT id FROM user_profiles WHERE user_id = ? AND name = ?",
        args: [userId, name],
      });

      let profileId;
      if (existingProfile[0]) {
        // Update existing profile
        await db.execute({
          sql: "UPDATE user_profiles SET settings = ? WHERE id = ?",
          args: [profileData, existingProfile[0].id],
        });
        profileId = existingProfile[0].id;
      } else {
        // Insert new profile
        const result = await db.execute({
          sql: "INSERT INTO user_profiles (user_id, name, settings) VALUES (?, ?, ?)",
          args: [userId, name, profileData],
        });
        profileId = result.lastInsertRowid; // Use lastInsertRowid
      }

      // Create the saved profile object
      const savedProfile = {
        id: profileId.toString(), // Convert BigInt to string
        name,
        settings: JSON.parse(profileData),
      };

      // Emit the saved profile to the client
      socket.emit("profileSaved", savedProfile);
    } catch (error) {
      console.error("Error saving profile:", error);
      socket.emit("error", { message: "Error saving profile" });
    }
  });

  // Account routes
  socket.on("login", async ({ username, password }) => {
    try {
      // Log incoming data
      console.log(
        "Login attempt - username type:",
        typeof username,
        "password type:",
        typeof password
      );

      // Ensure clean string values and null checks
      if (!username || !password) {
        socket.emit("loginError", {
          message: "Username and password are required",
        });
        return;
      }

      const cleanUsername = String(username).trim();
      const cleanPassword = String(password).trim();

      // Log the query we're about to execute
      console.log("Executing user query for username:", cleanUsername);

      const { rows } = await db.execute({
        sql: "SELECT id, username, password, settings, character_id, character_name, access_token FROM users WHERE username = ?",
        args: [cleanUsername],
      });

      console.log("Query result rows:", rows?.length);

      const user = rows[0];

      if (user) {
        try {
          const match = await compare(cleanPassword, user.password);

          if (match) {
            // Create a clean session user object
            const sessionUser = {
              id: Number(user.id),
              username: String(user.username),
              character_id: user.character_id
                ? String(user.character_id)
                : null,
              character_name: user.character_name
                ? String(user.character_name)
                : null,
              access_token: user.access_token
                ? String(user.access_token)
                : null,
            };

            // Save to session
            socket.request.session.user = sessionUser;

            await new Promise((resolve, reject) => {
              socket.request.session.save((err) => {
                if (err) {
                  console.error("Session save error:", err);
                  reject(err);
                  return;
                }
                console.log("Session saved with user:", sessionUser);
                resolve();
              });
            });

            socket.username = cleanUsername;

            // Fetch filter lists with proper error handling
            try {
              const { rows: filterLists } = await db.execute({
                sql: "SELECT * FROM filter_lists WHERE user_id = ?",
                args: [sessionUser.id],
              });

              // Process filter lists properly
              const processedFilterLists = filterLists.map((list) => ({
                id: list.id.toString(),
                user_id: list.user_id.toString(),
                name: list.name,
                ids: JSON.parse(list.ids || "[]"),
                enabled: Boolean(list.enabled),
                is_exclude: Boolean(list.is_exclude),
                filter_type: list.filter_type || null,
              }));

              console.log(
                "Sending processed filter lists to client:",
                processedFilterLists
              );

              socket.emit("loginSuccess", {
                settings: user.settings ? JSON.parse(user.settings) : {},
                filterLists: processedFilterLists,
              });
            } catch (filterError) {
              console.error("Error fetching filter lists:", filterError);
              socket.emit("loginSuccess", {
                settings: user.settings ? JSON.parse(user.settings) : {},
                filterLists: [],
              });
            }
          } else {
            socket.emit("loginError", { message: "Invalid credentials" });
          }
        } catch (compareError) {
          console.error("Password comparison error:", compareError);
          socket.emit("loginError", { message: "Error verifying credentials" });
        }
      } else {
        socket.emit("loginError", { message: "User not found" });
      }
    } catch (err) {
      console.error("Detailed login error:", {
        error: err,
        message: err.message,
        stack: err.stack,
        username: username ? "provided" : "missing",
        password: password ? "provided" : "missing",
      });

      socket.emit("loginError", {
        message: "Error during login",
        details: err.message,
      });
    }
  });

  socket.on("requestSync", async () => {
    if (!socket.username) {
      socket.emit("syncError", { message: "Not authenticated" });
      return;
    }

    try {
      const userData = await getUserData(socket.username);
      socket.emit("syncComplete", userData);
    } catch (error) {
      socket.emit("syncError", { message: error.message });
    }
  });

  socket.on("loadProfile", async (profileId) => {
    if (!socket.request.session?.user?.id) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    try {
      const { rows } = await db.execute({
        sql: `SELECT settings, name FROM user_profiles 
              WHERE id = ? AND user_id = ?`,
        args: [profileId, socket.request.session.user.id],
      });

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

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

async function processKillmail(killmail) {
  console.log("Starting processKillmail", {
    killID: killmail.killID,
    systemId: killmail.killmail.solar_system_id,
    time: killmail.killmail.killmail_time,
  });

  try {
    const systemId = killmail.killmail.solar_system_id;

    console.log("Fetching celestial data...");
    const celestialData = await fetchCelestialData(systemId);
    console.log(
      "Celestial data fetched:",
      celestialData && celestialData.length
    );

    // Calculate pinpoint data including nearest celestial
    console.log("Calculating pinpoints...");
    const pinpointData = calculatePinpoints(
      celestialData,
      killmail.killmail.victim.position
    );
    // console.log("Pinpoint data calculated:", pinpointData);

    // Get the first celestial entry which contains system info
    const systemInfo = celestialData?.[0];
    const celestialInfo = systemInfo
      ? {
          regionid: systemInfo.regionid,
          regionname: systemInfo.regionname,
          solarsystemid: systemInfo.solarsystemid,
          solarsystemname: systemInfo.solarsystemname,
        }
      : {
          regionid: null,
          regionname: null,
          solarsystemid: systemId,
          solarsystemname: null,
        };
    pinpointData.celestialData = celestialInfo;

    // Check for camp crusher rewards
    console.log("Checking camp crusher targets...");
    try {
      const { rows: targets } = await db.execute({
        sql: `SELECT ct.*, cc.bashbucks 
              FROM camp_crusher_targets ct 
              JOIN camp_crushers cc ON ct.character_id = cc.character_id 
              WHERE ct.camp_id = ? AND ct.completed = FALSE AND ct.end_time > CURRENT_TIMESTAMP`,
        args: [killmail.killmail.solar_system_id],
      });
      console.log(`Found ${targets.length} potential camp crusher targets`);

      for (const target of targets) {
        const isAttacker = killmail.killmail.attackers.some(
          (a) => a.character_id === target.character_id
        );

        if (isAttacker) {
          console.log(
            `Processing camp crusher reward for character ${target.character_id}`
          );
          const bashbucksAwarded = Math.floor(
            killmail.zkb.totalValue / 1000000
          );

          await db.execute({
            sql: "UPDATE camp_crushers SET bashbucks = bashbucks + ? WHERE character_id = ?",
            args: [bashbucksAwarded, target.character_id],
          });

          await db.execute({
            sql: "UPDATE camp_crusher_targets SET completed = TRUE WHERE id = ?",
            args: [target.id],
          });

          io.to(target.character_id).emit("bashbucksAwarded", {
            amount: bashbucksAwarded,
            newTotal: target.bashbucks + bashbucksAwarded,
            killmail: {
              id: killmail.killID,
              value: killmail.zkb.totalValue,
              system: celestialInfo.solarsystemname || systemId,
            },
          });
        }
      }
    } catch (error) {
      console.error("Error processing camp crusher rewards:", error);
    }

    return {
      ...killmail,
      pinpoints: pinpointData,
    };
  } catch (error) {
    console.error("Fatal error in processKillmail:", error);
    throw error;
  }
}

// Function to poll for new killmails from RedisQ
// Modify the polling function to use processKillmail
// Function to poll for new killmails from RedisQ
async function pollRedisQ() {
  try {
    // Add timestamp to all logs
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] Polling RedisQ... Current killmails: ${killmails.length}`
    );

    const response = await axios.get(REDISQ_URL, {
      timeout: 30000, // 30 second timeout
      headers: {
        "User-Agent": "KM-Hunter/1.0.0", // Add user agent
      },
    });

    console.log(`[${timestamp}] RedisQ response status: ${response.status}`);

    if (response.status === 200) {
      if (response.data.package) {
        const killmail = response.data.package;
        console.log(`[${timestamp}] Received killmail:`, {
          id: killmail.killID,
          system: killmail.killmail.solar_system_id,
          time: killmail.killmail.killmail_time,
          totalValue: killmail.zkb?.totalValue,
        });

        // Clean old killmails first
        const beforeCleanCount = killmails.length;
        killmails = cleanKillmailsCache(killmails);
        console.log(
          `[${timestamp}] Cleaned killmail cache: ${beforeCleanCount} -> ${killmails.length}`
        );

        if (!isDuplicate(killmail)) {
          console.log(`[${timestamp}] Not a duplicate, checking time...`);

          if (isWithinLast24Hours(killmail.killmail.killmail_time)) {
            console.log(`[${timestamp}] Within time window, processing...`);

            try {
              const processedKillmail = await processKillmail(killmail);
              console.log(
                `[${timestamp}] Killmail processed with celestial data`
              );

              const enrichedKillmail = await addShipCategoriesToKillmail(
                processedKillmail
              );
              console.log(
                `[${timestamp}] Killmail enriched with ship categories`
              );

              // Add to cache
              killmails.push(enrichedKillmail);
              console.log(
                `[${timestamp}] Added to cache. New total: ${killmails.length}`
              );

              // Emit to connected clients
              const connectedClients = io.sockets.sockets.size;
              console.log(
                `[${timestamp}] Broadcasting to ${connectedClients} connected clients`
              );
              io.emit("newKillmail", enrichedKillmail);

              // Process for roaming gangs
              const updatedRoams =
                roamStore.updateRoamingGangs(enrichedKillmail);
              console.log(
                `[${timestamp}] Updated roams: ${updatedRoams.length}`
              );
              activeRoams.set(updatedRoams);
              io.emit("roamUpdate", updatedRoams);

              // Process for gate camps
              if (isGateCamp(enrichedKillmail)) {
                console.log(`[${timestamp}] Processing gate camp...`);
                activeCamps = updateCamps(enrichedKillmail);
                io.emit("campUpdate", Array.from(activeCamps.values()));
              }
            } catch (processError) {
              console.error(
                `[${timestamp}] Error processing killmail:`,
                processError
              );
            }
          } else {
            console.log(`[${timestamp}] Killmail too old, skipping`);
          }
        } else {
          console.log(`[${timestamp}] Duplicate killmail, skipping`);
        }
      } else {
        console.log(`[${timestamp}] No killmail package in response`);
      }
    } else {
      console.log(
        `[${timestamp}] Unexpected response status: ${response.status}`
      );
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error polling RedisQ:`, {
      message: error.message,
      code: error.code,
      response: error.response?.data,
    });
  }

  const delay = 20; // 20 ms --> Delay has to stay low, otherwise it can't process the entire backlog.
  setTimeout(pollRedisQ, delay);
}

// There are sometimes duplicate killmails in the RedisQ
function isDuplicate(killmail) {
  return killmails.some((km) => km.killID === killmail.killID);
}

function cleanKillmailsCache(killmails) {
  const now = new Date();
  return killmails.filter((km) => {
    const killTime = new Date(km.killmail.killmail_time);
    const timeDiff = now - killTime;
    return timeDiff <= 24 * 60 * 60 * 1000; // 24 hours
  });
}

async function startServer() {
  try {
    await initializeDatabase();
    isDatabaseInitialized = true;

    return new Promise((resolve, reject) => {
      server
        .listen(PORT, "0.0.0.0", () => {
          console.log(`Server running on 0.0.0.0:${PORT}`);
          pollRedisQ();
          resolve();
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  } catch (err) {
    console.error("Error starting server:", err);
    process.exit(1);
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

// SPA fallback - must be last
app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Closing Redis connection...");
  await redisClient.quit();
  process.exit(0);
});

startServer();
