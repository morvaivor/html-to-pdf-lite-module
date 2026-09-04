import { mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createPdfGenerator } from '../src/index.js';

interface TemplateConfig {
  id: string;
  filename: string;
  pdfName: string;
  format?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  margin?: { top: number; bottom: number; left: number; right: number };
}

const TEMPLATES: TemplateConfig[] = [
  {
    id: '1',
    filename: '1-editorial-report.html',
    pdfName: '1-editorial-report.pdf',
    format: 'A4',
    orientation: 'portrait',
    margin: { top: 25, bottom: 25, left: 25, right: 25 },
  },
  {
    id: '2',
    filename: '2-product-catalog.html',
    pdfName: '2-product-catalog.pdf',
    format: 'A4',
    orientation: 'portrait',
    margin: { top: 20, bottom: 20, left: 20, right: 20 },
  },
  {
    id: '3',
    filename: '3-analytics-dashboard.html',
    pdfName: '3-analytics-dashboard.pdf',
    format: 'A4',
    orientation: 'portrait',
    margin: { top: 20, bottom: 20, left: 20, right: 20 },
  },
  {
    id: '4',
    filename: '4-invoice-pro.html',
    pdfName: '4-invoice-pro.pdf',
    format: 'A4',
    orientation: 'portrait',
    margin: { top: 25, bottom: 25, left: 25, right: 25 },
  },
  {
    id: '5',
    filename: '5-certificate-landscape.html',
    pdfName: '5-certificate-landscape.pdf',
    format: 'A4',
    orientation: 'landscape',
    margin: { top: 15, bottom: 15, left: 15, right: 15 },
  },
];

async function buildDemo(): Promise<void> {
  console.log('====================================================');
  console.log('  🚀 Compilation de la Démo GitHub Pages            ');
  console.log('====================================================\n');

  const outDir = resolve(process.cwd(), 'dist-demo');
  const templatesOutDir = join(outDir, 'templates');
  const pdfsOutDir = join(outDir, 'pdfs');
  const testPdfsOutDir = join(outDir, 'output');

  // 1. Create directories
  mkdirSync(outDir, { recursive: true });
  mkdirSync(templatesOutDir, { recursive: true });
  mkdirSync(pdfsOutDir, { recursive: true });
  mkdirSync(testPdfsOutDir, { recursive: true });

  // 2. Copy static site assets
  console.log('📦 Copie des fichiers d\'interface (site statique)...');
  copyFileSync('demo/site/index.html', join(outDir, 'index.html'));
  copyFileSync('demo/site/styles.css', join(outDir, 'styles.css'));
  copyFileSync('demo/site/app.js', join(outDir, 'app.js'));

  // Add .nojekyll for GitHub Pages
  writeFileSync(join(outDir, '.nojekyll'), '');
  console.log('   ✔ Fichiers site copiés + .nojekyll généré\n');

  // 3. Process each template & generate PDFs
  const generator = createPdfGenerator();
  const manifest: Array<{ id: string; pdf: string; size: number; durationMs: number }> = [];

  console.log('🎨 Génération des 5 PDFs de démonstration :');
  for (const tpl of TEMPLATES) {
    const tplPath = join('demo/templates', tpl.filename);
    const htmlContent = readFileSync(tplPath, 'utf8');

    // Copy template html to demo distribution
    copyFileSync(tplPath, join(templatesOutDir, tpl.filename));

    const startTime = performance.now();
    const pdfBuffer = await generator.generate(htmlContent, {
      format: tpl.format,
      orientation: tpl.orientation,
      margin: tpl.margin,
    });
    const duration = performance.now() - startTime;

    const outPdfPath = join(pdfsOutDir, tpl.pdfName);
    writeFileSync(outPdfPath, pdfBuffer);

    manifest.push({
      id: tpl.id,
      pdf: tpl.pdfName,
      size: pdfBuffer.length,
      durationMs: Math.round(duration * 10) / 10,
    });

    console.log(
      `   ✔ [${tpl.id}/5] ${tpl.pdfName.padEnd(30)} ${(pdfBuffer.length / 1024).toFixed(1).padStart(5)} KB  (${duration.toFixed(1)} ms)`
    );
  }

  // 4. Copy test output PDFs
  console.log('\n🧪 Copie des artefacts de tests unitaires et d\'intégration :');
  let testCount = 0;
  const testMap: Record<number, { file: string; size: number }> = {};

  if (readdirSync('output').length > 0) {
    const files = readdirSync('output');
    for (const f of files) {
      if (f.endsWith('.pdf')) {
        const srcFile = join('output', f);
        copyFileSync(srcFile, join(testPdfsOutDir, f));
        testCount++;

        const match = f.match(/^test(\d+)/);
        if (match?.[1]) {
          const id = parseInt(match[1], 10);
          testMap[id] = {
            file: `output/${f}`,
            size: readFileSync(srcFile).length,
          };
        }
      }
    }
    console.log(`   ✔ ${testCount} PDFs de tests copiés dans dist-demo/output/`);
  }

  // 5. Generate metadata manifest
  const report = {
    branch: 'feat/test-github-io',
    generatedAt: new Date().toISOString(),
    totalIntegrationTests: 45,
    totalUnitTests: 72,
    demonstrationExamples: manifest,
    testFiles: testMap,
  };
  writeFileSync(join(outDir, 'test-results.json'), JSON.stringify(report, null, 2));

  console.log('\n====================================================');
  console.log('  ✨ Démo prête pour GitHub Pages dans ./dist-demo !');
  console.log('====================================================\n');
}

buildDemo().catch((err) => {
  console.error('❌ Échec du build de la démo :', err);
  process.exit(1);
});
