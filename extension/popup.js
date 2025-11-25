const backendUrl = 'https://stream-analytics-extension.onrender.com';
// 👇 Only edit this line to put your Twitch Client ID from dev console
const clientId = '4g69lpny10og91bhgsryaz2w71qnrl'; // <-- REPLACE THIS ONLY

const redirectUri = `${backendUrl}/auth/callback`;

document.addEventListener('DOMContentLoaded', () => {
  const authBtn = document.getElementById('auth-btn');
  const authStatus = document.getElementById('auth-status');
  const overviewSection = document.getElementById('overview-section');
  const streamStats = document.getElementById('stream-stats');
  const refreshBtn = document.getElementById('refresh-btn');
  const authSection = document.getElementById('auth-section');

  // Check if user already authorized
  chrome.storage.local.get(['userId'], (result) => {
    if (result.userId) {
      authSection.style.display = 'none';
      overviewSection.style.display = '';
      fetchAnalytics(result.userId);
    }
  });

  // Auth button action
  authBtn.onclick = () => {
    console.log("Auth button clicked");
    const twitchAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=channel:read:subscriptions user:read:email`;

    chrome.identity.launchWebAuthFlow({
      url: twitchAuthUrl,
      interactive: true
    }, (redirectUrl) => {
      console.log("OAuth redirect result:", redirectUrl);
      if (redirectUrl) {
        authStatus.textContent = "Authenticated!";
        // You can fetch user info or analytics after auth here
        // Example: Call backend to store/fetch user data
      } else {
        authStatus.textContent = "Authorization failed!";
        console.log("OAuth failed or user cancelled.");
      }
    });
  };

  refreshBtn.onclick = () => {
    chrome.storage.local.get(['userId'], (result) => {
      if (result.userId) fetchAnalytics(result.userId);
    });
  };

  function fetchAnalytics(userId) {
    fetch(`${backendUrl}/api/analytics/${userId}`)
      .then(resp => resp.json())
      .then(data => {
        if (data.lastStream) {
          const s = data.lastStream;
          streamStats.innerHTML = `
            <p><strong>Title:</strong> ${s.title}</p>
            <p><strong>Game:</strong> ${s.gameName}</p>
            <p><strong>Duration:</strong> ${s.duration?.toFixed(2)} hours</p>
            <p><strong>Peak Viewers:</strong> ${s.peakViewers}</p>
            <p><strong>Average Viewers:</strong> ${s.avgViewers}</p>
            <p><strong>Followers Gained:</strong> ${s.followersGained}</p>
            <p><strong>Subs Gained:</strong> ${s.subsGained}</p>
            <p><strong>Total Chats:</strong> ${s.chatCount}</p>
          `;
        } else {
          streamStats.innerHTML = "<p>No completed streams tracked yet.</p>";
        }
      });
  }
});
