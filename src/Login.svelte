<!-- Login.svelte -->
<script>
  import { createEventDispatcher } from "svelte";
  import { onMount } from "svelte";

  let username = "";
  let password = "";
  let error = "";
  let successMessage = "";

  // SSO Configuration
  const EVE_SSO_URL = "https://login.eveonline.com/v2/oauth/authorize/";
  const CALLBACK_URL = "http://localhost:3000/callback/"; // Updated to match server port
  const SCOPES = [
    "publicData",
    "esi-location.read_location.v1",
    "esi-bookmarks.read_character_bookmarks.v1",
    "esi-fleets.read_fleet.v1",
    "esi-ui.write_waypoint.v1",
  ];

  const dispatch = createEventDispatcher();

  onMount(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("authenticated") === "true") {
      dispatch("login", { type: "eve" });
      successMessage = "Successfully logged in with EVE Online!";
      window.history.replaceState({}, document.title, "/");
    } else if (params.get("login") === "error") {
      const reason = params.get("reason");
      error = getErrorMessage(reason);
      window.history.replaceState({}, document.title, "/");
    }
  });

  function getErrorMessage(reason) {
    switch (reason) {
      case "invalid_state":
        return "Invalid authentication state";
      case "invalid_token":
        return "Invalid EVE Online token";
      case "invalid_character":
        return "Unable to get character data";
      case "database_error":
        return "Database error occurred";
      case "session_error":
        return "Session error occurred";
      case "sso_error":
        return "EVE SSO authentication failed";
      default:
        return "Failed to login with EVE Online";
    }
  }

  async function handleSubmit() {
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      const data = await response.json();

      if (data.success) {
        dispatch("login", { type: "credentials", username });
        successMessage = "Login successful!";
        error = "";
      } else {
        error = data.message;
        successMessage = "";
      }
    } catch (err) {
      error = "Login failed";
      console.error("Login error:", err);
    }
  }

  async function handleRegister() {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (data.success) {
      successMessage = "Registration successful! Logging in...";
      error = ""; // Clear any previous errors
      handleSubmit(); // Automatically log in after registration
    } else {
      error = data.message;
      successMessage = ""; // Clear any previous success messages
    }
  }

  // Get client ID from server
  async function handleEveLogin() {
    try {
      const response = await fetch("/api/eve-sso-config");
      const { clientId, callbackUrl } = await response.json();

      const state = Math.random().toString(36).substring(2);

      await fetch("/api/eve-sso/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ state }),
      });

      const params = new URLSearchParams({
        response_type: "code",
        redirect_uri: callbackUrl || CALLBACK_URL,
        client_id: clientId,
        scope: SCOPES.join(" "),
        state: state,
      });

      window.location.href = `${EVE_SSO_URL}?${params.toString()}`;
    } catch (err) {
      error = "Failed to initialize EVE login";
      console.error("EVE login error:", err);
    }
  }
</script>

<div class="login-container">
  <h2>Login</h2>

  <!-- Regular login form -->
  <form on:submit|preventDefault={handleSubmit}>
    <div class="form-group">
      <input
        type="text"
        bind:value={username}
        placeholder="Username"
        required
      />
    </div>
    <div class="form-group">
      <input
        type="password"
        bind:value={password}
        placeholder="Password"
        required
      />
    </div>
    <div class="button-group">
      <button type="submit">Login</button>
      <button type="button" on:click={handleRegister}>Register</button>
    </div>
  </form>

  <div class="divider">
    <span>or</span>
  </div>

  <!-- EVE Online SSO Login -->
  <button class="eve-login-btn" on:click={handleEveLogin}>
    <img
      src="/eve-sso-login-b.png"
      alt="Log in with EVE Online"
      width="270"
      height="45"
    />
  </button>

  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if successMessage}
    <p class="success">{successMessage}</p>
  {/if}
</div>

<style>
  .login-container {
    max-width: 400px;
    margin: 2rem auto;
    padding: 2rem;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 8px;
    color: white;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #444;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  input:focus {
    outline: none;
    border-color: #007bff;
  }

  .button-group {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
  }

  button {
    flex: 1;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #007bff;
    color: white;
    transition: background-color 0.2s;
  }

  button:hover {
    background: #0056b3;
  }

  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 2rem 0;
  }

  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid #444;
  }

  .divider span {
    padding: 0 1rem;
    color: #888;
  }

  .eve-login-btn {
    width: 100%;
    background: none;
    padding: 0;
    display: flex;
    justify-content: center;
  }

  .eve-login-btn:hover {
    opacity: 0.9;
  }

  .error {
    color: #ff4444;
    margin-top: 1rem;
    text-align: center;
  }

  .success {
    color: #00ff00;
    margin-top: 1rem;
    text-align: center;
  }
</style>
