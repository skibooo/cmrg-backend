import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Create a submission with answers
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  try {
    const { form_id, gps_lat, gps_lng, answers, media } = req.body;
    const enumerator_id = req.user?.id;

    await client.query('BEGIN');

    const subResult = await client.query(
      'INSERT INTO submissions (form_id, enumerator_id, status, gps_lat, gps_lng) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [form_id, enumerator_id, 'synced', gps_lat || null, gps_lng || null]
    );
    const submission = subResult.rows[0];

        if (Array.isArray(answers)) {
      for (const a of answers) {
        await client.query(
          'INSERT INTO submission_answers (submission_id, question_key, answer_value) VALUES ($1, $2, $3)',
          [submission.id, a.question_key, a.answer_value]
        );
      }
    }

    if (Array.isArray(media)) {
      for (const m of media) {
        await client.query(
          'INSERT INTO submission_media (submission_id, question_key, media_type, file_data) VALUES ($1, $2, $3, $4)',
          [submission.id, m.question_key, m.media_type, m.file_data]
        );
      }
    }

    await client.query('COMMIT');
    
    res.json(submission);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save submission' });
  } finally {
    client.release();
  }
});

// List submissions, optionally filtered by form
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { form_id } = req.query;
    const result = form_id
      ? await pool.query('SELECT * FROM submissions WHERE form_id = $1 ORDER BY submitted_at DESC', [form_id])
      : await pool.query('SELECT * FROM submissions ORDER BY submitted_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

export default router;