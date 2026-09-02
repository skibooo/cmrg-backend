import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { form_id, enumerator_id } = req.body;
    const result = await pool.query(
      'INSERT INTO assignments (form_id, enumerator_id) VALUES ($1, $2) RETURNING *',
      [form_id, enumerator_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT * FROM assignments ORDER BY assigned_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

export default router;