const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// webhook
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

app.use(express.static("public"));
app.use(express.json());

const REDISQ_URL = "https://redisq.zkillboard.com/listen.php?queueID=KM_hunter";
let killmails = [];

// Database setup
const db = new sqlite3.Database("./km_hunter.db", (err) => {
  if (err) {
    console.error("Error opening database", err);
  } else {
    console.log("Connected to the SQLite database.");
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      settings TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS filter_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      ids TEXT,
      enabled INTEGER,
      is_exclude INTEGER,
      filter_type TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      settings TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS celestial_data (
      system_id INTEGER PRIMARY KEY,
      system_name TEXT,
      celestial_data TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

// Function to check if a killmail is within the last 24 hours
function isWithinLast24Hours(killmailTime) {
  const now = new Date();
  const killTime = new Date(killmailTime);
  const timeDiff = now - killTime;
  return timeDiff <= 24 * 60 * 60 * 1000; // 24 hours in milliseconds
}

// Function to get the total size of a user's filter lists
function getFilterListsSize(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT ids FROM filter_lists WHERE user_id = ?",
      [userId],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const totalSize = rows.reduce(
            (sum, row) => sum + JSON.stringify(row).length,
            0
          );
          resolve(totalSize);
        }
      }
    );
  });
}

async function fetchCelestialData(systemId) {
  try {
    const response = await axios.get(
      `https://www.fuzzwork.co.uk/api/mapdata.php?solarsystemid=${systemId}&format=json`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching celestial data:", error);
    return null;
  }
}

async function storeCelestialData(systemId, celestialData) {
  return new Promise((resolve, reject) => {
    const systemName = celestialData[0]?.solarsystemname || systemId.toString();

    const query = `REPLACE INTO celestial_data 
      (system_id, system_name, celestial_data, last_updated) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)`;

    db.run(
      query,
      [systemId, systemName, JSON.stringify(celestialData)],
      function (err) {
        if (err) {
          console.error("Error storing celestial data:", err);
          reject(err);
        } else {
          resolve(this.lastID);
        }
      }
    );
  });
}

// Account routes
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err) {
      res.status(500).json({ success: false, message: "Server error" });
    } else if (!user) {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    } else {
      bcrypt.compare(password, user.password, (err, result) => {
        if (result) {
          db.all(
            "SELECT * FROM filter_lists WHERE user_id = ?",
            [user.id],
            (err, filterLists) => {
              if (err) {
                res.status(500).json({
                  success: false,
                  message: "Error fetching filter lists",
                });
              } else {
                res.json({
                  success: true,
                  settings: JSON.parse(user.settings),
                  filterLists: filterLists,
                });
              }
            }
          );
        } else {
          res
            .status(401)
            .json({ success: false, message: "Invalid credentials" });
        }
      });
    }
  });
});

