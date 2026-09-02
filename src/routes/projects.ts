import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Create a project
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name } = req.body;
    const org_id = req.user?.org_id;
    const result = await pool.query(
      'INSERT INTO projects (org_id, name) VALUES ($1, $2) RETURNING *',
      [org_id, name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// List all projects
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

export default router;