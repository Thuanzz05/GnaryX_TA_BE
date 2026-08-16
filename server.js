const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, testConnection } = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'gnaryx_ta_dev_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const localUsers = new Map();
const fallbackUser = {
  id: 'u1000000-0000-0000-0000-000000000001',
  full_name: 'Duy Thuấn',
  email: 'thuan@example.com',
  password_hash: bcrypt.hashSync('12345678', 10),
  level: 'B1',
  xp: 1250,
  level_number: 12,
  streak: 7,
  daily_goal: 20,
  preferredTopics: ['Technology', 'Business'],
};
localUsers.set(fallbackUser.email, fallbackUser);

app.use(cors());
app.use(express.json());

function normalizeUser(user) {
  return {
    id: user.id,
    fullName: user.full_name || user.fullName || 'Learner',
    email: user.email,
    level: user.level || 'B1',
    xp: Number(user.xp || 0),
    levelNumber: Number(user.level_number || user.levelNumber || 1),
    streak: Number(user.streak || 0),
    dailyGoal: Number(user.daily_goal || user.dailyGoal || 20),
    preferredTopics: Array.isArray(user.preferredTopics) ? user.preferredTopics : (user.user_topics || []),
  };
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function findUserByEmail(email) {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  } catch (error) {
    return localUsers.get(email) || null;
  }
}

async function createUserInDb({ fullName, email, password }) {
  const id = `u-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await pool.query(
      'INSERT INTO users (id, full_name, email, password_hash, level, xp, level_number, streak, daily_goal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, fullName, email, passwordHash, 'A1', 0, 1, 0, 20],
    );
    const user = {
      id,
      full_name: fullName,
      email,
      password_hash: passwordHash,
      level: 'A1',
      xp: 0,
      level_number: 1,
      streak: 0,
      daily_goal: 20,
    };
    localUsers.set(email, user);
    return user;
  } catch (error) {
    const user = {
      id,
      full_name: fullName,
      email,
      password_hash: passwordHash,
      level: 'A1',
      xp: 0,
      level_number: 1,
      streak: 0,
      daily_goal: 20,
    };
    localUsers.set(email, user);
    return user;
  }
}

app.get('/', (req, res) => {
  res.json({
    message: 'GnaryX TA Backend is running',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    success: true,
    message: 'Server healthy',
    uptime: process.uptime(),
    database: dbStatus,
  });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await findUserByEmail(String(email).trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isValid = user.password_hash ? await bcrypt.compare(String(password), user.password_hash) : false;
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = createToken(user);
    return res.json({
      token,
      user: normalizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body || {};

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Full name, email and password are required' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const existing = await findUserByEmail(trimmedEmail);
    if (existing) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    const user = await createUserInDb({ fullName: String(fullName).trim(), email: trimmedEmail, password: String(password) });
    const token = createToken(user);
    return res.status(201).json({
      token,
      user: normalizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserByEmail(payload.email);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.json({ user: normalizeUser(user) });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 20');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.get('/api/courses', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM courses WHERE deleted_at IS NULL ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.get('/api/lessons/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const [rows] = await pool.query(
      'SELECT * FROM lessons WHERE course_id = ? AND deleted_at IS NULL ORDER BY lesson_number ASC',
      [courseId],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.get('/api/vocabulary', async (req, res) => {
  try {
    const { search, level, topic, partOfSpeech, difficulty, favorite, learned } = req.query;
    let sql = 'SELECT * FROM vocabulary_words WHERE deleted_at IS NULL';
    const values = [];

    if (search) {
      sql += ' AND (word LIKE ? OR meaning LIKE ? OR meaning_vi LIKE ?)';
      const q = `%${search}%`;
      values.push(q, q, q);
    }

    if (level && level !== 'All') {
      sql += ' AND level = ?';
      values.push(level);
    }

    if (topic && topic !== 'All') {
      sql += ' AND topic = ?';
      values.push(topic);
    }

    if (partOfSpeech && partOfSpeech !== 'All') {
      sql += ' AND part_of_speech = ?';
      values.push(partOfSpeech);
    }

    if (difficulty && difficulty !== 'All') {
      sql += ' AND difficulty = ?';
      values.push(difficulty);
    }

    if (favorite === 'true') {
      sql += ' AND id IN (SELECT word_id FROM user_word_progress WHERE user_id = ? AND is_favorite = 1)';
      values.push('u1000000-0000-0000-0000-000000000001');
    }

    if (learned === 'Learned') {
      sql += ' AND id IN (SELECT word_id FROM user_word_progress WHERE user_id = ? AND is_learned = 1)';
      values.push('u1000000-0000-0000-0000-000000000001');
    } else if (learned === 'Not Learned') {
      sql += ' AND id NOT IN (SELECT word_id FROM user_word_progress WHERE user_id = ? AND is_learned = 1)';
      values.push('u1000000-0000-0000-0000-000000000001');
    }

    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(sql, values);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.get('/api/vocabulary/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vocabulary_words WHERE id = ? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [user] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', ['u1000000-0000-0000-0000-000000000001']);
    const [progress] = await pool.query('SELECT * FROM user_course_progress WHERE user_id = ? LIMIT 1', ['u1000000-0000-0000-0000-000000000001']);
    const [activities] = await pool.query('SELECT * FROM learning_activities WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', ['u1000000-0000-0000-0000-000000000001']);
    const [wordOfTheDay] = await pool.query('SELECT * FROM vocabulary_words ORDER BY RAND() LIMIT 1');

    res.json({
      user: user[0] || null,
      progress: progress[0] || null,
      recentActivity: activities,
      wordOfTheDay: wordOfTheDay[0] || null,
    });
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
