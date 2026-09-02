import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import formRoutes from './routes/forms';
import submissionRoutes from './routes/submissions';
import userRoutes from './routes/users';
import assignmentRoutes from './routes/assignments';
import exportRoutes from './routes/exports';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// TEMPORARY diagnostic — logs every request that reaches Express, before any route runs
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} — body:`, JSON.stringify(req.body));
  next();
});

app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/forms', formRoutes);
app.use('/submissions', submissionRoutes);
app.use('/users', userRoutes);
app.use('/assignments', assignmentRoutes);
app.use('/exports', exportRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ db_time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

import { requireAuth, AuthRequest } from './middleware/auth';

app.get('/protected-test', requireAuth, (req: AuthRequest, res) => {
  res.json({ message: 'You are authenticated', user: req.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});