// Account registration route
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Username and password are required" });
  }

  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      res.status(500).json({ success: false, message: "Server error" });
    } else {
      db.run(
        "INSERT INTO users (username, password, settings) VALUES (?, ?, ?)",
        [username, hashedPassword, JSON.stringify({})],
        (err) => {
          if (err) {
            if (err.code === "SQLITE_CONSTRAINT") {
              res
                .status(409)
                .json({ success: false, message: "Username already exists" });
            } else {
              res.status(500).json({ success: false, message: "Server error" });
            }
          } else {
            res.json({ success: true });
          }
        }
      );
    }
  });
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
    let processedIds = ids;
    if (filterType === "region") {
      // Handle region IDs - ensure proper array format
      processedIds = Array.isArray(ids)
        ? ids.map((id) => id.toString().trim())
        : ids.split(",").map((id) => id.toString().trim());
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
        JSON.stringify(processedIds), // Store processed IDs
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
            ids: processedIds, // Use processed IDs in response
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
    AT_CELESTIAL: 10000,
    NEAR_CELESTIAL: 10000000,
    MAX_BOX_SIZE: KM_PER_AU * 100,
  };

  // Initialize all variables at the start with proper scope
  let bestPoints = [];
  let minVolume = Infinity;
  let nearestCelestial = null;
  let celestialPositions = [];
  let killPos = { x: 0, y: 0, z: 0 };

  // Early return for invalid input
  if (!killPosition || !Array.isArray(celestials)) {
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: false,
      nearestCelestial: null,
      triangulationPossible: false,
    };
  }

  // Set kill position
  killPos = {
    x: killPosition.x,
    y: killPosition.y,
    z: killPosition.z,
  };

  // Process celestials
  celestialPositions = celestials
    .filter(
      (cel) =>
        cel.id !== "killmail" &&
        cel.x !== undefined &&
        cel.y !== undefined &&
        cel.z !== undefined
    )
    .map((cel) => ({
      position: { x: cel.x, y: cel.y, z: cel.z },
      distance: Math.sqrt(
        Math.pow(cel.x - killPos.x, 2) +
          Math.pow(cel.y - killPos.y, 2) +
          Math.pow(cel.z - killPos.z, 2)
      ),
      name: cel.itemname,
    }))
    .sort((a, b) => a.distance - b.distance);

  nearestCelestial = celestialPositions[0] || null;

  if (!killPosition || !Array.isArray(celestials)) {
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: false,
      nearestCelestial: null,
      triangulationPossible: false,
    };
  }

  // Process celestials and find tetrahedron containing kill point
  if (celestialPositions.length >= 4) {
    for (let i = 0; i < Math.min(celestialPositions.length - 3, 10); i++) {
      for (
        let j = i + 1;
        j < Math.min(celestialPositions.length - 2, 11);
        j++
      ) {
        for (
          let k = j + 1;
          k < Math.min(celestialPositions.length - 1, 12);
          k++
        ) {
          for (
            let l = k + 1;
            l < Math.min(celestialPositions.length, 13);
            l++
          ) {
            const tetraPoints = [
              celestialPositions[i].position,
              celestialPositions[j].position,
              celestialPositions[k].position,
              celestialPositions[l].position,
            ];

            if (isPointInTetrahedron(killPos, tetraPoints)) {
              const volume = calculateTetrahedronVolume(tetraPoints);
              if (volume < minVolume) {
                minVolume = volume;
                bestPoints = [
                  celestialPositions[i],
                  celestialPositions[j],
                  celestialPositions[k],
                  celestialPositions[l],
                ];
              }
            }
          }
        }
      }
    }

    if (bestPoints.length === 4) {
      return {
        hasTetrahedron: true,
        points: bestPoints,
        atCelestial: false,
        nearestCelestial: null,
        triangulationPossible: true,
      };
    }
  }

  if (
    nearestCelestial &&
    nearestCelestial.distance <= THRESHOLDS.AT_CELESTIAL
  ) {
    return {
      hasTetrahedron: false,
      points: [nearestCelestial],
      atCelestial: true,
      nearestCelestial,
      triangulationPossible: true,
    };
  }

  if (
    nearestCelestial &&
    nearestCelestial.distance <= THRESHOLDS.NEAR_CELESTIAL
  ) {
    return {
      hasTetrahedron: false,
      points: [],
      atCelestial: false,
      nearestCelestial,
      triangulationPossible: true,
    };
  }

  return {
    hasTetrahedron: false,
    points: [],
    atCelestial: false,
    nearestCelestial: nearestCelestial || null,
    triangulationPossible: false,
  };
}

