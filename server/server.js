import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import axios from "axios";
import { createClient as createSqlClient } from "@libsql/client"; // Rename this oneimport { compare, hash } from "bcrypt";
import { isGateCamp, updateCamps } from "./campStore.js";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";
import session from "express-session";
import RedisStore from "connect-redis";
import { createClient as createRedisClient } from "redis";

const stateStore = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Initialize Redis client
const redisClient = createRedisClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.connect().catch(console.error);

// Express middleware
app.use(express.json());

// Allow cross origin requests
app.use(
  cors({
    origin: [
      "https://eve-content-hunter-production.up.railway.app",
      "http://localhost:3000",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["set-cookie"],
  })
);

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Ensure build directory exists
const buildPath = path.join(__dirname, "../public/build");
if (!fs.existsSync(buildPath)) {
  fs.mkdirSync(buildPath, { recursive: true });
}

const REDISQ_URL = "https://redisq.zkillboard.com/listen.php?queueID=KM_hunter";
let killmails = [];
let activeCamps = new Map();
let isDatabaseInitialized = false;

const db = createSqlClient({
  url: process.env.LIBSQL_URL || "file:km_hunter.db",
  authToken: process.env.LIBSQL_AUTH_TOKEN,
});

// Initialize Redis store
const redisStore = new RedisStore({
  client: redisClient,
  prefix: "km_session:",
  ttl: 86400, // 24 hours in seconds
  disableTouch: false,
  disableTTL: false,
});
// Session middleware configuration
const sessionMiddleware = session({
  store: redisStore,
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  name: "km_sid",
  cookie: {
    secure: true, // Always true since you're using HTTPS
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    domain:
      process.env.NODE_ENV === "production"
        ? "eve-content-hunter-production.up.railway.app"
        : undefined, // Full domain instead of .railway.app
    path: "/",
  },
  proxy: true, // Add this for proper HTTPS handling behind proxy
});
app.use(sessionMiddleware);

// Share session middleware with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

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
        refresh_token TEXT
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

    console.log("Database initialized successfully");
    isDatabaseInitialized = true;
  } catch (err) {
    console.error("Error initializing database:", err);
    isDatabaseInitialized = false;
  }
}

