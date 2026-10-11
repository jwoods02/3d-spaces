import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { productHandler, imageHandler } from './server/handlers.js';

// Serves the /api routes during `npm run dev` and `npm run preview`, the same
// handlers Vercel runs in production.
const api = () => {
  const mount = (server) => {
    server.middlewares.use('/api/product', (req, res) => productHandler(req, res));
    server.middlewares.use('/api/image', (req, res) => imageHandler(req, res));
  };
  return { name: 'local-api', configureServer: mount, configurePreviewServer: mount };
};

export default defineConfig(({ mode }) => {
  // Lets ANTHROPIC_API_KEY live in a local .env file.
  const env = loadEnv(mode, process.cwd(), '');
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY ??= env.ANTHROPIC_API_KEY;
  return { plugins: [react(), api()] };
});
