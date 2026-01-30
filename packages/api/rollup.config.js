// rollup.config.js
import { readFileSync } from 'fs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
// Use rollup-plugin-typescript2 which supports check: false to skip type checking
// This significantly reduces memory usage when processing large dependencies like @aipyq/agents
import typescript from 'rollup-plugin-typescript2';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Check if we're in development mode
 */
const isDevelopment = process.env.NODE_ENV === 'development';

const plugins = [
  peerDepsExternal(),
  resolve({
    preferBuiltins: true,
    skipSelf: true,
  }),
  replace({
    __IS_DEV__: isDevelopment,
    preventAssignment: true,
  }),
  commonjs({
    transformMixedEsModules: true,
    requireReturnsDefault: 'auto',
  }),
  typescript({
    tsconfig: './tsconfig.build.json',
    useTsconfigDeclarationDir: true,
    /**
     * Skip type checking to reduce memory usage when processing large dependencies
     * Types are validated at compile time, this only affects rollup bundling
     */
    check: false,
    /**
     * Exclude node_modules from processing to reduce memory footprint
     * Prevents loading type declarations from dependencies like @aipyq/agents
     */
    exclude: ['node_modules/**'],
    /**
     * Use cache for faster incremental builds
     */
    cacheRoot: './node_modules/.cache/rpt2_cache',
    clean: true,
  }),
  json(),
];

const cjsBuild = {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'cjs',
    sourcemap: true,
    exports: 'named',
    entryFileNames: '[name].js',
    /**
     * Always include sources in sourcemap for better debugging
     */
    sourcemapExcludeSources: false,
  },
  external: [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})],
  preserveSymlinks: true,
  plugins,
};

export default cjsBuild;
