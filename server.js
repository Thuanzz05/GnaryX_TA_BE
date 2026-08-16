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

// =========================
// COURSES ROUTES
// =========================

// Get all courses
app.get('/api/courses', authenticateToken, async (req, res) => {
  try {
    const [courses] = await pool.query(
      `
        SELECT c.*,
               COALESCE(COUNT(DISTINCT l.id), 0) as lesson_count,
               COALESCE(ucp.progress, 0) as userProgress,
               COALESCE(ucp.status, 'not-started') as userStatus
        FROM courses c
        LEFT JOIN lessons l ON c.id = l.course_id AND l.deleted_at IS NULL
        LEFT JOIN user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = ?
        WHERE c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.created_at
      `,
      [req.user.id],
    );

    res.json(courses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single course with lessons
app.get('/api/courses/:courseId', authenticateToken, async (req, res) => {
  try {
    const { courseId } = req.params;
    
    const [courses] = await pool.query(
      `
        SELECT c.*,
               COALESCE(ucp.progress, 0) as userProgress,
               COALESCE(ucp.status, 'not-started') as userStatus
        FROM courses c
        LEFT JOIN user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = ?
        WHERE c.id = ? AND c.deleted_at IS NULL
      `,
      [req.user.id, courseId],
    );

    if (courses.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const [lessons] = await pool.query(
      `
        SELECT l.*,
               COALESCE(ulp.progress, 0) as userProgress,
               COALESCE(ulp.status, 'locked') as userStatus,
               ulp.completed_at
        FROM lessons l
        LEFT JOIN user_lesson_progress ulp ON l.id = ulp.lesson_id AND ulp.user_id = ?
        WHERE l.course_id = ? AND l.deleted_at IS NULL
        ORDER BY l.lesson_number
      `,
      [req.user.id, courseId],
    );

    res.json({
      ...courses[0],
      lessons,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// LESSONS ROUTES
// =========================

// Get lesson detail
app.get('/api/lessons/:lessonId', authenticateToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const [lessons] = await pool.query(
      `
        SELECT l.*,
               COALESCE(ulp.progress, 0) as userProgress,
               COALESCE(ulp.status, 'locked') as userStatus
        FROM lessons l
        LEFT JOIN user_lesson_progress ulp ON l.id = ulp.lesson_id AND ulp.user_id = ?
        WHERE l.id = ? AND l.deleted_at IS NULL
      `,
      [req.user.id, lessonId],
    );

    if (lessons.length === 0) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    const [words] = await pool.query(
      `
        SELECT v.*,
               IF(up.is_favorite = 1, true, false) as isFavorite,
               IF(up.is_learned = 1, true, false) as isLearned
        FROM lesson_vocabulary lv
        JOIN vocabulary_words v ON lv.word_id = v.id
        LEFT JOIN user_word_progress up ON v.id = up.word_id AND up.user_id = ?
        WHERE lv.lesson_id = ? AND v.deleted_at IS NULL
      `,
      [req.user.id, lessonId],
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

    res.json({
      ...lessons[0],
      words: parsedWords,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update lesson progress
app.post('/api/lessons/:lessonId/progress', authenticateToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const { progress, status } = req.body;
    const userId = req.user.id;

    const validStatus = ['locked', 'unlocked', 'in-progress', 'completed'];
    if (status && !validStatus.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const [existing] = await pool.query(
      'SELECT * FROM user_lesson_progress WHERE user_id = ? AND lesson_id = ?',
      [userId, lessonId],
    );

    if (existing.length === 0) {
      await pool.query(
        `INSERT INTO user_lesson_progress (user_id, lesson_id, progress, status, completed_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, lessonId, progress || 0, status || 'unlocked', status === 'completed' ? new Date() : null],
      );
    } else {
      await pool.query(
        `UPDATE user_lesson_progress SET progress = ?, status = ?, completed_at = ?
         WHERE user_id = ? AND lesson_id = ?`,
        [progress || 0, status || existing[0].status, status === 'completed' ? new Date() : existing[0].completed_at, userId, lessonId],
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// PROGRESS ROUTES
// =========================

// Get user dashboard progress
app.get('/api/progress/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // User stats
    const [users] = await pool.query('SELECT xp, streak, level, level_number FROM users WHERE id = ?', [userId]);
    const user = users[0];

    // Active courses
    const [activeCourses] = await pool.query(
      `
        SELECT c.*, COALESCE(ucp.progress, 0) as progress, COALESCE(ucp.status, 'not-started') as status
        FROM courses c
        LEFT JOIN user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = ?
        WHERE c.deleted_at IS NULL AND ucp.status IN ('in-progress', 'completed')
        ORDER BY ucp.last_accessed_at DESC
        LIMIT 3
      `,
      [userId],
    );

    // Recent activity
    const [recentActivity] = await pool.query(
      `
        SELECT ulp.*, l.title as lesson_title, c.title as course_title
        FROM user_lesson_progress ulp
        JOIN lessons l ON ulp.lesson_id = l.id
        JOIN courses c ON l.course_id = c.id
        WHERE ulp.user_id = ?
        ORDER BY ulp.completed_at DESC
        LIMIT 5
      `,
      [userId],
    );

    // Statistics
    const [stats] = await pool.query(
      `
        SELECT 
          COUNT(DISTINCT c.id) as totalCourses,
          COALESCE(SUM(CASE WHEN ucp.status = 'completed' THEN 1 ELSE 0 END), 0) as completedCourses,
          COALESCE(SUM(CASE WHEN ucp.status = 'in-progress' THEN 1 ELSE 0 END), 0) as inProgressCourses,
          COALESCE(COUNT(DISTINCT ulp.lesson_id), 0) as lessonsCompleted
        FROM courses c
        LEFT JOIN user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = ?
        LEFT JOIN user_lesson_progress ulp ON ulp.user_id = ? AND ulp.status = 'completed'
        WHERE c.deleted_at IS NULL
      `,
      [userId, userId],
    );

    res.json({
      user,
      activeCourses,
      recentActivity,
      stats: stats[0] || {},
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user overall progress
app.get('/api/progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [courseProgress] = await pool.query(
      `
        SELECT c.id, c.title, COALESCE(ucp.progress, 0) as progress, COALESCE(ucp.status, 'not-started') as status
        FROM courses c
        LEFT JOIN user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = ?
        WHERE c.deleted_at IS NULL
      `,
      [userId],
    );

    res.json(courseProgress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// USER PROFILE ROUTES
// =========================

// Get user profile
app.get('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];
    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      level: user.level,
      levelNumber: user.level_number,
      xp: Number(user.xp || 0),
      streak: Number(user.streak || 0),
      dailyGoal: Number(user.daily_goal || 20),
      avatar: user.avatar,
      lastLoginAt: user.last_login_at,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, dailyGoal, avatar } = req.body;
    const userId = req.user.id;

    const updates = [];
    const values = [];

    if (fullName !== undefined) {
      updates.push('full_name = ?');
      values.push(String(fullName).trim());
    }
    if (dailyGoal !== undefined) {
      updates.push('daily_goal = ?');
      values.push(Number(dailyGoal));
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?');
      values.push(avatar);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user settings
app.get('/api/users/settings', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];
    const [topics] = await pool.query('SELECT topic_name FROM user_topics WHERE user_id = ?', [req.user.id]);

    res.json({
      dailyGoal: Number(user.daily_goal || 20),
      preferredTopics: topics.map((t) => t.topic_name),
      level: user.level,
      theme: 'light', // Default theme, can be extended
      notifications: true, // Default, can be extended
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user settings
app.put('/api/users/settings', authenticateToken, async (req, res) => {
  try {
    const { dailyGoal, preferredTopics } = req.body;
    const userId = req.user.id;

    if (dailyGoal !== undefined) {
      await pool.query('UPDATE users SET daily_goal = ? WHERE id = ?', [Number(dailyGoal), userId]);
    }

    if (preferredTopics && Array.isArray(preferredTopics)) {
      // Clear existing topics
      await pool.query('DELETE FROM user_topics WHERE user_id = ?', [userId]);
      // Insert new topics
      for (const topic of preferredTopics) {
        await pool.query('INSERT INTO user_topics (user_id, topic_name) VALUES (?, ?)', [userId, String(topic).trim()]);
      }
    }

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user favorites
app.get('/api/users/favorites', authenticateToken, async (req, res) => {
  try {
    const [favorites] = await pool.query(
      `
        SELECT v.*
        FROM user_word_progress up
        JOIN vocabulary_words v ON up.word_id = v.id
        WHERE up.user_id = ? AND up.is_favorite = 1 AND v.deleted_at IS NULL
      `,
      [req.user.id],
    );

    const parsed = favorites.map((word) => ({
      ...word,
      synonyms: parseJsonField(word.synonyms),
      antonyms: parseJsonField(word.antonyms),
      collocations: parseJsonField(word.collocations),
      word_family: parseJsonField(word.word_family),
      isFavorite: true,
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user activity
app.get('/api/users/activity', authenticateToken, async (req, res) => {
  try {
    const [activities] = await pool.query(
      `
        SELECT ulp.*, l.title as lesson_title, c.title as course_title
        FROM user_lesson_progress ulp
        JOIN lessons l ON ulp.lesson_id = l.id
        JOIN courses c ON l.course_id = c.id
        WHERE ulp.user_id = ? AND ulp.status = 'completed'
        ORDER BY ulp.completed_at DESC
      `,
      [req.user.id],
    );

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// QUIZ ROUTES
// =========================

// Get quizzes
app.get('/api/quizzes', authenticateToken, async (req, res) => {
  try {
    const [quizzes] = await pool.query('SELECT * FROM quizzes');
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get quiz detail with questions
app.get('/api/quizzes/:quizId', authenticateToken, async (req, res) => {
  try {
    const { quizId } = req.params;

    const [quizzes] = await pool.query('SELECT * FROM quizzes WHERE id = ?', [quizId]);
    if (quizzes.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const [questions] = await pool.query(
      `
        SELECT id, quiz_id, question_text, options, word_id
        FROM quiz_questions
        WHERE quiz_id = ?
      `,
      [quizId],
    );

    const parsedQuestions = questions.map((q) => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
    }));

    res.json({
      ...quizzes[0],
      questions: parsedQuestions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit quiz attempt
app.post('/api/quizzes/:quizId/submit', authenticateToken, async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers } = req.body; // answers: [{ questionId, selectedAnswer }, ...]
    const userId = req.user.id;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: 'Answers array is required' });
    }

    // Calculate score
    let correctAnswers = 0;
    let wrongAnswers = 0;

    const attemptId = uuidv4();
    await pool.query(
      'INSERT INTO quiz_attempts (id, user_id, quiz_id) VALUES (?, ?, ?)',
      [attemptId, userId, quizId],
    );

    for (const answer of answers) {
      const { questionId, selectedAnswer } = answer;

      const [questions] = await pool.query(
        'SELECT correct_answer FROM quiz_questions WHERE id = ?',
        [questionId],
      );

      if (questions.length === 0) continue;

      const isCorrect = questions[0].correct_answer === selectedAnswer;
      if (isCorrect) {
        correctAnswers++;
      } else {
        wrongAnswers++;
      }

      await pool.query(
        'INSERT INTO quiz_attempt_answers (id, attempt_id, question_id, selected_answer, is_correct) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), attemptId, questionId, selectedAnswer, isCorrect],
      );
    }

    const score = Math.round((correctAnswers / answers.length) * 100);
    const xpEarned = Math.round((correctAnswers / answers.length) * 50);

    await pool.query(
      'UPDATE quiz_attempts SET score = ?, correct_answers = ?, wrong_answers = ?, xp_earned = ? WHERE id = ?',
      [score, correctAnswers, wrongAnswers, xpEarned, attemptId],
    );

    // Update user XP
    await pool.query('UPDATE users SET xp = xp + ? WHERE id = ?', [xpEarned, userId]);

    res.json({
      attemptId,
      score,
      correctAnswers,
      wrongAnswers,
      xpEarned,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get quiz attempts
app.get('/api/quizzes/attempts', authenticateToken, async (req, res) => {
  try {
    const [attempts] = await pool.query(
      `
        SELECT qa.*, q.title as quiz_title
        FROM quiz_attempts qa
        JOIN quizzes q ON qa.quiz_id = q.id
        WHERE qa.user_id = ?
        ORDER BY qa.submitted_at DESC
      `,
      [req.user.id],
    );

    res.json(attempts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// FLASHCARDS ROUTES (Using Vocabulary System)
// =========================

// Get flashcards (vocabulary words for review)
app.get('/api/flashcards', authenticateToken, async (req, res) => {
  try {
    const [cards] = await pool.query(
      `
        SELECT v.*,
               up.is_learned, up.review_count, up.ease_factor,
               up.next_review_date
        FROM vocabulary_words v
        LEFT JOIN user_word_progress up ON v.id = up.word_id AND up.user_id = ?
        WHERE v.deleted_at IS NULL
        ORDER BY up.next_review_date ASC NULLS LAST
      `,
      [req.user.id],
    );

    const parsed = cards.map((card) => ({
      ...card,
      synonyms: parseJsonField(card.synonyms),
      antonyms: parseJsonField(card.antonyms),
      collocations: parseJsonField(card.collocations),
      word_family: parseJsonField(card.word_family),
      isLearned: Boolean(card.is_learned),
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get flashcards for today's review
app.get('/api/flashcards/review/today', authenticateToken, async (req, res) => {
  try {
    const [cards] = await pool.query(
      `
        SELECT v.*,
               up.review_count, up.ease_factor, up.interval_days,
               up.next_review_date, up.last_reviewed_at
        FROM vocabulary_words v
        JOIN user_word_progress up ON v.id = up.word_id AND up.user_id = ?
        WHERE v.deleted_at IS NULL
          AND up.next_review_date IS NOT NULL
          AND up.next_review_date <= NOW()
        ORDER BY up.next_review_date ASC
      `,
      [req.user.id],
    );

    const parsed = cards.map((card) => ({
      ...card,
      synonyms: parseJsonField(card.synonyms),
      antonyms: parseJsonField(card.antonyms),
      collocations: parseJsonField(card.collocations),
      word_family: parseJsonField(card.word_family),
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit flashcard review (Spaced Repetition)
app.post('/api/flashcards/:wordId/review', authenticateToken, async (req, res) => {
  try {
    const { wordId } = req.params;
    const { quality } = req.body; // quality: 0-5 (SM-2 algorithm)
    const userId = req.user.id;

    if (quality === undefined || quality < 0 || quality > 5) {
      return res.status(400).json({ message: 'Quality must be between 0 and 5' });
    }

    const [progress] = await pool.query(
      'SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ?',
      [userId, wordId],
    );

    if (progress.length === 0) {
      return res.status(404).json({ message: 'Word not found in user progress' });
    }

    const p = progress[0];
    let easeFactor = p.ease_factor || 2.5;
    let interval = p.interval_days || 0;

    // SM-2 Algorithm
    if (quality >= 3) {
      if (interval === 0) {
        interval = 1;
      } else if (interval === 1) {
        interval = 3;
      } else {
        interval = Math.round(interval * easeFactor);
      }
    } else {
      interval = 1;
    }

    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    await pool.query(
      `UPDATE user_word_progress
       SET review_count = review_count + 1,
           ease_factor = ?,
           interval_days = ?,
           next_review_date = ?,
           last_reviewed_at = NOW(),
           is_learned = CASE WHEN review_count >= 5 THEN 1 ELSE is_learned END
       WHERE user_id = ? AND word_id = ?`,
      [easeFactor, interval, nextReviewDate, userId, wordId],
    );

    res.json({
      success: true,
      nextReviewDate,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark word as learned
app.post('/api/flashcards/:wordId/learn', authenticateToken, async (req, res) => {
  try {
    const { wordId } = req.params;
    const userId = req.user.id;

    const [existing] = await pool.query(
      'SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ?',
      [userId, wordId],
    );

    if (existing.length === 0) {
      await pool.query(
        'INSERT INTO user_word_progress (user_id, word_id, is_learned) VALUES (?, ?, 1)',
        [userId, wordId],
      );
    } else {
      await pool.query('UPDATE user_word_progress SET is_learned = 1 WHERE user_id = ? AND word_id = ?', [userId, wordId]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
