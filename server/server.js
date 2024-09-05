const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(express.static('public'));
app.use(express.json());

const REDISQ_URL = "https://redisq.zkillboard.com/listen.php?queueID=KM_hunter";
let killmails = [];

// Database setup
const db = new sqlite3.Database('./km_hunter.db', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      settings TEXT
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

// Account routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
    if (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    } else if (!row) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    } else {
      bcrypt.compare(password, row.password, (err, result) => {
        if (result) {
          res.json({ success: true, settings: JSON.parse(row.settings) });
        } else {
          res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
      });
    }
  });
});

// Account registration route
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    } else {
      db.run('INSERT INTO users (username, password, settings) VALUES (?, ?, ?)', 
      [username, hashedPassword, JSON.stringify({})], (err) => {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            res.status(409).json({ success: false, message: 'Username already exists' });
          } else {
            res.status(500).json({ success: false, message: 'Server error' });
          }
        } else {
          res.json({ success: true });
        }
      });
    }
  });
});

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('login', ({ username, password }) => {
    socket.username = username;
    db.get('SELECT settings FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Error fetching user settings', err);
      } else if (row) {
        console.log("Sending user settings and killmail data");
        socket.emit('initialData', { 
          killmails: killmails.filter(km => isWithinLast24Hours(km.killmail.killmail_time)), 
          settings: JSON.parse(row.settings) 
        });
      }
    });
  });

  socket.on('clearKills', () => {
    killmails = []; // Clear the server-side memory
    socket.emit('killmailsCleared'); // Notify the client that kills were cleared
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Function to poll for new killmails from RedisQ
async function pollRedisQ() {
  try {
    const response = await axios.get(REDISQ_URL);
    if (response.status === 200 && response.data.package) {
      const killmail = response.data.package;
      if (isWithinLast24Hours(killmail.killmail.killmail_time)) {
        console.log('Received killmail:', killmail);
        killmails.push(killmail);
        io.emit('newKillmail', killmail);
        console.log('Emitted new killmail');
      } else {
        console.log('Received killmail older than 24 hours, discarding');
      }
    }
  } catch (error) {
    console.error('Error polling RedisQ:', error);
  }
  setTimeout(pollRedisQ, 10); // Poll every 10ms
}

// Function to clean up old killmails
function cleanupOldKillmails() {
  killmails = killmails.filter(km => isWithinLast24Hours(km.killmail.killmail_time));
  console.log(`Cleaned up killmails. Current count: ${killmails.length}`);
}

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  pollRedisQ(); // Start polling RedisQ
  setInterval(cleanupOldKillmails, 60 * 60 * 1000); // Run cleanup every hour
});