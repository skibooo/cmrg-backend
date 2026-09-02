import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Resend } from 'resend';
import { pool } from '../db';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);
console.log('RESEND_API_KEY loaded:', process.env.RESEND_API_KEY ? `${process.env.RESEND_API_KEY.slice(0, 6)}...` : 'MISSING');

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, org_id } = req.body;
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (org_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
      [org_id, name, email, password_hash, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    // TEMPORARY diagnostic — remove once mobile login is confirmed working
    console.log('Login attempt:', JSON.stringify({ email, passwordLength: password.length }));

    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, role: user.role, org_id: user.org_id },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    const user = result.rows[0];

    // Always respond the same way whether or not the account exists —
    // this prevents someone from using this endpoint to check which
    // emails are registered in the system.
    if (!user) {
      return res.json({ message: 'A reset link has been sent to your email.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

        const emailResult = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: 'Reset your CMRG password',
      html: `
        <p>Hi ${user.name || ''},</p>
        <p>Click the link below to reset your CMRG Data App password. This link expires in 1 hour.</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
    console.log('Resend response:', JSON.stringify(emailResult));

    res.json({ message: 'A reset link has been sent to your email.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [password_hash, user.id]
    );

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;