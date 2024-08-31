import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import css from 'rollup-plugin-css-only';
import { terser } from 'rollup-plugin-terser';

const production = !process.env.ROLLUP_WATCH;

export default {
  input: 'src/main.js',
  output: {
    sourcemap: true,
    format: 'iife', // immediately-invoked function expression
    name: 'app',
    file: 'public/build/bundle.js',
    globals: {
      three: 'THREE',
      'three/examples/jsm/controls/OrbitControls': 'OrbitControls'
    }
  },
  external: [
    'three',
    'three/examples/jsm/controls/OrbitControls'
  ],
  plugins: [
    svelte({
      compilerOptions: {
        dev: !production
      },
      preprocess: require('svelte-preprocess')({
        postcss: true
      })
    }),
    css({ output: 'public/build/bundle.css' }),
    resolve({
      browser: true,
      dedupe: ['svelte']
    }),
    commonjs(),
    production && terser()
  ]
};
