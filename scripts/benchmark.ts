import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createPdfGenerator } from '../src/index.js';

async function runBenchmark() {
  console.log('====================================================');
  console.log('  ⚡ Benchmark de Performance : html-to-pdf-lite   ');
  console.log('====================================================\n');

  const templates = [
    { name: '1-editorial-report.html', label: 'Rapport Éditorial (A4)' },
    { name: '2-product-catalog.html', label: 'Catalogue Produit (A4)' },
    { name: '3-analytics-dashboard.html', label: 'Dashboard Analytique (A4)' },
    { name: '4-invoice-pro.html', label: 'Facture Pro (A4)' },
    { name: '5-certificate-landscape.html', label: 'Certificat (A4 Landscape)' },
  ].map((t) => ({
    ...t,
    html: readFileSync(`demo/templates/${t.name}`, 'utf8'),
  }));

  const generator = createPdfGenerator();

  // 1. Warm-up
  console.log('🔥 Préchauffage du moteur (Warmup)...');
  for (const t of templates) {
    await generator.generate(t.html);
  }
  console.log('   ✔ Préchauffage terminé.\n');

  // 2. Latence unitaire par template (10 répétitions)
  console.log('📊 Test de Latence Unitaire (10 itérations par template) :');
  const ITERATIONS = 10;
  const results: Record<string, { min: number; avg: number; max: number; size: number }> = {};

  for (const t of templates) {
    const times: number[] = [];
    let lastSize = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const pdf = await generator.generate(t.html);
      const duration = performance.now() - start;
      times.push(duration);
      lastSize = pdf.length;
    }

    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;

    results[t.label] = { min, avg, max, size: lastSize };
    console.log(
      `   • ${t.label.padEnd(30)} : Moyenne ${avg.toFixed(1).padStart(5)} ms | Min ${min.toFixed(1).padStart(4)} ms | Max ${max.toFixed(1).padStart(5)} ms | Taille ${(lastSize / 1024).toFixed(1)} KB`,
    );
  }

  // 3. Test de Débit Concurrentiel (Génération par lot de 25 documents)
  console.log('\n🚀 Test de Débit Parallèle (25 documents concurrents) :');
  const batchHtmls = Array.from({ length: 25 }, (_, i) => templates[i % templates.length]!.html);

  const memBefore = process.memoryUsage().heapUsed;
  const batchStart = performance.now();
  const batchPdfs = await Promise.all(batchHtmls.map((html) => generator.generate(html)));
  const batchDuration = performance.now() - batchStart;
  const memAfter = process.memoryUsage().heapUsed;

  const totalBytes = batchPdfs.reduce((acc, b) => acc + b.length, 0);
  const throughput = (batchHtmls.length / (batchDuration / 1000)).toFixed(1);
  const memDeltaMb = ((memAfter - memBefore) / (1024 * 1024)).toFixed(2);

  console.log(`   ✔ 25 PDFs générés en : ${batchDuration.toFixed(1)} ms`);
  console.log(`   ✔ Débit global       : ${throughput} docs/seconde`);
  console.log(`   ✔ Volume produit     : ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`   ✔ Delta mémoire heap : ${memDeltaMb} MB`);

  console.log('\n====================================================');
  console.log('  ✨ Synthèse Benchmark Terminé !');
  console.log('====================================================\n');
}

runBenchmark().catch(console.error);
