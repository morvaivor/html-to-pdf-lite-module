import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'workers/pdfWorker': 'src/workers/pdfWorker.ts',
  },
  format: 'esm',
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  platform: 'node',
  deps: {
    neverBundle: ['pdfkit', 'cheerio', 'domhandler'],
  },
});
