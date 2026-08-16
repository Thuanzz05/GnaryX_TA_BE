const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'lexilearn_jwt_secret_key';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'lexilearn_refresh_secret_key';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || '7d';

const parseJsonField = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

app.get('/', (req, res) => {
  res.json({
    message: 'GnaryX TA Backend is running',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.testConnection();
    res.json({
      success: true,
      uptime: process.uptime(),
      database: result,
    });
  } catch (error) {
    res.status(500).json({ message: 'Health check failed', error: error.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { fullName, email, password } = req.body || {};

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Full name, email and password are required' });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email đã tồn tại!' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const userId = uuidv4();

    await pool.query(
      'INSERT INTO users (id, full_name, email, password_hash, auth_provider) VALUES (?, ?, ?, ?, ?)',
      [userId, String(fullName).trim(), normalizedEmail, passwordHash, 'local'],
    );

    const user = {
      id: userId,
      fullName: String(fullName).trim(),
      name: String(fullName).trim(),
      email: normalizedEmail,
      level: 'A1',
      xp: 0,
      levelNumber: 1,
      streak: 0,
      dailyGoal: 20,
      preferredTopics: [],
    };

    const accessToken = jwt.sign({ id: userId, email: normalizedEmail, level: 'A1' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = jwt.sign({ id: userId }, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

    await pool.query(
      'INSERT INTO user_refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), userId, refreshToken],
    );

    res.status(201).json({
      message: 'Đăng ký thành công!',
      accessToken,
      refreshToken,
      user,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const [users] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Sai email hoặc mật khẩu!' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(String(password), user.password_hash || '');
    if (!validPassword) {
      return res.status(401).json({ message: 'Sai email hoặc mật khẩu!' });
    }

    const accessToken = jwt.sign({ id: user.id, email: user.email, level: user.level }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = jwt.sign({ id: user.id }, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

    await pool.query(
      'INSERT INTO user_refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), user.id, refreshToken],
    );

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.full_name,
        name: user.full_name,
        email: user.email,
        level: user.level,
        avatar: user.avatar,
        xp: Number(user.xp || 0),
        levelNumber: Number(user.level_number || 1),
        streak: Number(user.streak || 0),
        dailyGoal: Number(user.daily_goal || 20),
        preferredTopics: Array.isArray(user.preferredTopics) ? user.preferredTopics : [],
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/refresh-token', async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.sendStatus(401);
  }

  try {
    const [dbTokens] = await pool.query('SELECT * FROM user_refresh_tokens WHERE token = ? AND is_revoked = FALSE LIMIT 1', [token]);
    if (dbTokens.length === 0) {
      return res.sendStatus(403);
    }

    jwt.verify(token, REFRESH_SECRET, async (err, userData) => {
      if (err) {
        return res.sendStatus(403);
      }

      const [users] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userData.id]);
      const user = users[0];
      if (!user) {
        return res.sendStatus(403);
      }

      const accessToken = jwt.sign({ id: user.id, email: user.email, level: user.level }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
      return res.json({ accessToken });
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/vocabulary', authenticateToken, async (req, res) => {
  try {
    const [words] = await pool.query(
      `
        SELECT v.*,
               IF(up.is_favorite = 1, true, false) as isFavorite,
               IF(up.is_learned = 1, true, false) as isLearned
        FROM vocabulary_words v
        LEFT JOIN user_word_progress up ON v.id = up.word_id AND up.user_id = ?
        WHERE v.deleted_at IS NULL
      `,
      [req.user.id],
    );

    const parsedWords = words.map((word) => ({
      ...word,
      synonyms: parseJsonField(word.synonyms),
      antonyms: parseJsonField(word.antonyms),
      collocations: parseJsonField(word.collocations),
      word_family: parseJsonField(word.word_family),
      isFavorite: Boolean(word.isFavorite),
      isLearned: Boolean(word.isLearned),
    }));

    res.json(parsedWords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/vocabulary/:id/toggle-favorite', authenticateToken, async (req, res) => {
  const wordId = req.params.id;
  const userId = req.user.id;

  try {
    const [progress] = await pool.query(
      'SELECT is_favorite FROM user_word_progress WHERE user_id = ? AND word_id = ? LIMIT 1',
      [userId, wordId],
    );

    let isFavorite = true;
    if (progress.length === 0) {
      await pool.query('INSERT INTO user_word_progress (user_id, word_id, is_favorite) VALUES (?, ?, ?)', [userId, wordId, true]);
    } else {
      isFavorite = !progress[0].is_favorite;
      await pool.query('UPDATE user_word_progress SET is_favorite = ? WHERE user_id = ? AND word_id = ?', [isFavorite, userId, wordId]);
    }

    res.json({ isFavorite });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
