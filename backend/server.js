const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (in production, use a database)
const streamSessions = new Map(); // channelId -> array of stream sessions
const activeStreams = new Map(); // channelId -> current stream data
const userTokens = new Map(); // userId -> access token info

// Helper: Get Twitch API headers
function getTwitchHeaders(accessToken) {
  return {
    'Client-ID': process.env.TWITCH_CLIENT_ID,
    'Authorization': `Bearer ${accessToken}`
  };
}

// Helper: Get app access token (for non-user-specific API calls)
async function getAppAccessToken() {
  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials'
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting app access token:', error.response?.data || error.message);
    throw error;
  }
}

// Route: OAuth callback (after user authorizes)
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.BACKEND_URL}/auth/callback`
      }
    });

    const { access_token, refresh_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: getTwitchHeaders(access_token)
    });

    const user = userResponse.data.data[0];

    // Store token info
    userTokens.set(user.id, {
      accessToken: access_token,
      refreshToken: refresh_token,
      userId: user.id,
      username: user.login,
      displayName: user.display_name
    });

    // Initialize stream sessions for this user
    if (!streamSessions.has(user.id)) {
      streamSessions.set(user.id, []);
    }

    // Start monitoring this channel
    startMonitoringChannel(user.id, access_token);

    // Redirect to success page
    res.send(`
  <html>
    <body>
      <h1>✅ Authorization Successful!</h1>
      <p>You can now close this window and return to the extension.</p>
      <script>
        window.location = "${process.env.BACKEND_URL}/auth/success?userId=${encodeURIComponent(user.id)}";
      </script>
    </body>
  </html>
`);

  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.status(500).send('Authorization failed');
  }
});

// Route: Get analytics for a user
app.get('/api/analytics/:userId', (req, res) => {
  const userId = req.params.userId;
  const sessions = streamSessions.get(userId) || [];
  
  // Get the most recent completed stream
  const lastStream = sessions[sessions.length - 1];
  
  res.json({
    lastStream: lastStream || null,
    totalStreams: sessions.length,
    allSessions: sessions
  });
});

// Route: Check if user is authorized
app.get('/api/check-auth/:userId', (req, res) => {
  const userId = req.params.userId;
  const hasAuth = userTokens.has(userId);
  
  res.json({ authorized: hasAuth });
});

// Route: Get current user info from token
app.get('/api/user', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: getTwitchHeaders(token)
    });

    res.json(userResponse.data.data[0]);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Background monitoring function
async function startMonitoringChannel(userId, accessToken) {
  console.log(`Started monitoring channel: ${userId}`);

  // Check stream status every 2 minutes
  const checkInterval = setInterval(async () => {
    try {
      const tokenInfo = userTokens.get(userId);
      if (!tokenInfo) {
        clearInterval(checkInterval);
        return;
      }

      // Get stream info
      const streamResponse = await axios.get('https://api.twitch.tv/helix/streams', {
        params: { user_id: userId },
        headers: getTwitchHeaders(tokenInfo.accessToken)
      });

      const streamData = streamResponse.data.data[0];

      if (streamData) {
        // Stream is live
        if (!activeStreams.has(userId)) {
          // Stream just started
          const newSession = {
            streamId: streamData.id,
            startTime: new Date(streamData.started_at),
            startViewers: streamData.viewer_count,
            peakViewers: streamData.viewer_count,
            totalViewerChecks: 1,
            viewerSum: streamData.viewer_count,
            subsGained: 0,
            followersGained: 0,
            chatCount: 0,
            gameName: streamData.game_name,
            title: streamData.title
          };

          activeStreams.set(userId, newSession);
          console.log(`Stream started for ${userId}: ${streamData.title}`);

          // Get baseline follower count
          const followersResponse = await axios.get('https://api.twitch.tv/helix/channels/followers', {
            params: { broadcaster_id: userId },
            headers: getTwitchHeaders(tokenInfo.accessToken)
          });
          newSession.startFollowers = followersResponse.data.total;

          // Get baseline sub count
          const subsResponse = await axios.get('https://api.twitch.tv/helix/subscriptions', {
            params: { broadcaster_id: userId },
            headers: getTwitchHeaders(tokenInfo.accessToken)
          });
          newSession.startSubs = subsResponse.data.total || 0;
        } else {
          // Stream ongoing, update metrics
          const session = activeStreams.get(userId);
          session.totalViewerChecks++;
          session.viewerSum += streamData.viewer_count;
          session.peakViewers = Math.max(session.peakViewers, streamData.viewer_count);
        }
      } else {
        // Stream is offline
        if (activeStreams.has(userId)) {
          // Stream just ended
          const session = activeStreams.get(userId);
          session.endTime = new Date();
          session.duration = (session.endTime - session.startTime) / 1000 / 60 / 60; // hours
          session.avgViewers = Math.round(session.viewerSum / session.totalViewerChecks);

          // Get final follower count
          const followersResponse = await axios.get('https://api.twitch.tv/helix/channels/followers', {
            params: { broadcaster_id: userId },
            headers: getTwitchHeaders(tokenInfo.accessToken)
          });
          session.endFollowers = followersResponse.data.total;
          session.followersGained = session.endFollowers - session.startFollowers;

          // Get final sub count
          const subsResponse = await axios.get('https://api.twitch.tv/helix/subscriptions', {
            params: { broadcaster_id: userId },
            headers: getTwitchHeaders(tokenInfo.accessToken)
          });
          session.endSubs = subsResponse.data.total || 0;
          session.subsGained = session.endSubs - session.startSubs;

          // Save completed session
          const sessions = streamSessions.get(userId);
          sessions.push(session);
          activeStreams.delete(userId);

          console.log(`Stream ended for ${userId}. Duration: ${session.duration.toFixed(2)}h, Followers gained: ${session.followersGained}`);
        }
      }
    } catch (error) {
      console.error(`Error monitoring channel ${userId}:`, error.response?.data || error.message);
    }
  }, 120000); // Check every 2 minutes
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    activeChannels: activeStreams.size,
    totalUsers: userTokens.size
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`OAuth callback: ${process.env.BACKEND_URL}/auth/callback`);
});
