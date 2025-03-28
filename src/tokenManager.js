// tokenManager.js
export async function getValidAccessToken() {
  try {
    // Get current session data
    const response = await fetch("/api/session", {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to get session data");
    }

    const data = await response.json();

    if (!data.user?.access_token) {
      throw new Error("No access token found");
    }

    // Check if token needs refresh
    const now = Math.floor(Date.now() / 1000);
    if (data.user.token_expiry && now >= data.user.token_expiry - 60) {
      console.log("Token expiring soon, refreshing...");
      const refreshResponse = await fetch("/api/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ refresh_token: data.user.refresh_token }),
      });

      if (!refreshResponse.ok) {
        const errorData = await refreshResponse.json();
        if (errorData.sessionExpired) {
          window.dispatchEvent(new CustomEvent("session-expired"));
        }
        throw new Error("Failed to refresh token");
      }

      const refreshData = await refreshResponse.json();
      return refreshData.access_token;
    }

    return data.user.access_token;
  } catch (error) {
    console.error("Token error:", error);
    window.dispatchEvent(new CustomEvent("session-expired"));
    throw error;
  }
}

// Utility function for ESI API calls
export async function callEsiApi(endpoint, method = "GET", body = null) {
  try {
    const accessToken = await getValidAccessToken();

    const options = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    };

    if (body && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(
      `https://esi.evetech.net/latest/${endpoint}`,
      options
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Token might have just expired, try once more with a forced refresh
        const newToken = await getValidAccessToken(true);
        options.headers.Authorization = `Bearer ${newToken}`;
        const retryResponse = await fetch(
          `https://esi.evetech.net/latest/${endpoint}`,
          options
        );
        if (!retryResponse.ok) {
          throw new Error(`ESI API error: ${retryResponse.status}`);
        }
        return await retryResponse.json();
      }
      throw new Error(`ESI API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("ESI API call failed:", error);
    throw error;
  }
}