// Add health check endpoint
app.get("/health", async (_, res) => {
  try {
    if (!isDatabaseInitialized) {
      console.log("Health check failed: Database not yet initialized");
      return res.status(503).json({ status: "initializing" });
    }

    // Test database connection with a simple query
    const result = await db.execute("SELECT 1 as health_check");
    if (result.rows?.[0]?.health_check === 1) {
      console.log("Health check passed");
      return res.status(200).json({ status: "healthy" });
    } else {
      throw new Error("Database query returned unexpected result");
    }
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(500).json({
      status: "unhealthy",
      error: error.message,
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
  try {
    // Get victim ship category with killmail for NPC/structure checks
    const victimCategory = await getShipCategory(
      killmail.killmail.victim.ship_type_id,
      killmail
    );

    // Initialize categories object only if a valid category is found
    if (!victimCategory) {
      return killmail;
    }

    killmail.shipCategories = {
      victim: victimCategory,
      attackers: [],
    };

    // Process only ship types, not weapon types
    const attackerShipTypes = killmail.killmail.attackers
      .map((attacker) => attacker.ship_type_id)
      .filter((shipTypeId) => shipTypeId); // Remove any null/undefined ship types

    // Process unique ship types to avoid redundant API calls
    const uniqueShipTypes = [...new Set(attackerShipTypes)];

    for (const shipTypeId of uniqueShipTypes) {
      const category = await getShipCategory(shipTypeId, killmail);

      // Only add if a valid category is found
      if (category) {
        killmail.shipCategories.attackers.push({
          shipTypeId,
          category,
        });
      }
    }

    return killmail;
  } catch (error) {
    console.error("Error adding ship categories to killmail:", error);
    return killmail;
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
  try {
    const response = await axios.get(
      `https://www.fuzzwork.co.uk/api/mapdata.php?solarsystemid=${systemId}&format=json`
    );

    if (!Array.isArray(response.data)) {
      throw new Error("Invalid celestial data format");
    }

    return response.data;
  } catch (error) {
    console.error("Error fetching celestial data:", error);
    return null;
  }
}

async function storeCelestialData(systemId, celestialData) {
  try {
    const systemName = celestialData[0]?.solarsystemname || systemId.toString();
    console.log("Storing celestial data:", celestialData[0]);

    await db.execute({
      sql: `REPLACE INTO celestial_data 
            (system_id, system_name, celestial_data, last_updated) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [systemId, systemName, JSON.stringify(celestialData)],
    });

    return true;
  } catch (error) {
    console.error("Error storing celestial data:", error);
    throw error;
  }
}

app.post("/api/eve-sso/state", (req, res) => {
  const state = req.body.state;
  if (!state) {
    return res.status(400).json({ error: "No state provided" });
  }
  stateStore.set(state, { timestamp: Date.now() });
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

    const { access_token, refresh_token: new_refresh_token } =
      tokenResponse.data;

    // Update user in database
    if (req.session?.user?.character_id) {
      await db.execute({
        sql: `UPDATE users SET access_token = ?, refresh_token = ? WHERE character_id = ?`,
        args: [access_token, new_refresh_token, req.session.user.character_id],
      });
    }

    // Update session
    req.session.user = {
      ...req.session.user,
      access_token,
    };

    res.json({ access_token, refresh_token: new_refresh_token });
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

// Create a filter list
app.post("/api/filter-list", async (req, res) => {
  const { userId, name, ids, enabled, isExclude, filterType } = req.body;

  try {
    // Check if user has reached the maximum number of filter lists
    const [listCount] = await db.get(
      "SELECT COUNT(*) as count FROM filter_lists WHERE user_id = ?",
      [userId]
    );
    if (listCount.count >= 100) {
      return res.status(400).json({
        success: false,
        message: "Maximum number of filter lists reached",
      });
    }

    // Process IDs based on filter type
    let processedIds;
    if (filterType === "region") {
      // Handle region IDs - ensure proper array format without extra escaping
      processedIds = Array.isArray(ids) ? ids : ids.split(",");

      // Clean up the array elements
      processedIds = processedIds.map((id) => id.trim());
    } else {
      // For other filter types, ensure array format
      processedIds = Array.isArray(ids)
        ? ids
        : ids.split(",").map((id) => id.trim());
    }

    // Check size limit
    const currentSize = await getFilterListsSize(userId);
    const newListSize = JSON.stringify({
      name,
      processedIds,
      enabled,
      isExclude,
      filterType,
    }).length;

    if (currentSize + newListSize > 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: "Filter lists size limit exceeded",
      });
    }

    // Insert into database with processed IDs
    db.run(
      "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES (?, ?, ?, ?, ?, ?)",
      [
        userId,
        name,
        JSON.stringify(processedIds), // Single JSON.stringify for all types
        enabled ? 1 : 0,
        isExclude ? 1 : 0,
        filterType || null,
      ],
      function (err) {
        if (err) {
          console.error("Error creating filter list:", err);
          res.status(500).json({
            success: false,
            message: "Error creating filter list",
          });
        } else {
          const newFilterList = {
            id: this.lastID,
            user_id: userId,
            name,
            ids: processedIds, // Use the processed array directly in response
            enabled: Boolean(enabled),
            is_exclude: Boolean(isExclude),
            filter_type: filterType || null,
          };
          console.log("Created new filter list:", newFilterList);
          res.json({ success: true, filterList: newFilterList });
          io.to(userId.toString()).emit("filterListCreated", newFilterList);
        }
      }
    );
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ success: false, message: "Server error" });
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
    sessionData: req.session, // Add this to see full session data
    cookies: req.headers.cookie, // Add this to check cookie header
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

  res.json({
    user: {
      id: req.session.user.id,
      character_id: req.session.user.character_id,
      character_name: req.session.user.character_name,
      access_token: req.session.user.access_token,
      refresh_token: req.session.user.refresh_token,
    },
  });
});

function cleanupStates() {
  const now = Date.now();
  for (const [state, data] of stateStore.entries()) {
    if (now - data.timestamp > 5 * 60 * 1000) {
      stateStore.delete(state);
    }
  }
}

// for user login
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  console.log("Received callback with code:", code);
  console.log("State:", state);

  try {
    // Validate state
    if (!stateStore.has(state)) {
      console.error("Invalid state:", state);
      return res.redirect("/?login=error&reason=invalid_state");
    }

    // Remove used state
    stateStore.delete(state);
    cleanupStates();

    // Get access token
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
    const { access_token, refresh_token } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      console.error("Missing token data:", tokenResponse.data);
      return res.redirect("/?login=error&reason=invalid_token");
    }

    // Extract character info
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
      const { rows: existingUser } = await db.execute({
        sql: "SELECT * FROM users WHERE character_id = ?",
        args: [characterId],
      });

      let userId;

      if (existingUser.length > 0) {
        console.log("Updating existing user...");
        await db.execute({
          sql: `UPDATE users SET access_token = ?, refresh_token = ?, character_name = ? WHERE character_id = ?`,
          args: [access_token, refresh_token, characterName, characterId],
        });
        userId = existingUser[0].id;
      } else {
        console.log("Creating new user...");
        const result = await db.execute({
          sql: `INSERT INTO users (character_id, character_name, access_token, refresh_token, settings) 
                VALUES (?, ?, ?, ?, ?)`,
          args: [characterId, characterName, access_token, refresh_token, "{}"],
        });
        userId = result.lastInsertRowid;
      }

      // Set session data
      console.log("Setting up session data...");
      const sessionUser = {
        id: userId,
        character_id: characterId,
        character_name: characterName,
        access_token,
        refresh_token,
      };

      // Create new session if it doesn't exist
      if (!req.session) {
        console.log("Creating new session...");
        req.session = {};
      }

      req.session.user = sessionUser;

      // Save session using promisified approach
      console.log("Saving session...");
      try {
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error("Session save error:", err);
              reject(err);
              return;
            }
            console.log("Session saved, verifying in Redis...");
            resolve();
          });
        });

        // Verify session in Redis using promisified get
        const sessionKey = `km_session:${req.sessionID}`;
        console.log("Checking Redis for session:", sessionKey);

        const sessionData = await redisClient.get(sessionKey);
        if (!sessionData) {
          throw new Error("Session not found in Redis after save");
        }

        console.log("Session verified in Redis:", {
          sessionId: req.sessionID,
          hasData: true,
        });

        // Log final session state
        console.log("Final session state:", {
          sessionID: req.sessionID,
          hasUser: !!req.session.user,
          cookie: req.session.cookie,
        });

        return res.redirect("/?authenticated=true");
      } catch (sessionError) {
        console.error("Session verification error:", sessionError);
        throw sessionError;
      }
    } catch (dbError) {
      console.error("Database operation failed:", {
        message: dbError.message,
        code: dbError.code,
        stack: dbError.stack,
      });
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

    // Check database first
    const { rows } = await db.execute({
      sql: "SELECT celestial_data FROM celestial_data WHERE system_id = ?",
      args: [systemId],
    });

    if (rows[0]?.celestial_data) {
      return res.json(JSON.parse(rows[0].celestial_data));
    }

    // Fetch from API if not in database
    const celestialData = await fetchCelestialData(systemId);
    if (!celestialData) {
      throw new Error("Failed to fetch celestial data");
    }

    // Store in database
    await storeCelestialData(systemId, celestialData);

    // Return data
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
      const celestialData = await ensureCelestialData(systemId);

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
        `Error ensuring celestial data for system ${systemId}:`,
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

// Get all filter lists for a user
app.get("/api/filter-lists/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    const { rows } = await db.execute({
      sql: "SELECT * FROM filter_lists WHERE user_id = ?",
      args: [userId],
    });

    const filterLists = rows.map((row) => ({
      ...row,
      ids: JSON.parse(row.ids || "[]"),
      enabled: Boolean(row.enabled),
      is_exclude: Boolean(row.is_exclude),
      filter_type: row.filter_type || null,
    }));

    console.log("Fetched filter lists:", filterLists);
    res.json({ success: true, filterLists });
  } catch (err) {
    console.error("Error fetching filter lists:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching filter lists",
    });
  }
});

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

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.emit("initialCamps", Array.from(activeCamps.values()));

  socket.on("login", async ({ username, password }) => {
    try {
      const cleanPassword = String(password);
      const { rows } = await db.execute({
        sql: "SELECT * FROM users WHERE username = ?",
        args: [username],
      });
      const user = rows[0];

      if (user) {
        const match = await compare(cleanPassword, user.password);
        if (match) {
          socket.request.session.user = {
            id: user.id,
            username: user.username,
            character_id: user.character_id,
            character_name: user.character_name,
            access_token: user.access_token,
          };

          await new Promise((resolve, reject) => {
            socket.request.session.save((err) => {
              if (err) {
                console.error("Session save error:", err);
                reject(err);
                return;
              }
              console.log(
                "Session saved in socket login:",
                socket.request.sessionID
              );
              resolve();
            });
          });

          socket.username = username;

          const { rows: filterLists } = await db.execute({
            sql: "SELECT * FROM filter_lists WHERE user_id = ?",
            args: [user.id],
          });

          socket.emit("loginSuccess", {
            settings: JSON.parse(user.settings || "{}"),
            filterLists,
          });
        } else {
          socket.emit("loginError", { message: "Invalid credentials" });
        }
      } else {
        socket.emit("loginError", { message: "User not found" });
      }
    } catch (err) {
      console.error("Error during login:", err);
      socket.emit("loginError", { message: "Error during login" });
    }
  });

  socket.on("fetchProfiles", async () => {
    if (!socket.username) {
      socket.emit("error", { message: "Not logged in" });
      return;
    }

    try {
      const { rows: userRows } = await db.execute({
        sql: "SELECT id FROM users WHERE username = ?",
        args: [socket.username],
      });

      if (!userRows[0]) {
        socket.emit("error", { message: "User not found" });
        return;
      }

      const { rows: profiles } = await db.execute({
        sql: "SELECT id, name FROM user_profiles WHERE user_id = ?",
        args: [userRows[0].id],
      });

      console.log("Fetched profiles:", profiles);
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

  socket.on(
    "createFilterList",
    async ({ name, ids, enabled, isExclude, filter_type }) => {
      if (socket.username) {
        try {
          const { rows } = await db.execute({
            sql: "SELECT id FROM users WHERE username = ?",
            args: [socket.username],
          });

          if (rows[0]) {
            console.log("Inserting filter list with filter_type:", filter_type);
            const result = await db.execute({
              sql: "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES (?, ?, ?, ?, ?, ?)",
              args: [
                rows[0].id,
                name,
                JSON.stringify(ids),
                enabled ? 1 : 0,
                isExclude ? 1 : 0,
                filter_type,
              ],
            });

            const newFilterList = {
              id: result.lastInsertId,
              user_id: rows[0].id,
              name,
              ids,
              enabled: Boolean(enabled),
              is_exclude: Boolean(isExclude),
              filter_type,
            };
            console.log("Created new filter list:", newFilterList);
            socket.emit("filterListCreated", newFilterList);
          }
        } catch (err) {
          console.error("Error creating filter list:", err);
        }
      }
    }
  );

  socket.on(
    "updateFilterList",
    async ({ id, name, ids, enabled, is_exclude, filter_type }) => {
      const processedIds = Array.isArray(ids)
        ? ids
        : typeof ids === "string"
        ? JSON.parse(ids)
        : ids;

      try {
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

        console.log("Updated filter list:", {
          id,
          name,
          ids: processedIds,
          enabled,
          is_exclude,
          filter_type,
        });

        socket.emit("filterListUpdated", {
          id,
          name,
          ids: processedIds,
          enabled,
          is_exclude,
          filter_type,
        });
      } catch (err) {
        console.error("Error updating filter list:", err);
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
    console.log("Received saveProfile event:", data);

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

      const userId = rows[0].id;
      const { name, settings, filterLists } = data;
      const profileData = JSON.stringify({ settings, filterLists });

      const { rows: existingProfile } = await db.execute({
        sql: "SELECT id FROM user_profiles WHERE user_id = ? AND name = ?",
        args: [userId, name],
      });

      if (existingProfile[0]) {
        await db.execute({
          sql: "UPDATE user_profiles SET settings = ? WHERE id = ?",
          args: [profileData, existingProfile[0].id],
        });

        console.log("Profile updated successfully");
        socket.emit("profileSaved", {
          id: existingProfile[0].id,
          name,
          message: "Profile updated",
        });
      } else {
        const result = await db.execute({
          sql: "INSERT INTO user_profiles (user_id, name, settings) VALUES (?, ?, ?)",
          args: [userId, name, profileData],
        });

        console.log("New profile created successfully");
        socket.emit("profileSaved", {
          id: result.lastInsertId,
          name,
          message: "New profile created",
        });
      }
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

              const settings = user.settings ? JSON.parse(user.settings) : {};

              socket.emit("loginSuccess", {
                settings,
                filterLists: filterLists || [],
              });
            } catch (filterError) {
              console.error("Error fetching filter lists:", filterError);
              // Still emit success but with empty filter lists
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
    if (!socket.username) {
      socket.emit("error", { message: "Not logged in" });
      return;
    }

    try {
      const { rows } = await db.execute({
        sql: `SELECT user_profiles.settings, user_profiles.name 
              FROM user_profiles 
              JOIN users ON user_profiles.user_id = users.id 
              WHERE user_profiles.id = ? AND users.username = ?`,
        args: [profileId, socket.username],
      });

      if (!rows[0]) {
        socket.emit("error", { message: "Profile not found" });
        return;
      }

      try {
        const profileData = JSON.parse(rows[0].settings);

        const { rows: validFilterLists } = await db.execute({
          sql: "SELECT id FROM filter_lists WHERE user_id = (SELECT id FROM users WHERE username = ?)",
          args: [socket.username],
        });

        const validFilterListIds = validFilterLists.map((fl) => fl.id);
        const filteredFilterLists = profileData.filterLists.filter((fl) =>
          validFilterListIds.includes(fl.id)
        );

        socket.emit("profileLoaded", {
          name: rows[0].name,
          settings: profileData.settings || {},
          filterLists: filteredFilterLists,
        });
      } catch (parseError) {
        console.error("Error parsing profile data:", parseError);
        socket.emit("error", { message: "Error parsing profile data" });
      }
    } catch (error) {
      console.error("Error loading profile:", error);
      socket.emit("error", { message: "Error loading profile" });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

async function ensureCelestialData(systemId) {
  try {
    // Check for cached data
    const { rows } = await db.execute({
      sql: "SELECT celestial_data FROM celestial_data WHERE system_id = ?",
      args: [systemId],
    });

    if (rows[0]) {
      const celestialData = JSON.parse(rows[0].celestial_data);
      // console.log("Retrieved cached celestial data:", celestialData[0]);
      return celestialData;
    }

    // If no cached data, fetch new data
    console.log(`Fetching new celestial data for system ${systemId}`);
    const celestialData = await fetchCelestialData(systemId);

    if (!celestialData) {
      console.error(`Failed to fetch celestial data for system ${systemId}`);
      throw new Error(`Failed to fetch celestial data for system ${systemId}`);
    }

    // Store the new data
    await storeCelestialData(systemId, celestialData);
    console.log("Stored celestial data:", celestialData[0]);
    return celestialData;
  } catch (error) {
    console.error("Error in ensureCelestialData:", error);
    throw error;
  }
}

async function processKillmail(killmail) {
  const systemId = killmail.killmail.solar_system_id;
  const celestialData = await ensureCelestialData(systemId);

  // Calculate pinpoint data including nearest celestial
  const pinpointData = calculatePinpoints(
    celestialData,
    killmail.killmail.victim.position
  );

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

  return {
    ...killmail,
    pinpoints: pinpointData,
  };
}

// Function to poll for new killmails from RedisQ
// Modify the polling function to use processKillmail
async function pollRedisQ() {
  try {
    const response = await axios.get(REDISQ_URL);
    if (response.status === 200 && response.data.package) {
      const killmail = response.data.package;

      // Clean old killmails first
      killmails = cleanKillmailsCache(killmails);

      if (
        !isDuplicate(killmail) &&
        isWithinLast24Hours(killmail.killmail.killmail_time)
      ) {
        const processedKillmail = await processKillmail(killmail);
        const enrichedKillmail = await addShipCategoriesToKillmail(
          processedKillmail
        );

        // Add to cache
        killmails.push(enrichedKillmail);
        io.emit("newKillmail", enrichedKillmail);

        if (isGateCamp(enrichedKillmail)) {
          activeCamps = updateCamps(enrichedKillmail); // Should only pass killmail
          io.emit("campUpdate", Array.from(activeCamps.values()));
        }
      }
    }
  } catch (error) {
    console.error("Error polling RedisQ:", error);
  }
  setTimeout(pollRedisQ, 10);
}

// There are sometimes duplicate killmails in the RedisQ
function isDuplicate(killmail) {
  return killmails.some((km) => km.killID === killmail.killID);
}

io.on("connection", (socket) => {
  socket.emit("initialCamps", Array.from(activeCamps.values()));
});

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

// server.listen(3000, () => {
//   console.log("Server running on http://localhost:3000");
//   pollRedisQ(); // Start polling RedisQ
// });

// Serve build files with strict MIME types
app.use(
  "/build",
  express.static(buildPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      } else if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      } else if (filePath.endsWith(".map")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
    },
    fallthrough: true,
  })
);

// Serve public directory
app.use(express.static(path.join(__dirname, "../public")));

// Error handler
app.use((err, req, res, next) => {
  console.error("Static file error:", {
    url: req.url,
    error: err.message,
    stack: err.stack,
  });
  next(err);
});

// SPA fallback - must be last
app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

startServer();
