CREATE DATABASE IF NOT EXISTS gnaryx_ta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gnaryx_ta;

-- =========================
-- 1. USERS & AUTHENTICATION
-- =========================
CREATE TABLE users (
    id CHAR(36) PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    auth_provider ENUM('local', 'google') NOT NULL DEFAULT 'local', -- Phương thức đăng nhập
    provider_id VARCHAR(255) NULL, -- ID của bên thứ 3 (Google ID)
    avatar VARCHAR(255) NULL,
    level ENUM('A1','A2','B1','B2','C1','C2') NOT NULL DEFAULT 'A1',
    xp INT NOT NULL DEFAULT 0,
    level_number INT NOT NULL DEFAULT 1,
    streak INT NOT NULL DEFAULT 0,
    daily_goal INT NOT NULL DEFAULT 20,
    last_login_at TIMESTAMP NULL, -- Theo dõi lần cuối đăng nhập
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE user_refresh_tokens (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token VARCHAR(512) NOT NULL UNIQUE, -- Lưu chuỗi Refresh Token
    expires_at TIMESTAMP NOT NULL,      -- Thời gian hết hạn
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE, -- Cờ thu hồi token (đăng xuất)
    device_info VARCHAR(255) NULL,      -- Tùy chọn: Lưu thông tin thiết bị (ví dụ: Chrome, iOS)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_topics (
    user_id CHAR(36) NOT NULL,
    topic_name VARCHAR(100) NOT NULL,
    PRIMARY KEY (user_id, topic_name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =========================
-- 2. COURSES & LESSONS (Dữ liệu Master chung)
-- =========================
CREATE TABLE courses (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    level VARCHAR(50) NOT NULL DEFAULT 'B1',
    category VARCHAR(100) NOT NULL,
    lesson_count INT NOT NULL DEFAULT 0,
    word_count INT NOT NULL DEFAULT 0,
    icon VARCHAR(100) NOT NULL DEFAULT 'book',
    color VARCHAR(50) NOT NULL DEFAULT '#4F46E5',
    deleted_at TIMESTAMP NULL DEFAULT NULL, -- Soft Delete
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lessons (
    id CHAR(36) PRIMARY KEY,
    course_id CHAR(36) NOT NULL,
    lesson_number INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    word_count INT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP NULL DEFAULT NULL, -- Soft Delete
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- =========================
-- 2.1 COURSE & LESSON PROGRESS (Tiến độ học của từng User)
-- =========================
CREATE TABLE user_course_progress (
    user_id CHAR(36) NOT NULL,
    course_id CHAR(36) NOT NULL,
    progress INT NOT NULL DEFAULT 0,
    status ENUM('not-started', 'in-progress', 'completed') NOT NULL DEFAULT 'not-started',
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE user_lesson_progress (
    user_id CHAR(36) NOT NULL,
    lesson_id CHAR(36) NOT NULL,
    progress INT NOT NULL DEFAULT 0,
    status ENUM('locked', 'unlocked', 'in-progress', 'completed') NOT NULL DEFAULT 'locked',
    completed_at TIMESTAMP NULL,
    PRIMARY KEY (user_id, lesson_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

-- =========================
-- 3. VOCABULARY & SPACED REPETITION
-- =========================
CREATE TABLE vocabulary_words (
    id CHAR(36) PRIMARY KEY,
    word VARCHAR(120) NOT NULL,
    phonetic VARCHAR(120) NULL,
    part_of_speech ENUM('noun','verb','adjective','adverb','preposition','conjunction','pronoun','interjection') NOT NULL,
    meaning VARCHAR(255) NOT NULL,
    meaning_vi VARCHAR(255) NOT NULL,
    example_text TEXT NOT NULL,
    example_vi TEXT NULL,
    level ENUM('A1','A2','B1','B2','C1','C2') NOT NULL,
    topic VARCHAR(100) NOT NULL,
    difficulty ENUM('easy','medium','hard') NOT NULL,
    synonyms JSON NULL,
    antonyms JSON NULL,
    word_family JSON NULL,
    collocations JSON NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL, -- Soft Delete
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_word_progress (
    user_id CHAR(36) NOT NULL,
    word_id CHAR(36) NOT NULL,
    is_learned BOOLEAN NOT NULL DEFAULT FALSE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Spaced-Repetition System (SRS) parameters
    review_count INT NOT NULL DEFAULT 0,
    ease_factor FLOAT NOT NULL DEFAULT 2.5,
    interval_days INT NOT NULL DEFAULT 0,
    next_review_date TIMESTAMP NULL,
    last_reviewed_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, word_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES vocabulary_words(id) ON DELETE CASCADE
);

-- =========================
-- 4. QUIZ
-- =========================
CREATE TABLE quizzes (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    time_limit INT NOT NULL DEFAULT 300,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quiz_questions (
    id CHAR(36) PRIMARY KEY,
    quiz_id CHAR(36) NOT NULL,
    question_text TEXT NOT NULL,
    options JSON NOT NULL,
    correct_answer VARCHAR(255) NOT NULL,
    explanation TEXT NOT NULL,
    word_id CHAR(36) NULL,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES vocabulary_words(id) ON DELETE SET NULL
);

CREATE TABLE quiz_attempts (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    quiz_id CHAR(36) NOT NULL,
    score INT NOT NULL DEFAULT 0,
    correct_answers INT NOT NULL DEFAULT 0,
    wrong_answers INT NOT NULL DEFAULT 0,
    xp_earned INT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

CREATE TABLE quiz_attempt_answers (
    id CHAR(36) PRIMARY KEY,
    attempt_id CHAR(36) NOT NULL,
    question_id CHAR(36) NOT NULL,
    selected_answer VARCHAR(255) NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
);

-- =========================
-- 5. DASHBOARD / ACTIVITY
-- =========================
CREATE TABLE learning_activities (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    activity_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    xp_earned INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE achievements (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    icon VARCHAR(100) NOT NULL,
    xp_reward INT NOT NULL DEFAULT 0
);

CREATE TABLE user_achievements (
    user_id CHAR(36) NOT NULL,
    achievement_id CHAR(36) NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, achievement_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
);

-- =========================
-- 6. INDEXES
-- =========================
-- Users & Auth
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_refresh_token ON user_refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_user ON user_refresh_tokens(user_id);

-- Courses & Lessons
CREATE INDEX idx_courses_category ON courses(category);
CREATE INDEX idx_lessons_course_id ON lessons(course_id);

-- Vocabulary
CREATE INDEX idx_vocab_word ON vocabulary_words(word);
CREATE INDEX idx_vocab_level ON vocabulary_words(level);
CREATE INDEX idx_vocab_topic ON vocabulary_words(topic);

-- Progress & Spaced Repetition System
CREATE INDEX idx_user_word_progress_user ON user_word_progress(user_id);
CREATE INDEX idx_user_word_progress_favorite ON user_word_progress(user_id, is_favorite);
CREATE INDEX idx_user_word_progress_learned ON user_word_progress(user_id, is_learned);
CREATE INDEX idx_user_word_progress_next_review ON user_word_progress(user_id, next_review_date); -- Cực kỳ quan trọng để API "Review Today" chạy mượt

-- Activities
CREATE INDEX idx_quiz_attempts_user ON quiz_attempts(user_id);
CREATE INDEX idx_learning_activities_user ON learning_activities(user_id);




USE gnaryx_ta;

-- ==========================================
-- 1. XÓA DỮ LIỆU CŨ (Nếu có, để tránh lỗi Duplicate)
-- ==========================================
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE user_achievements;
TRUNCATE TABLE achievements;
TRUNCATE TABLE learning_activities;
TRUNCATE TABLE quiz_attempt_answers;
TRUNCATE TABLE quiz_attempts;
TRUNCATE TABLE quiz_questions;
TRUNCATE TABLE quizzes;
TRUNCATE TABLE user_word_progress;
TRUNCATE TABLE vocabulary_words;
TRUNCATE TABLE user_lesson_progress;
TRUNCATE TABLE user_course_progress;
TRUNCATE TABLE lessons;
TRUNCATE TABLE courses;
TRUNCATE TABLE user_topics;
TRUNCATE TABLE user_refresh_tokens;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS = 1;

-- ==========================================
-- 2. THÊM USERS & TOPICS
-- ==========================================
INSERT INTO users (id, full_name, email, password_hash, auth_provider, level, xp, streak, daily_goal) VALUES 
('u1000000-0000-0000-0000-000000000001', 'Duy Thuấn', 'thuan@example.com', '$2b$10$Atg4B785eqXXtkdTzjnm9OAzDvwpgbbinjiIjjOIWdIxlNfucMP7q', 'local', 'B1', 1250, 7, 20),
('u2000000-0000-0000-0000-000000000002', 'Google User', 'google@example.com', NULL, 'google', 'A2', 400, 2, 15);

INSERT INTO user_topics (user_id, topic_name) VALUES 
('u1000000-0000-0000-0000-000000000001', 'Technology'),
('u1000000-0000-0000-0000-000000000001', 'Business'),
('u2000000-0000-0000-0000-000000000002', 'Travel');

-- ==========================================
-- 3. THÊM COURSES & LESSONS
-- ==========================================
INSERT INTO courses (id, title, description, level, category, lesson_count, word_count, icon, color) VALUES 
('c1000000-0000-0000-0000-000000000001', 'Business English', 'Master professional vocabulary for the workplace.', 'B2', 'Business', 2, 40, 'briefcase', '#4F46E5'),
('c2000000-0000-0000-0000-000000000002', 'IELTS Core', 'Essential academic words for band 7.0+.', 'C1', 'Academic', 1, 20, 'graduation-cap', '#10B981');

INSERT INTO lessons (id, course_id, lesson_number, title, description, word_count) VALUES 
('l1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, 'Office Communication', 'Words for daily office talks', 20),
('l2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 2, 'Negotiation', 'Vocabulary for business deals', 20),
('l3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000002', 1, 'Academic Writing', 'Formal words for essays', 20);

-- Tiến độ của Duy Thuấn
INSERT INTO user_course_progress (user_id, course_id, progress, status) VALUES 
('u1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 50, 'in-progress');

INSERT INTO user_lesson_progress (user_id, lesson_id, progress, status, completed_at) VALUES 
('u1000000-0000-0000-0000-000000000001', 'l1000000-0000-0000-0000-000000000001', 100, 'completed', NOW()),
('u1000000-0000-0000-0000-000000000001', 'l2000000-0000-0000-0000-000000000002', 20, 'in-progress', NULL);

-- ==========================================
-- 4. THÊM VOCABULARY WORDS
-- ==========================================
INSERT INTO vocabulary_words (id, word, phonetic, part_of_speech, meaning, meaning_vi, example_text, example_vi, level, topic, difficulty, synonyms, antonyms, word_family, collocations) VALUES 
('w1000000-0000-0000-0000-000000000001', 'abandon', '/əˈbændən/', 'verb', 'to leave someone or something completely', 'từ bỏ, bỏ rơi', 'He abandoned his car and walked home.', 'Anh ấy đã bỏ lại xe và đi bộ về nhà.', 'B2', 'Daily Life', 'medium', '["leave", "desert", "give up"]', '["keep", "continue"]', '["abandoned", "abandonment"]', '["abandon a plan", "abandon an idea"]'),

('w2000000-0000-0000-0000-000000000002', 'resilient', '/rɪˈzɪliənt/', 'adjective', 'able to withstand or recover quickly from difficult conditions', 'kiên cường, mau phục hồi', 'She remained resilient despite many challenges.', 'Cô ấy vẫn kiên cường bất chấp nhiều thử thách.', 'C1', 'Psychology', 'hard', '["tough", "strong", "adaptable"]', '["vulnerable", "weak"]', '["resilience", "resiliently"]', '["highly resilient", "remain resilient"]'),

('w3000000-0000-0000-0000-000000000003', 'achieve', '/əˈtʃiːv/', 'verb', 'to successfully bring about or reach a desired objective', 'đạt được, hoàn thành', 'They achieved high scores in the exam.', 'Họ đã đạt điểm cao trong kỳ thi.', 'B1', 'Education', 'easy', '["accomplish", "attain", "reach"]', '["fail", "miss"]', '["achievement", "achievable"]', '["achieve a goal", "achieve success"]'),

('w4000000-0000-0000-0000-000000000004', 'strategy', '/ˈstrætədʒi/', 'noun', 'a plan of action designed to achieve a long-term aim', 'chiến lược', 'The company needs a new marketing strategy.', 'Công ty cần một chiến lược tiếp thị mới.', 'B2', 'Business', 'medium', '["plan", "approach", "tactic"]', '[]', '["strategic", "strategist"]', '["develop a strategy", "marketing strategy"]');

-- Tiến độ Học Từ vựng (SRS) của Duy Thuấn
INSERT INTO user_word_progress (user_id, word_id, is_learned, is_favorite, review_count, ease_factor, interval_days, next_review_date, last_reviewed_at) VALUES 
-- Từ này đã học, cần ôn lại (Due Today)
('u1000000-0000-0000-0000-000000000001', 'w1000000-0000-0000-0000-000000000001', TRUE, TRUE, 3, 2.3, 2, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY)),
-- Từ này vừa học hôm nay
('u1000000-0000-0000-0000-000000000001', 'w2000000-0000-0000-0000-000000000002', TRUE, FALSE, 1, 2.5, 1, DATE_ADD(NOW(), INTERVAL 1 DAY), NOW()),
-- Từ này yêu thích nhưng chưa bắt đầu học (chưa có review)
('u1000000-0000-0000-0000-000000000001', 'w3000000-0000-0000-0000-000000000003', FALSE, TRUE, 0, 2.5, 0, NULL, NULL);

-- ==========================================
-- 5. THÊM QUIZ DỮ LIỆU
-- ==========================================
INSERT INTO quizzes (id, title, description, time_limit) VALUES 
('q1000000-0000-0000-0000-000000000001', 'Business Unit 1 Quiz', 'Test your knowledge on office communication.', 300);

INSERT INTO quiz_questions (id, quiz_id, question_text, options, correct_answer, explanation, word_id) VALUES 
('qq100000-0000-0000-0000-000000000001', 'q1000000-0000-0000-0000-000000000001', 'Which word means "to leave completely"?', '["Improve", "Abandon", "Avoid", "Reduce"]', 'Abandon', 'Abandon means to leave someone or something completely.', 'w1000000-0000-0000-0000-000000000001'),
('qq200000-0000-0000-0000-000000000002', 'q1000000-0000-0000-0000-000000000001', 'Choose the synonym for "resilient":', '["Weak", "Vulnerable", "Adaptable", "Rigid"]', 'Adaptable', 'Resilient means being able to adapt and recover.', 'w2000000-0000-0000-0000-000000000002');

-- Lịch sử làm bài quiz
INSERT INTO quiz_attempts (id, user_id, quiz_id, score, correct_answers, wrong_answers, xp_earned) VALUES 
('qa100000-0000-0000-0000-000000000001', 'u1000000-0000-0000-0000-000000000001', 'q1000000-0000-0000-0000-000000000001', 50, 1, 1, 20);

INSERT INTO quiz_attempt_answers (id, attempt_id, question_id, selected_answer, is_correct) VALUES 
('qaa10000-0000-0000-0000-000000000001', 'qa100000-0000-0000-0000-000000000001', 'qq100000-0000-0000-0000-000000000001', 'Abandon', TRUE),
('qaa20000-0000-0000-0000-000000000002', 'qa100000-0000-0000-0000-000000000001', 'qq200000-0000-0000-0000-000000000002', 'Weak', FALSE);

-- ==========================================
-- 6. ACTIVITIES & ACHIEVEMENTS
-- ==========================================
INSERT INTO achievements (id, title, description, icon, xp_reward) VALUES 
('a1000000-0000-0000-0000-000000000001', 'First Blood', 'Completed your first lesson.', 'medal', 50),
('a2000000-0000-0000-0000-000000000002', 'Streak Master', 'Achieve a 7-day learning streak.', 'flame', 150),
('a3000000-0000-0000-0000-000000000003', 'Word Scholar', 'Learn 100 new words.', 'book', 200);

-- Lịch sử mở khóa
INSERT INTO user_achievements (user_id, achievement_id) VALUES 
('u1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
('u1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002');

-- Lịch sử học tập (Hiển thị ở Dashboard)
INSERT INTO learning_activities (id, user_id, activity_type, description, xp_earned) VALUES 
('act10000-0000-0000-0000-000000000001', 'u1000000-0000-0000-0000-000000000001', 'lesson_completed', 'Completed Business English Lesson 1', 100),
('act20000-0000-0000-0000-000000000002', 'u1000000-0000-0000-0000-000000000001', 'quiz_completed', 'Scored 50% on Business Unit 1 Quiz', 20),
('act30000-0000-0000-0000-000000000003', 'u1000000-0000-0000-0000-000000000001', 'review_completed', 'Reviewed 15 flashcards', 30);