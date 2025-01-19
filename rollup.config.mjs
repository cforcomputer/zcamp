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
  // Client-side bundle
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
        config: {
          path: "./postcss.config.cjs",
        },
        extensions: [".css"],
        extract: "bundle.css",
        minimize: production,
      }),

      resolve({
        browser: true,
        dedupe: ["svelte"],
        exportConditions: ["svelte", "browser", "import"],
      }),

      commonjs(),

      copy({
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

  // Server-side bundle
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
      commonjs(),
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
    ],
  },
];
