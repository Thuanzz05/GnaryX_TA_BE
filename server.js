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

// Middleware to extract user from token
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserByEmail(payload.email);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.userId = user.id;
    req.userEmail = user.email;
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// User Profile Endpoints
app.get('/api/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows[0]) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(normalizeUser(rows[0]));
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.userId !== req.params.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { fullName, level, dailyGoal, preferredTopics } = req.body || {};
    const updates = [];
    const values = [];

    if (fullName) {
      updates.push('full_name = ?');
      values.push(String(fullName).trim());
    }
    if (level) {
      updates.push('level = ?');
      values.push(level);
    }
    if (dailyGoal) {
      updates.push('daily_goal = ?');
      values.push(Number(dailyGoal));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(req.params.id);
    const sql = `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await pool.query(sql, values);

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    res.json(normalizeUser(rows[0]));
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

// Word Progress Endpoints
app.post('/api/vocabulary/:wordId/favorite', authenticateToken, async (req, res) => {
  try {
    const { wordId } = req.params;
    const { isFavorite } = req.body || {};

    if (typeof isFavorite !== 'boolean') {
      return res.status(400).json({ message: 'isFavorite must be boolean' });
    }

    const [existing] = await pool.query(
      'SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ? LIMIT 1',
      [req.userId, wordId],
    );

    if (existing[0]) {
      await pool.query(
        'UPDATE user_word_progress SET is_favorite = ?, updated_at = NOW() WHERE user_id = ? AND word_id = ?',
        [isFavorite ? 1 : 0, req.userId, wordId],
      );
    } else {
      await pool.query(
        'INSERT INTO user_word_progress (user_id, word_id, is_favorite) VALUES (?, ?, ?)',
        [req.userId, wordId, isFavorite ? 1 : 0],
      );
    }

    res.json({ success: true, isFavorite });
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

app.post('/api/vocabulary/:wordId/learned', authenticateToken, async (req, res) => {
  try {
    const { wordId } = req.params;
    const { isLearned } = req.body || {};

    if (typeof isLearned !== 'boolean') {
      return res.status(400).json({ message: 'isLearned must be boolean' });
    }

    const [existing] = await pool.query(
      'SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ? LIMIT 1',
      [req.userId, wordId],
    );

    if (existing[0]) {
      await pool.query(
        'UPDATE user_word_progress SET is_learned = ?, updated_at = NOW() WHERE user_id = ? AND word_id = ?',
        [isLearned ? 1 : 0, req.userId, wordId],
      );
    } else {
      await pool.query(
        'INSERT INTO user_word_progress (user_id, word_id, is_learned) VALUES (?, ?, ?)',
        [req.userId, wordId, isLearned ? 1 : 0],
      );
    }

    res.json({ success: true, isLearned });
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

// Quiz Endpoints
app.get('/api/quizzes', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM quizzes WHERE deleted_at IS NULL ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.get('/api/quizzes/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM quizzes WHERE id = ? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    if (!rows[0]) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

app.post('/api/quizzes/:id/submit', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { answers, timeSpent } = req.body || {};

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: 'answers must be an array' });
    }

    const attemptId = `qa-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let correctCount = 0;
    const results = [];

    for (const answer of answers) {
      const { questionId, selectedAnswer } = answer;
      const [question] = await pool.query('SELECT * FROM quiz_questions WHERE id = ? LIMIT 1', [questionId]);

      if (question[0]) {
        const isCorrect = selectedAnswer === question[0].correct_answer;
        if (isCorrect) correctCount++;
        results.push({
          questionId,
          selectedAnswer,
          correctAnswer: question[0].correct_answer,
          isCorrect,
        });
      }
    }

    const score = Math.round((correctCount / answers.length) * 100);
    const xpEarned = Math.max(10, Math.round(score / 10));

    // Store quiz attempt
    try {
      await pool.query(
        'INSERT INTO quiz_attempts (id, user_id, quiz_id, score, time_spent_seconds, correct_answers, total_questions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [attemptId, req.userId, id, score, timeSpent || 0, correctCount, answers.length],
      );

      // Update user XP
      await pool.query('UPDATE users SET xp = xp + ? WHERE id = ?', [xpEarned, req.userId]);
    } catch (dbError) {
      // If DB fails, still return results
      console.log('DB quiz save failed:', dbError.message);
    }

    res.json({
      score,
      correctCount,
      totalQuestions: answers.length,
      xpEarned,
      results,
    });
  } catch (error) {
    res.status(500).json({ message: 'Quiz submission failed', error: error.message });
  }
});

// Progress Endpoints
app.get('/api/users/:userId/progress', async (req, res) => {
  try {
    const { userId } = req.params;
    const [wordData] = await pool.query(
      'SELECT COUNT(*) as count FROM user_word_progress WHERE user_id = ? AND is_learned = 1',
      [userId],
    );
    const [quizData] = await pool.query(
      'SELECT COUNT(*) as count, AVG(score) as avgScore FROM quiz_attempts WHERE user_id = ?',
      [userId],
    );

    res.json({
      totalWordsLearned: wordData[0]?.count || 0,
      totalQuizzes: quizData[0]?.count || 0,
      averageQuizScore: Math.round(quizData[0]?.avgScore || 0),
    });
  } catch (error) {
    res.status(500).json({ message: 'DB error', error: error.message });
  }
});

// Learning Activity Endpoints
app.post('/api/learning-activities', authenticateToken, async (req, res) => {
  try {
    const { type, description, xpEarned } = req.body || {};

    if (!type || !description) {
      return res.status(400).json({ message: 'type and description are required' });
    }

    const activityId = `la-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    await pool.query(
      'INSERT INTO learning_activities (id, user_id, type, description, xp_earned) VALUES (?, ?, ?, ?, ?)',
      [activityId, req.userId, type, description, xpEarned || 0],
    );

    res.status(201).json({ id: activityId, success: true });
  } catch (error) {
    res.status(500).json({ message: 'Activity creation failed', error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
