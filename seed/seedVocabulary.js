/**
 * Vocabulary seed runner.
 *
 * Reads every *.json file in seed/data/ (each an array of word objects)
 * and inserts them into the vocabulary_words table. Safe to re-run:
 * words that already exist (same word + topic) are skipped instead of
 * duplicated.
 *
 * Usage:
 *   node seed/seedVocabulary.js
 *
 * To add more words later, drop another batch-XX-*.json file into
 * seed/data/ with the same shape and re-run this script.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');

const DATA_DIR = path.join(__dirname, 'data');

function loadAllBatches() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const words = [];
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const w of batch) {
      words.push({ ...w, __source: file });
    }
  }
  return words;
}

async function seed() {
  const words = loadAllBatches();
  console.log(`Loaded ${words.length} words from seed/data/`);

  const [existingRows] = await pool.query('SELECT word, topic FROM vocabulary_words');
  const existingSet = new Set(existingRows.map((r) => `${r.word.toLowerCase()}::${r.topic}`));

  let inserted = 0;
  let skipped = 0;

  for (const w of words) {
    const key = `${w.word.toLowerCase()}::${w.topic}`;
    if (existingSet.has(key)) {
      skipped += 1;
      continue;
    }

    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO vocabulary_words
          (id, word, phonetic, part_of_speech, meaning, meaning_vi, example_text, example_vi, level, topic, difficulty, synonyms, antonyms, word_family, collocations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          w.word,
          w.phonetic || null,
          w.partOfSpeech,
          w.meaning,
          w.meaningVi,
          w.example,
          w.exampleVi || null,
          w.level,
          w.topic,
          w.difficulty,
          JSON.stringify(w.synonyms || []),
          JSON.stringify(w.antonyms || []),
          JSON.stringify(w.wordFamily || []),
          JSON.stringify(w.collocations || []),
        ],
      );
      existingSet.add(key);
      inserted += 1;
    } catch (error) {
      console.error(`Failed to insert "${w.word}" (${w.__source}):`, error.message);
    }
  }

  console.log(`Done. Inserted: ${inserted}, Skipped (already existed): ${skipped}`);
  await pool.end();
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
