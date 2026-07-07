import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://devikaexim.in',
  output: 'static',
  build: {
    format: 'file'
  }
});
