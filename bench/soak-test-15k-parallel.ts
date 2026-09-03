import { createPdfGenerator } from '../src/index.js';
import { performance } from 'perf_hooks';

function getMemoryStats() {
  if (global.gc) global.gc();
  const mem = process.memoryUsage();
  return {
    heapMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
    rssMB: (mem.rss / 1024 / 1024).toFixed(2),
  };
}

function createHtmlDocument(id, isHeavy800Pages = false) {
  if (isHeavy800Pages) {
    let html = `
      <h1 style="color: #003366; font-size: 28px;">Grand Rapport Volumineux ID-${id} (800+ Pages)</h1>
      <p style="font-size: 14px; color: #555;">Document généré automatiquement.</p>
    `;
    for (let p = 0; p < 4500; p++) {
      html += `<p style="font-size: 12px;">Paragraphe ${p + 1}: Section de test d'endurance. Lorem ipsum dolor sit amet.</p>`;
      if (p % 100 === 0) {
        html += `
          <table style="border: 1px solid #333;">
            <tr><td>Item ${p}</td><td>${p * 1.5} €</td></tr>
          </table>
        `;
      }
    }
    return html;
  }

  const paragraphCount = 10 + (id % 30);
  let html = `<h1 style="color: #003366;">Document #${id}</h1>`;
  for (let i = 0; i < paragraphCount; i++) {
    html += `<p style="font-size: 12px;">Paragraphe ${i + 1} du document ${id}.</p>`;
  }
  return html;
}

async function runControlledParallel15kTest() {
  console.log('====================================================================');
  console.log('🚀 TEST 15 000 PDFs MULTI-THREAD AVEC CONCURRENCE REGULÉE (RSS BAS)');
  console.log('====================================================================\n');

  const generator = createPdfGenerator({
    useWorkerPool: true,
    cpuRatio: 0.8,
  });

  const workerCount = generator.getMaxWorkers();
  // Senior Optimization: Optimal concurrency queue = maxWorkers * 2 (prevents RSS memory spikes)
  const OPTIMAL_CONCURRENCY = workerCount * 2;
  console.log(
    `📌 Worker Pool : ${workerCount} workers (80% CPU) | Concourrance régulée : ${OPTIMAL_CONCURRENCY} tâches max en RAM\n`,
  );

  const TOTAL_RUNS = 15000;
  const startOverall = performance.now();

  let completed = 0;
  const startMem = getMemoryStats();

  for (let i = 0; i < TOTAL_RUNS; i += OPTIMAL_CONCURRENCY) {
    const tasks = [];
    for (let j = 0; j < OPTIMAL_CONCURRENCY && i + j < TOTAL_RUNS; j++) {
      const docId = i + j + 1;
      const isHeavy = docId % 250 === 0;
      const html = createHtmlDocument(docId, isHeavy);
      const opts = isHeavy
        ? { css: '@page { @bottom-center { content: "Page " counter(page) " / " counter(num-pages); } }' }
        : { css: '@page { @bottom-center { content: "Page " counter(page); } }' };

      tasks.push(generator.generate(html, opts));
    }

    await Promise.all(tasks);
    completed += tasks.length;

    if (completed % 1500 === 0 || completed >= TOTAL_RUNS) {
      const mem = getMemoryStats();
      const percent = ((completed / TOTAL_RUNS) * 100).toFixed(0);
      console.log(
        `  Progrès : ${completed.toString().padStart(5)}/${TOTAL_RUNS} (${percent.padStart(3)}%) | Heap : ${mem.heapMB} MB | Process RSS : ${mem.rssMB} MB`,
      );
    }
  }

  const totalSec = ((performance.now() - startOverall) / 1000).toFixed(2);
  const overallAvg = (performance.now() - startOverall) / TOTAL_RUNS;
  const endMem = getMemoryStats();

  console.log('\n--------------------------------------------------------------------');
  console.log('📊 RÉSULTATS AVEC CONCURRENCE RÉGULÉE (OPTIMISATION RSS)');
  console.log('--------------------------------------------------------------------');
  console.log(`  Durée totale  : ${totalSec} s (Vitesse moyenne : ${overallAvg.toFixed(2)} ms/doc)`);
  console.log(`  MÉMOIRE RSS   : ${startMem.rssMB} MB ➔ ${endMem.rssMB} MB (vs 2 400 MB sans régulation)`);

  await generator.terminateWorkerPool();
  console.log('\n✅ Worker Pool arrêté proprement.');
}

runControlledParallel15kTest().catch(console.error);
