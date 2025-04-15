// rollup.config.mjs
import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import copy from "rollup-plugin-copy";
import json from "@rollup/plugin-json";
import sveltePreprocess from "svelte-preprocess";
import postcss from "rollup-plugin-postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const production = !process.env.ROLLUP_WATCH;

export default [
  // Client-side bundle - no changes here
  {
    input: "src/main.js",
    output: {
      sourcemap: true,
      format: "iife",
      name: "app",
      file: "public/build/bundle.js",
    },
    plugins: [
      svelte({
        compilerOptions: {
          dev: !production,
        },
        preprocess: sveltePreprocess({
          postcss: {
            plugins: [tailwindcss, autoprefixer],
          },
        }),
      }),

      postcss({
        // This extracts CSS for the main bundle
        config: {
          path: "./postcss.config.cjs",
        },
        extensions: [".css"],
        extract: "bundle.css", // Main CSS output
        minimize: production,
      }),

      resolve({
        browser: true,
        dedupe: ["svelte"],
        exportConditions: ["svelte", "browser", "import"],
      }),

      commonjs(),

      copy({
        // Copy assets once during the main build
        targets: [
          {
            src: ["public/audio_files/*.wav", "public/audio_files/**/*.wav"],
            dest: "public/build/audio_files",
            flatten: true,
          },
        ],
        verbose: true,
        hook: "writeBundle",
        copyOnce: true,
      }),

      production && terser(),
    ],
  },

  // *** NEW CONFIGURATION FOR TROPHY PAGE ***
  {
    input: "src/trophy_main.js", // <--- Input for trophy page
    output: {
      sourcemap: true,
      format: "iife", // Use 'iife' for direct browser execution
      name: "trophyApp", // A different name for this bundle
      file: "public/build/trophy_bundle.js", // <--- Output for trophy page
    },
    plugins: [
      // Use similar plugins as the main client bundle
      svelte({
        compilerOptions: {
          dev: !production,
        },
        // Include preprocessing if TrophyPage.svelte uses Tailwind/SCSS etc.
        preprocess: sveltePreprocess({
          postcss: {
            plugins: [tailwindcss, autoprefixer],
          },
        }),
      }),
      // NOTE: We assume trophy.html also links to the main bundle.css.
      // If it needs its own separate CSS, add a postcss plugin here with extract: 'trophy_bundle.css'
      // Otherwise, the postcss processing happens via sveltePreprocess above.
      resolve({
        browser: true,
        dedupe: ["svelte"],
        exportConditions: ["svelte", "browser", "import"],
      }),
      commonjs(),
      production && terser(), // Minify in production
    ],
  },
  // *** END OF NEW TROPHY PAGE CONFIGURATION ***

  // Server-side bundle - no changes here
  {
    input: "./server/server.js",
    output: {
      sourcemap: "inline",
      format: "esm",
      name: "server",
      file: "build/server.js",
    },
    plugins: [
      json(),
      resolve({
        browser: false,
        dedupe: [],
        exportConditions: ["node"],
      }),
      commonjs({
        transformMixedEsModules: true,
        esmExternals: true,
      }),
      {
        name: "inject-globals",
        renderChunk(code) {
          return `import { fileURLToPath } from 'url';\nimport { dirname } from 'path';\nglobal.__filename = fileURLToPath(import.meta.url);\nglobal.__dirname = dirname(global.__filename);\n${code}`;
        },
      },
    ],
    external: [
      "express",
      "socket.io",
      "@libsql/client",
      "bcrypt",
      "connect-redis",
      "cors",
      "express-session",
      "http",
      "path",
      "redis",
      "url",
      "fs",
      "events",
      "zlib",
      "pg",
      "pg-native",
    ],
  },
];