function calculateTetrahedronVolume(points) {
  const [a, b, c, d] = points;

  // Calculate vectors from point a to others
  const ab = subtractVectors(b, a);
  const ac = subtractVectors(c, a);
  const ad = subtractVectors(d, a);

  // Calculate volume using triple product formula
  // V = (1/6)|((b-a)×(c-a))·(d-a)|
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

  // Convert string coordinates to numbers if needed
  const p = {
    x: parseFloat(point.x),
    y: parseFloat(point.y),
    z: parseFloat(point.z),
  };

  // Calculate barycentric coordinates
  const vap = subtractVectors(p, a);
  const vbp = subtractVectors(p, b);
  const vcp = subtractVectors(p, c);
  const vdp = subtractVectors(p, d);

  const vab = subtractVectors(b, a);
  const vac = subtractVectors(c, a);
  const vad = subtractVectors(d, a);

  const va6 = calculateTetrahedronVolume([a, b, c, d]); // Total volume * 6
  const v1 = dotProduct(crossProduct(vab, vac), vad); // Reference volume * 6

  // Calculate barycentric coordinates
  const v2 = dotProduct(crossProduct(vap, vcp), vdp) / v1;
  const v3 = dotProduct(crossProduct(vab, vap), vdp) / v1;
  const v4 = dotProduct(crossProduct(vap, vac), vbp) / v1;
  const v5 = 1 - v2 - v3 - v4;

  // Point is inside if all coordinates are between 0 and 1
  const epsilon = 0.0001; // Account for floating point precision
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
app.get("/api/filter-lists/:userId", (req, res) => {
  const userId = req.params.userId;
  db.all(
    "SELECT * FROM filter_lists WHERE user_id = ?",
    [userId],
    (err, rows) => {
      if (err) {
        console.error("Error fetching filter lists:", err);
        res
          .status(500)
          .json({ success: false, message: "Error fetching filter lists" });
      } else {
        const filterLists = rows.map((row) => ({
          ...row,
          ids: JSON.parse(row.ids),
          enabled: Boolean(row.enabled),
          is_exclude: Boolean(row.is_exclude),
          filter_type: row.filter_type || null,
        }));
        console.log("Fetched filter lists:", filterLists);
        res.json({ success: true, filterLists });
      }
    }
  );
});

// Update a filter list
app.put("/api/filter-list/:id", async (req, res) => {
  const { name, ids, enabled, isExclude, filterType } = req.body;
  const id = req.params.id;

  try {
    // Get the user ID for this filter list
    const [filterList] = await db.get(
      "SELECT user_id FROM filter_lists WHERE id = ?",
      [id]
    );
    if (!filterList) {
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
app.delete("/api/filter-list/:id", (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM filter_lists WHERE id = ?", [id], function (err) {
    if (err) {
      res
        .status(500)
        .json({ success: false, message: "Error deleting filter list" });
    } else {
      res.json({ success: true });
    }
  });
});

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("login", ({ username, password }) => {
    socket.username = username;
    db.get(
      "SELECT id, settings FROM users WHERE username = ?",
      [username],
      (err, user) => {
        if (err) {
          console.error("Error fetching user settings", err);
          socket.emit("loginError", { message: "Error during login" });
        } else if (user) {
          // Fetch filter lists for the user
          db.all(
            "SELECT * FROM filter_lists WHERE user_id = ?",
            [user.id],
            (err, filterLists) => {
              if (err) {
                console.error("Error fetching filter lists", err);
                socket.emit("loginError", {
                  message: "Error fetching user data",
                });
              } else {
                // Emit initial data
                socket.emit("initialData", {
                  killmails: killmails.filter((km) =>
                    isWithinLast24Hours(km.killmail.killmail_time)
                  ),
                  settings: JSON.parse(user.settings),
                  filterLists: filterLists,
                  // Don't include profiles here, we'll fetch them separately
                });
              }
            }
          );
        } else {
          socket.emit("loginError", { message: "User not found" });
        }
      }
    );
  });

  socket.on("fetchProfiles", () => {
    if (socket.username) {
      db.get(
        "SELECT id FROM users WHERE username = ?",
        [socket.username],
        (err, row) => {
          if (err) {
            console.error("Error fetching user id:", err);
          } else if (row) {
            db.all(
              "SELECT id, name FROM user_profiles WHERE user_id = ?",
              [row.id],
              (err, profiles) => {
                if (err) {
                  console.error("Error fetching profiles:", err);
                } else {
                  console.log("Fetched profiles:", profiles);
                  socket.emit("profilesFetched", profiles);
                }
              }
            );
          }
        }
      );
    }
  });

  socket.on("deleteProfile", ({ id }) => {
    console.log("Server: Received deleteProfile request for id:", id);
    if (socket.username) {
      db.get(
        "SELECT id FROM users WHERE username = ?",
        [socket.username],
        (err, row) => {
          if (err) {
            console.error("Server: Error fetching user id:", err);
            socket.emit("error", { message: "Error deleting profile" });
          } else if (row) {
            db.run(
              "DELETE FROM user_profiles WHERE id = ? AND user_id = ?",
              [id, row.id],
              function (err) {
                if (err) {
                  console.error("Server: Error deleting profile:", err);
                  socket.emit("error", { message: "Error deleting profile" });
                } else {
                  console.log(
                    "Server: Deleted profile:",
                    id,
                    "Changes:",
                    this.changes
                  );
                  if (this.changes > 0) {
                    socket.emit("profileDeleted", id);
                  } else {
                    console.log("Server: No profile found with id:", id);
                    socket.emit("error", { message: "Profile not found" });
                  }
                }
              }
            );
          } else {
            console.log(
              "Server: User not found for username:",
              socket.username
            );
            socket.emit("error", { message: "User not found" });
          }
        }
      );
    } else {
      console.log("Server: No username associated with socket");
      socket.emit("error", { message: "Not logged in" });
    }
  });

  socket.on("clearKills", () => {
    killmails = []; // Clear the server-side memory
    socket.emit("killmailsCleared"); // Notify the client that kills were cleared
  });

  socket.on("updateSettings", (newSettings) => {
    if (socket.username) {
      db.run(
        "UPDATE users SET settings = ? WHERE username = ?",
        [JSON.stringify(newSettings), socket.username],
        (err) => {
          if (err) {
            console.error("Error updating settings:", err);
          } else {
            console.log("Settings updated for user:", socket.username);
          }
        }
      );
    }
  });

  socket.on(
    "createFilterList",
    ({ name, ids, enabled, isExclude, filter_type }) => {
      if (socket.username) {
        db.get(
          "SELECT id FROM users WHERE username = ?",
          [socket.username],
          (err, row) => {
            if (err) {
              console.error("Error fetching user id:", err);
            } else if (row) {
              console.log(
                "Inserting filter list with filter_type:",
                filter_type
              ); // Add this log
              db.run(
                "INSERT INTO filter_lists (user_id, name, ids, enabled, is_exclude, filter_type) VALUES (?, ?, ?, ?, ?, ?)",
                [
                  row.id,
                  name,
                  JSON.stringify(ids),
                  enabled ? 1 : 0,
                  isExclude ? 1 : 0,
                  filter_type,
                ],
                function (err) {
                  if (err) {
                    console.error("Error creating filter list:", err);
                  } else {
                    const newFilterList = {
                      id: this.lastID,
                      user_id: row.id,
                      name,
                      ids,
                      enabled: Boolean(enabled),
                      is_exclude: Boolean(isExclude),
                      filter_type,
                    };
                    console.log("Created new filter list:", newFilterList);
                    socket.emit("filterListCreated", newFilterList);
                  }
                }
              );
            }
          }
        );
      }
    }
  );

  socket.on(
    "updateFilterList",
    ({ id, name, ids, enabled, is_exclude, filter_type }) => {
      console.log("Updating filter list with filter_type:", filter_type); // Add this log
      db.run(
        "UPDATE filter_lists SET name = ?, ids = ?, enabled = ?, is_exclude = ?, filter_type = ? WHERE id = ?",
        [
          name,
          JSON.stringify(ids),
          enabled ? 1 : 0,
          is_exclude ? 1 : 0,
          filter_type,
          id,
        ],
        (err) => {
          if (err) {
            console.error("Error updating filter list:", err);
          } else {
            console.log("Updated filter list:", {
              id,
              name,
              ids,
              enabled,
              is_exclude,
              filter_type,
            });
            socket.emit("filterListUpdated", {
              id,
              name,
              ids,
              enabled,
              is_exclude,
              filter_type,
            });
          }
        }
      );
    }
  );

  socket.on("deleteFilterList", ({ id }) => {
    db.run("DELETE FROM filter_lists WHERE id = ?", [id], (err) => {
      if (err) {
        console.error("Error deleting filter list:", err);
      } else {
        console.log("Deleted filter list:", id);
        socket.emit("filterListDeleted", { id });
      }
    });
  });

  socket.on("saveProfile", (data) => {
    console.log("Received saveProfile event:", data);
    if (socket.username) {
      db.get(
        "SELECT id FROM users WHERE username = ?",
        [socket.username],
        (err, row) => {
          if (err) {
            console.error("Error fetching user id:", err);
            socket.emit("error", { message: "Error saving profile" });
          } else if (row) {
            const userId = row.id;
            const { name, settings, filterLists } = data;
            const profileData = JSON.stringify({ settings, filterLists });

            db.get(
              "SELECT id FROM user_profiles WHERE user_id = ? AND name = ?",
              [userId, name],
              (err, profileRow) => {
                if (err) {
                  console.error("Error checking for existing profile:", err);
                  socket.emit("error", { message: "Error saving profile" });
                } else if (profileRow) {
                  // Update existing profile
                  db.run(
                    "UPDATE user_profiles SET settings = ? WHERE id = ?",
                    [profileData, profileRow.id],
                    (err) => {
                      if (err) {
                        console.error("Error updating profile:", err);
                        socket.emit("error", {
                          message: "Error updating profile",
                        });
                      } else {
                        console.log("Profile updated successfully");
                        socket.emit("profileSaved", {
                          id: profileRow.id,
                          name,
                          message: "Profile updated",
                        });
                      }
                    }
                  );
                } else {
                  // Create new profile
                  db.run(
                    "INSERT INTO user_profiles (user_id, name, settings) VALUES (?, ?, ?)",
                    [userId, name, profileData],
                    function (err) {
                      if (err) {
                        console.error("Error saving new profile:", err);
                        socket.emit("error", {
                          message: "Error saving new profile",
                        });
                      } else {
                        console.log("New profile created successfully");
                        socket.emit("profileSaved", {
                          id: this.lastID,
                          name,
                          message: "New profile created",
                        });
                      }
                    }
                  );
                }
              }
            );
          } else {
            console.error("User not found");
            socket.emit("error", { message: "User not found" });
          }
        }
      );
    } else {
      console.error("No username associated with socket");
      socket.emit("error", { message: "Not logged in" });
    }
  });

  async function getUserData(username) {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT id, settings FROM users WHERE username = ?",
        [username],
        async (err, user) => {
          if (err) {
            reject(new Error("Database error"));
            return;
          }

          if (!user) {
            reject(new Error("User not found"));
            return;
          }

          try {
            const filterLists = await getFilterLists(user.id);
            const profiles = await getProfiles(user.id);

            resolve({
              settings: JSON.parse(user.settings || "{}"),
              filterLists,
              profiles,
            });
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  async function getFilterLists(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM filter_lists WHERE user_id = ?",
        [userId],
        (err, rows) => {
          if (err) {
            reject(new Error("Error fetching filter lists"));
            return;
          }
          resolve(
            rows.map((row) => ({
              ...row,
              ids: JSON.parse(row.ids),
              enabled: Boolean(row.enabled),
              is_exclude: Boolean(row.is_exclude),
            }))
          );
        }
      );
    });
  }

  async function getProfiles(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM user_profiles WHERE user_id = ?",
        [userId],
        (err, rows) => {
          if (err) {
            reject(new Error("Error fetching profiles"));
            return;
          }
          resolve(
            rows.map((row) => ({
              ...row,
              settings: JSON.parse(row.settings || "{}"),
            }))
          );
        }
      );
    });
  }

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

  socket.on("loadProfile", (profileId) => {
    if (socket.username) {
      db.get(
        "SELECT user_profiles.settings, user_profiles.name FROM user_profiles JOIN users ON user_profiles.user_id = users.id WHERE user_profiles.id = ? AND users.username = ?",
        [profileId, socket.username],
        (err, row) => {
          if (err) {
            console.error("Error loading profile:", err);
            socket.emit("error", { message: "Error loading profile" });
          } else if (row) {
            try {
              let profileData = JSON.parse(row.settings);

              // Filter out non-existent filter lists
              db.all(
                "SELECT id FROM filter_lists WHERE user_id = (SELECT id FROM users WHERE username = ?)",
                [socket.username],
                (err, validFilterLists) => {
                  if (err) {
                    console.error("Error fetching valid filter lists:", err);
                    socket.emit("error", { message: "Error loading profile" });
                  } else {
                    const validFilterListIds = validFilterLists.map(
                      (fl) => fl.id
                    );
                    const filteredFilterLists = profileData.filterLists.filter(
                      (fl) => validFilterListIds.includes(fl.id)
                    );

                    socket.emit("profileLoaded", {
                      name: row.name,
                      settings: profileData.settings || {}, // Use empty object if no settings
                      filterLists: filteredFilterLists,
                    });
                  }
                }
              );
            } catch (parseError) {
              console.error("Error parsing profile data:", parseError);
              socket.emit("error", { message: "Error parsing profile data" });
            }
          } else {
            socket.emit("error", { message: "Profile not found" });
          }
        }
      );
    }
  });
});

