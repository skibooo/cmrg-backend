import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Create a form under a project
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { project_id, name, question_schema } = req.body;
    const result = await pool.query(
      'INSERT INTO forms (project_id, name, question_schema) VALUES ($1, $2, $3) RETURNING *',
      [project_id, name, JSON.stringify(question_schema || [])]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// List forms, optionally filtered by project
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { project_id } = req.query;
    const result = project_id
      ? await pool.query('SELECT * FROM forms WHERE project_id = $1 ORDER BY created_at DESC', [project_id])
      : await pool.query('SELECT * FROM forms ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
});

// Update an existing form's name/questions
router.put('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, question_schema } = req.body;
    const result = await pool.query(
      'UPDATE forms SET name = $1, question_schema = $2 WHERE id = $3 RETURNING *',
      [name, JSON.stringify(question_schema || []), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

export default router;