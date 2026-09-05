import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Resend } from 'resend';
import rateLimit from 'express-rate-limit';
import { pool } from '../db';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login attempts per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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

router.post('/login', loginLimiter as any, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

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

router.post('/forgot-password', loginLimiter as any, async (req, res) => {
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

    await resend.emails.send({
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

router.get('/zoho/login', (req, res) => {
  const params = new URLSearchParams({
    scope: 'AaaServer.profile.Read',
    client_id: process.env.ZOHO_CLIENT_ID as string,
    response_type: 'code',
    redirect_uri: process.env.ZOHO_REDIRECT_URI as string,
    access_type: 'online',
  });
  res.redirect(`https://accounts.zoho.com/oauth/v2/auth?${params.toString()}`);
});

router.get('/zoho/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=zoho_denied`);
    }

    // Exchange the authorization code for an access token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_CLIENT_ID as string,
      client_secret: process.env.ZOHO_CLIENT_SECRET as string,
      redirect_uri: process.env.ZOHO_REDIRECT_URI as string,
      code,
    });

    const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('Zoho token exchange failed:', tokenData);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=zoho_failed`);
    }

    // Use the access token to fetch the user's Zoho profile (name + email)
    const profileRes = await fetch('https://accounts.zoho.com/oauth/user/info', {
      headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const email = (profile.Email || '').trim().toLowerCase();

    if (!email) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=zoho_no_email`);
    }

    // Only log in users who already have a CMRG account with this email —
    // does NOT auto-create accounts, since self-registration policy is
    // still an open question with the client.
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=zoho_no_account`);
    }

    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, org_id: user.org_id },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.redirect(`${process.env.FRONTEND_URL}/zoho-callback?token=${jwtToken}`);
  } catch (err) {
    console.error('Zoho callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=zoho_failed`);
  }
});

export default router;