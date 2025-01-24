<script>
  import { createEventDispatcher } from "svelte";
  import { onMount } from "svelte";

  let username = "";
  let password = "";
  let error = "";
  let successMessage = "";

  // SSO Configuration
  const EVE_SSO_URL = "https://login.eveonline.com/v2/oauth/authorize/";
  const CALLBACK_URL = "http://localhost:3000/callback/";
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
      error = "";
      handleSubmit();
    } else {
      error = data.message;
      successMessage = "";
    }
  }

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

<div class="login-modal">
  <div class="login-content">
    <h2 class="text-2xl font-bold text-eve-accent mb-6">Login to ZCamp</h2>

    <form on:submit|preventDefault={handleSubmit} class="space-y-4">
      <div class="form-group">
        <input
          type="text"
          bind:value={username}
          placeholder="Username"
          class="w-full px-4 py-2 bg-eve-secondary border border-eve-accent/20 rounded-md text-white placeholder-gray-400 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
          required
        />
      </div>

      <div class="form-group">
        <input
          type="password"
          bind:value={password}
          placeholder="Password"
          class="w-full px-4 py-2 bg-eve-secondary border border-eve-accent/20 rounded-md text-white placeholder-gray-400 focus:border-eve-accent focus:ring-1 focus:ring-eve-accent outline-none"
          required
        />
      </div>

      <div class="flex gap-4">
        <button
          type="submit"
          class="flex-1 px-4 py-2 bg-eve-accent/20 hover:bg-eve-accent/30 text-eve-accent rounded-md transition-colors duration-200"
        >
          Login
        </button>
        <button
          type="button"
          on:click={handleRegister}
          class="flex-1 px-4 py-2 bg-eve-accent/20 hover:bg-eve-accent/30 text-eve-accent rounded-md transition-colors duration-200"
        >
          Register
        </button>
      </div>
    </form>

    <div class="relative my-8">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t border-eve-accent/20"></div>
      </div>
      <div class="relative flex justify-center text-sm">
        <span class="px-2 bg-eve-dark text-gray-400">or</span>
      </div>
    </div>

    <button
      class="w-full flex justify-center items-center hover:opacity-90 transition-opacity"
      on:click={handleEveLogin}
    >
      <img
        src="/eve-sso-login-b.png"
        alt="Log in with EVE Online"
        width="270"
        height="45"
        class="max-w-full"
      />
    </button>

    {#if error}
      <p class="mt-4 text-eve-danger text-center">{error}</p>
    {/if}

    {#if successMessage}
      <p class="mt-4 text-green-400 text-center">{successMessage}</p>
    {/if}
  </div>
</div>

<style>
  .login-modal {
    @apply w-full max-w-md mx-auto;
  }

  .login-content {
    @apply bg-eve-dark border border-eve-accent/20 rounded-lg shadow-xl p-8;
  }

  :global(body) {
    @apply antialiased;
  }

  .form-group {
    @apply relative;
  }

  input::placeholder {
    @apply text-gray-500;
  }

  button:disabled {
    @apply opacity-50 cursor-not-allowed;
  }

  button:focus {
    @apply outline-none ring-2 ring-eve-accent ring-opacity-50;
  }
</style>
