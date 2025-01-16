import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import css from "rollup-plugin-css-only";
import { terser } from "rollup-plugin-terser";
import copy from "rollup-plugin-copy";
import json from "@rollup/plugin-json";
import sveltePreprocess from "svelte-preprocess"; // Import correctly

const production = !process.env.ROLLUP_WATCH;

export default [
  // Client-side bundle
  {
    input: "src/main.js", // Client entry point
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
          // Use sveltePreprocess
          postcss: true,
          sourceMap: production ? false : true,
        }),
      }),
      css({ output: "bundle.css" }),
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
    input: "./server/server.js", // Server entry point
    output: {
      sourcemap: "inline",
      format: "esm", // Use CommonJS for Node.js
      name: "server",
      file: "build/server.js", // Output to a different directory
    },
    plugins: [
      json(),
      resolve({
        browser: false, // Important: Don't resolve browser-specific versions of modules
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
    ], // Treat these as external dependencies
  },
];
