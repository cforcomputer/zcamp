import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import css from "rollup-plugin-css-only";
import { terser } from "rollup-plugin-terser";
import copy from "rollup-plugin-copy";

const production = !process.env.ROLLUP_WATCH;

export default {
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
      preprocess: require("svelte-preprocess")({
        postcss: true,
        sourceMap: production ? false : true,
      }),
    }),
    css({ output: "bundle.css" }),
    resolve({
      browser: true,
      dedupe: ["svelte"],
      exportConditions: ["import", "browser"],
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
};
