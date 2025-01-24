import "./app.css";
import App from "./App.svelte";

document.documentElement.style.visibility = "hidden";

window.addEventListener("DOMContentLoaded", () => {
  const styleSheets = Array.from(document.styleSheets);
  const loadPromises = styleSheets.map((sheet) => {
    if (sheet.href) {
      return new Promise((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        link.onload = resolve;
        document.head.appendChild(link);
      });
    }
    return Promise.resolve();
  });

  Promise.all(loadPromises).then(() => {
    document.documentElement.style.visibility = "visible";
    const app = new App({
      target: document.body,
    });
  });
});

export default app;
