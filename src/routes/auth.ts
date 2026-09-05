// ==============================
// ZOHO LOGIN
// ==============================

router.get('/zoho/login', (req, res) => {
  try {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const redirectUri = process.env.ZOHO_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      console.error('Missing Zoho environment variables');
      return res.status(500).json({
        error: 'Zoho authentication is not configured',
      });
    }

    const params = new URLSearchParams({
      scope: 'zohoprofile.userinfo.read',
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      access_type: 'online',
    });

    const zohoAuthUrl =
      `https://accounts.zoho.com/oauth/v2/auth?${params.toString()}`;

    console.log('Redirecting to Zoho OAuth');

    return res.redirect(zohoAuthUrl);
  } catch (error) {
    console.error('Zoho login error:', error);

    return res.status(500).json({
      error: 'Unable to start Zoho authentication',
    });
  }
});


// ==============================
// ZOHO CALLBACK
// ==============================

router.get('/zoho/callback', async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    const frontendUrl = process.env.FRONTEND_URL;
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const redirectUri = process.env.ZOHO_REDIRECT_URI;
    const jwtSecret = process.env.JWT_SECRET;

    // --------------------------------
    // Validate environment variables
    // --------------------------------

    if (
      !frontendUrl ||
      !clientId ||
      !clientSecret ||
      !redirectUri ||
      !jwtSecret
    ) {
      console.error('Missing required authentication environment variables');

      return res.redirect(
        `${frontendUrl || 'https://cmrg-frontend.vercel.app'}/login?error=zoho_config`
      );
    }

    // --------------------------------
    // User cancelled/denied Zoho login
    // --------------------------------

    if (error) {
      console.error('Zoho authorization error:', error);

      return res.redirect(
        `${frontendUrl}/login?error=zoho_denied`
      );
    }

    // --------------------------------
    // Make sure authorization code exists
    // --------------------------------

    if (!code) {
      console.error('No Zoho authorization code received');

      return res.redirect(
        `${frontendUrl}/login?error=zoho_denied`
      );
    }

    // --------------------------------
    // Exchange authorization code
    // for Zoho access token
    // --------------------------------

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    const tokenRes = await fetch(
      'https://accounts.zoho.com/oauth/v2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenParams.toString(),
      }
    );

    const tokenData = await tokenRes.json();

    console.log('Zoho token response:', {
      success: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      error: tokenData.error,
    });

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error(
        'Zoho token exchange failed:',
        tokenData
      );

      return res.redirect(
        `${frontendUrl}/login?error=zoho_failed`
      );
    }

    // --------------------------------
    // Get Zoho user profile
    // --------------------------------

    const profileRes = await fetch(
      'https://profile.zoho.com/api/v1/user/self/profile',
      {
        method: 'GET',
        headers: {
          Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
        },
      }
    );

    const profile = await profileRes.json();

    console.log('Zoho profile response:', profile);

    if (!profileRes.ok) {
      console.error(
        'Failed to retrieve Zoho profile:',
        profile
      );

      return res.redirect(
        `${frontendUrl}/login?error=zoho_profile_failed`
      );
    }

    // --------------------------------
    // Extract email
    // --------------------------------

    const email = (
      profile.email ||
      profile.Email ||
      profile.email_id ||
      profile.EmailID ||
      ''
    )
      .trim()
      .toLowerCase();

    console.log('Zoho account email:', email);

    if (!email) {
      console.error(
        'Zoho profile did not contain an email address'
      );

      return res.redirect(
        `${frontendUrl}/login?error=zoho_no_email`
      );
    }

    // --------------------------------
    // Find user in CMRG database
    // --------------------------------

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE LOWER(email) = $1
      LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];

    console.log(
      'CMRG user found:',
      !!user
    );

    // --------------------------------
    // Zoho account must already exist
    // in CMRG
    // --------------------------------

    if (!user) {
      console.error(
        `No CMRG account found for Zoho email: ${email}`
      );

      return res.redirect(
        `${frontendUrl}/login?error=zoho_no_account`
      );
    }

    // --------------------------------
    // Admin-only protection
    // --------------------------------

    if (user.role !== 'admin') {
      console.error(
        `Non-admin attempted web login through Zoho: ${email}`
      );

      return res.redirect(
        `${frontendUrl}/login?error=enumerator_web`
      );
    }

    // --------------------------------
    // Create CMRG JWT
    // --------------------------------

    const jwtToken = jwt.sign(
      {
        id: user.id,
        role: user.role,
        org_id: user.org_id,
      },
      jwtSecret,
      {
        expiresIn: '7d',
      }
    );

    console.log(
      `Zoho login successful for: ${email}`
    );

    // --------------------------------
    // Send user back to frontend
    // --------------------------------

    return res.redirect(
      `${frontendUrl}/zoho-callback?token=${encodeURIComponent(jwtToken)}`
    );

  } catch (error) {
    console.error(
      'Zoho callback error:',
      error
    );

    const frontendUrl =
      process.env.FRONTEND_URL ||
      'https://cmrg-frontend.vercel.app';

    return res.redirect(
      `${frontendUrl}/login?error=zoho_failed`
    );
  }
});