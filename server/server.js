const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

app.use(express.static('public'));
app.use(express.json());

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
  // Hash the password before storing it in the database
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
        socket.emit('initialData', { killmails, settings: JSON.parse(row.settings) });
      }
    });
  });

  socket.on('clearKills', () => {
    killmails = [];
    io.emit('initialData', { killmails, settings: accounts[socket.username].settings });
  }); // implement this

  setInterval(() => {
    io.emit('testEvent', { message: 'Hello from server' });
  }, 3000);

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

async function pollRedisQ() {
  try {
    const response = await axios.get(REDISQ_URL);
    if (response.status === 200 && response.data.package) {
      const killmail = response.data.package;
      console.log('Received killmail:', killmail);
      killmails.push(killmail);
      io.emit('newKillmail', killmail);
      console.log('Emitted new killmail');
    }
  } catch (error) {
    console.error('Error polling RedisQ:', error);
  }
  setTimeout(pollRedisQ, 1000);
}

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  pollRedisQ();
});
