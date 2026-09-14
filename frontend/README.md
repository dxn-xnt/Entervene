# React + TypeScript + Vite

## Error and maintenance pages

Run `npm run dev` from `frontend`, then open the URL printed by Vite with:

- `/maintenance`: scheduled maintenance design.
- `/unavailable`: service unavailable design.
- `/error`: unexpected error design.
- `/this-page-does-not-exist`: missing-page design (all unmatched routes use it).
- `/unavailable.html`: standalone fallback; does not require React, JavaScript, login, or the backend.

These preview URLs do not turn maintenance on. To show maintenance across the app,
set `VITE_MAINTENANCE_MODE=true` in `frontend/.env.local`, then restart Vite.
For production, set it before building and redeploy. Remove it or set it to `false`
and rebuild/redeploy to restore the app. This is a frontend display switch, not a
backend access control.

An app-level error boundary displays the error design for React rendering failures.
API failures continue to use their existing handling; they do not automatically
redirect to `/unavailable`.

For an actual origin outage, configure your hosting provider/reverse proxy to serve
`dist/unavailable.html` with HTTP 503 for upstream 502/503/504 failures, and keep
`dist/status.css` accessible on that fallback host. The static page is copied to
`dist` during the build. It cannot be served by an origin that is itself completely
offline; a working proxy/CDN or separate fallback host must serve it. Hosting
configuration is deployment-specific and is not enabled by these preview routes.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
