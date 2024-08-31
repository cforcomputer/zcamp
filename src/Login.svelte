<script>
    import { createEventDispatcher } from 'svelte';
  
    let username = '';
    let password = '';
    let error = '';
  
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
      } else {
        error = data.message;
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
        handleSubmit();
      } else {
        error = data.message;
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
  </style>