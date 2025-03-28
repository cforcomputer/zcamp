// tokenManager.js
export async function getValidAccessToken(forceRefresh = false) {
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
    if (
      forceRefresh ||
      (data.user.token_expiry && now >= data.user.token_expiry - 60)
    ) {
      console.log("Token expiring soon, refreshing...");

      // Add retry mechanism
      let retryCount = 3;
      let lastError = null;

      while (retryCount > 0) {
        try {
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
              // This is a permanent error - the session truly expired
              window.dispatchEvent(new CustomEvent("session-expired"));
              throw new Error("Session expired");
            }
            throw new Error(
              `Failed to refresh token: ${refreshResponse.status}`
            );
          }

          const refreshData = await refreshResponse.json();
          return refreshData.access_token;
        } catch (refreshError) {
          console.error(
            `Token refresh attempt failed (${retryCount} remaining):`,
            refreshError
          );
          lastError = refreshError;
          retryCount--;

          // If this was a session expired error, don't retry
          if (refreshError.message === "Session expired") {
            break;
          }

          // Wait a bit before retrying
          if (retryCount > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      // All retries failed
      if (lastError && lastError.message === "Session expired") {
        // We already dispatched the event
        throw lastError;
      } else if (lastError) {
        // This could be a temporary error, so we'll just try using the current token
        console.warn(
          "Failed to refresh token after multiple attempts, using existing token"
        );
        // Only trigger session expired if we're sure it's completely invalid
        if (now >= data.user.token_expiry) {
          window.dispatchEvent(new CustomEvent("session-expired"));
          throw new Error("Access token expired and refresh failed");
        }
        return data.user.access_token;
      }
    }

    return data.user.access_token;
  } catch (error) {
    console.error("Token error:", error);

    // Only dispatch session expired for certain errors
    if (
      error.message.includes("session") ||
      error.message.includes("Session expired") ||
      error.message.includes("Access token expired")
    ) {
      window.dispatchEvent(new CustomEvent("session-expired"));
    }

    throw error;
  }
}

// Also update the callEsiApi function to handle token refreshes
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
