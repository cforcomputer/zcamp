/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,js,svelte}"],
  theme: {
    extend: {
      colors: {
        "eve-primary": "#1A1A1A",
        "eve-secondary": "#2D2D2D",
        "eve-accent": "#00BFFF",
        "eve-danger": "#FF4444",
        "eve-success": "#44FF44",
        "eve-warning": "#FFAA00",
      },
      backgroundColor: {
        "eve-dark": "rgba(26, 26, 26, 0.95)",
        "eve-card": "rgba(35, 35, 35, 0.85)",
        "eve-overlay": "rgba(0, 0, 0, 0.75)",
      },
      backdropFilter: {
        eve: "blur(8px)",
      },
    },
  },
  plugins: [],
};
