<script>
  import { createEventDispatcher } from 'svelte';

  let username = '';
  let password = '';
  let error = '';
  let successMessage = '';

  const dispatch = createEventDispatcher();

  async function handleSubmit() {
      const response = await fetch('/api/login', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
          dispatch('login', { username });
          successMessage = 'Login successful!';
          error = ''; // Clear any previous errors
      } else {
          error = data.message;
          successMessage = ''; // Clear any previous success messages
      }
  }

  async function handleRegister() {
      const response = await fetch('/api/register', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
          successMessage = 'Registration successful! Logging in...';
          error = ''; // Clear any previous errors
          handleSubmit(); // Automatically log in after registration
      } else {
          error = data.message;
          successMessage = ''; // Clear any previous success messages
      }
  }
</script>

<div>
  <h2>Login</h2>
  <form on:submit|preventDefault={handleSubmit}>
      <input type="text" bind:value={username} placeholder="Username" required>
      <input type="password" bind:value={password} placeholder="Password" required>
      <button type="submit">Login</button>
      <button type="button" on:click={handleRegister}>Register</button>
  </form>
  {#if error}
      <p class="error">{error}</p>
  {/if}
  {#if successMessage}
      <p class="success">{successMessage}</p>
  {/if}
</div>

<style>
  div {
      max-width: 300px;
      margin: 0 auto;
  }

  input {
      display: block;
      width: 100%;
      margin-bottom: 10px;
      padding: 5px;
  }

  button {
      margin-right: 10px;
  }

  .error {
      color: red;
  }

  .success {
      color: green;
  }
</style>
