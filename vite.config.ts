import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // Use process.cwd() para carregar .env na raiz
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL), // Adicionado Supabase URL
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY), // Adicionado Supabase Anon Key
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'), // Alias corrigido para apontar para a pasta src
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});