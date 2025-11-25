const backendUrl = 'https://stream-analytics-extension.onrender.com'; // Replace with your actual backend Render URL

document.addEventListener('DOMContentLoaded', () => {
  const authBtn = document.getElementById('auth-btn');
  const authStatus = document.getElementById('auth-status');
  const overviewSection = document.getElementById('overview-section');
  const streamStats = document.getElementById('stream-stats');
  const refreshBtn = document.getElementById('refresh-btn');

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
    chrome.identity.launchWebAuthFlow({
      url: `${backendUrl}/auth/callback`,
      interactive: true
    }, (redirectUrl) => {
      if (redirectUrl) {
        // Extract userId from successful auth (simulate with backend API call)
        fetch(`${backendUrl}/api/user`, {
          headers: {
            'Authorization': `Bearer ${getAccessTokenFromRedirect(redirectUrl)}`
          }
        })
        .then(resp => resp.json())
        .then(data => {
          chrome.storage.local.set({ userId: data.id });
          authSection.style.display = 'none';
          overviewSection.style.display = '';
          fetchAnalytics(data.id);
        });
        authStatus.textContent = "Authenticated!";
      } else {
        authStatus.textContent = "Authorization failed!";
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

  function getAccessTokenFromRedirect(redirectUrl) {
    // TODO: Parse access_token from redirectUrl (depends on your server implementation)
    // For initial prototype, you can hardcode or update as you connect flows.
    return "";
  }
});
