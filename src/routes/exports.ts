import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const router = Router();

router.get('/submissions.csv', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, f.name as form_name, s.status, s.gps_lat, s.gps_lng, s.submitted_at
      FROM submissions s
      LEFT JOIN forms f ON s.form_id = f.id
      ORDER BY s.submitted_at DESC
    `);

    const headers = 'ID,Form,Status,GPS Lat,GPS Lng,Submitted At\n';
    const rows = result.rows.map(r =>
      `${r.id},"${r.form_name || ''}",${r.status},${r.gps_lat || ''},${r.gps_lng || ''},${r.submitted_at.toISOString()}`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');
    res.send(headers + rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/submissions.sav', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, f.name as form_name, s.status, s.gps_lat, s.gps_lng, s.submitted_at
      FROM submissions s
      LEFT JOIN forms f ON s.form_id = f.id
      ORDER BY s.submitted_at DESC
    `);

    // pyreadstat needs plain strings/numbers, not JS Date objects or nulls
    // in odd places — normalize each row before handing off to Python.
    const records = result.rows.map(r => ({
      id: r.id,
      form_name: r.form_name || '',
      status: r.status || '',
      gps_lat: r.gps_lat ?? '',
      gps_lng: r.gps_lng ?? '',
      submitted_at: r.submitted_at ? r.submitted_at.toISOString() : '',
    }));

    const tempFilePath = path.join(os.tmpdir(), `submissions_${Date.now()}.sav`);
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'export_spss.py');

    const python = spawn('python', [scriptPath, JSON.stringify(records), tempFilePath]);

    let stderr = '';
    python.stderr.on('data', (data) => { stderr += data.toString(); });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('SPSS export script failed:', stderr);
        return res.status(500).json({ error: 'SPSS export failed' });
      }

      res.download(tempFilePath, 'submissions.sav', (err) => {
        // Clean up the temp file after sending it, whether it succeeded or not
        fs.unlink(tempFilePath, () => {});
        if (err) console.error('Error sending SPSS file:', err);
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;