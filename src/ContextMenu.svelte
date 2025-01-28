<!-- ContextMenu.svelte -->
<script>
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher();

  export let x = 0;
  export let y = 0;
  export let show = false;
  export let options = [];

  function handleClick(option) {
    dispatch("select", option);
    show = false;
  }

  function handleClickOutside(event) {
    if (show && !event.target.closest(".context-menu")) {
      show = false;
    }
  }

  $: if (show) {
    document.addEventListener("click", handleClickOutside);
  } else {
    document.removeEventListener("click", handleClickOutside);
  }
</script>

{#if show}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="context-menu"
    style="left: {x}px; top: {y}px;"
    on:contextmenu|preventDefault
  >
    {#each options as option}
      <button
        class="menu-item"
        on:click|stopPropagation={() => handleClick(option)}
      >
        {option.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: absolute; /* Changed from fixed to absolute */
    background: rgba(40, 40, 40);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 120px;
    z-index: 9999;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: none;
    border: none;
    color: white;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }
</style>
