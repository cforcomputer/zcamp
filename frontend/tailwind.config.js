/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        surface: {
          0: "#0a0a0f",
          1: "#12121a",
          2: "#1a1a26",
          3: "#222233",
        },
        accent: {
          red: "#ff4444",
          orange: "#ff8844",
          yellow: "#ffcc33",
          green: "#44cc66",
          blue: "#4488ff",
          purple: "#8844ff",
        },
      },
      keyframes: {
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "slide-in": "slide-in 0.3s ease-out",
      },
    },
  },
  plugins: [],
};