async function ensureCelestialData(systemId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT celestial_data FROM celestial_data WHERE system_id = ?",
      [systemId],
      async (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (!row) {
          try {
            const celestialData = await fetchCelestialData(systemId);
            if (!celestialData) {
              reject(
                new Error(
                  `Failed to fetch celestial data for system ${systemId}`
                )
              );
              return;
            }

            await storeCelestialData(systemId, celestialData);
            resolve(celestialData);
          } catch (error) {
            reject(error);
          }
        } else {
          resolve(JSON.parse(row.celestial_data));
        }
      }
    );
  });
}

async function processKillmail(killmail) {
  const systemId = killmail.killmail.solar_system_id;
  const celestialData = await ensureCelestialData(systemId);

  // Get the first celestial entry which contains system info
  const systemInfo = celestialData[0];

  const pinpointData = calculatePinpoints(
    celestialData,
    killmail.killmail.victim.position
  );

  // Attach relevant celestial data to the pinpoints
  pinpointData.celestialData = {
    regionid: systemInfo.regionid,
    regionname: systemInfo.regionname,
    solarsystemid: systemInfo.solarsystemid,
    solarsystemname: systemInfo.solarsystemname,
  };

  return {
    ...killmail,
    pinpoints: pinpointData,
  };
}

async function sendWebhookNotification(killmail, webhookUrl) {
  try {
    const zkillUrl = `https://zkillboard.com/kill/${killmail.killID}/`;

    const embed = {
      title: "New Kill Detected",
      url: zkillUrl,
      color: 16711680, // Red
      fields: [
        {
          name: "Ship Type",
          value: `ID: ${killmail.killmail.victim.ship_type_id}`,
          inline: true,
        },
        {
          name: "Total Value",
          value: `${(killmail.zkb.totalValue / 1000000).toFixed(2)}M ISK`,
          inline: true,
        },
        {
          name: "System",
          value: `ID: ${killmail.killmail.solar_system_id}`,
          inline: true,
        },
      ],
      timestamp: killmail.killmail.killmail_time,
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Error sending webhook notification:", error);
  }
}

// Function to poll for new killmails from RedisQ
// Modify the polling function to use processKillmail
async function pollRedisQ() {
  try {
    const response = await axios.get(REDISQ_URL);
    if (response.status === 200 && response.data.package) {
      const killmail = response.data.package;

      if (isWithinLast24Hours(killmail.killmail.killmail_time)) {
        try {
          const processedKillmail = await processKillmail(killmail);
          console.log("Processed killmail with pinpoints:", processedKillmail);
          killmails.push(processedKillmail);
          io.emit("newKillmail", processedKillmail);
        } catch (error) {
          console.error("Error processing killmail:", error);
          // Still emit the original killmail if processing fails
          killmails.push(killmail);
          io.emit("newKillmail", killmail);
        }
      } else {
        console.log("Received killmail older than 24 hours, discarding");
      }
    }
  } catch (error) {
    console.error("Error polling RedisQ:", error);
  }
  setTimeout(pollRedisQ, 10);
}

// Function to clean up old killmails
function cleanupOldKillmails() {
  killmails = killmails.filter((km) =>
    isWithinLast24Hours(km.killmail.killmail_time)
  );
  console.log(`Cleaned up killmails. Current count: ${killmails.length}`);
}

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
  pollRedisQ(); // Start polling RedisQ
  setInterval(cleanupOldKillmails, 60 * 60 * 1000); // Run cleanup every hour
});
