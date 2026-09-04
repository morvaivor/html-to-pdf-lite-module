import { createPdfGenerator } from '../src/index.js';
import { performance } from 'node:perf_hooks';

function getHeapMB() {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

async function runSoakTest() {
  console.log('====================================================');
  console.log("🔥 TEST D'ENDURANCE ET DE LEAK MÉMOIRE (SOAK TEST)");
  console.log('====================================================\n');

  const generator = createPdfGenerator();
  const html = `
    <h1 style="color: #333;">Rapport de Stress Test</h1>
    <p style="font-size: 14px; color: #666;">Test de répétition pour vérifier l'absence de fuite mémoire ou de ralentissement.</p>
    <table style="border: 1px solid #000; padding: 4px;">
      <thead><tr><th>Col 1</th><th>Col 2</th><th>Col 3</th></tr></thead>
      <tbody>
        <tr><td>Data 1</td><td>Data 2</td><td>Data 3</td></tr>
        <tr><td>Data 4</td><td>Data 5</td><td>Data 6</td></tr>
      </tbody>
    </table>
    <ul>
      <li>Point 1</li>
      <li>Point 2</li>
    </ul>
  `;

  const TOTAL_RUNS = 200;
  const BATCH_SIZE = 20;

  const startMem = getHeapMB();
  const timings = [];

  console.log(`Exécution de ${TOTAL_RUNS} générations séquentielles de PDF par lots de ${BATCH_SIZE}...\n`);

  for (let batch = 0; batch < TOTAL_RUNS / BATCH_SIZE; batch++) {
    const t0 = performance.now();
    for (let i = 0; i < BATCH_SIZE; i++) {
      await generator.generate(html, {
        css: '@page { @bottom-center { content: "Page " counter(page); } }',
      });
    }
    const batchDuration = performance.now() - t0;
    const avgTimePerDoc = batchDuration / BATCH_SIZE;
    const currentMem = getHeapMB();
    timings.push(avgTimePerDoc);

    console.log(
      `  Lot ${(batch + 1).toString().padStart(2)}/${TOTAL_RUNS / BATCH_SIZE} | Temps moy/doc : ${avgTimePerDoc.toFixed(2)} ms | Mémoire Heap : ${currentMem.toFixed(2)} MB`,
    );
  }

  console.log('\n----------------------------------------------------');
  console.log("📊 RÉSULTATS DU TEST D'ENDURANCE");
  console.log('----------------------------------------------------');
  console.log(`  Premier lot (0-20)   : ${timings[0].toFixed(2)} ms/doc`);
  console.log(`  Dernier lot (180-200): ${timings[timings.length - 1].toFixed(2)} ms/doc`);

  const driftPct = ((timings[timings.length - 1] - timings[0]) / timings[0]) * 100;
  console.log(`  Dérive de vitesse   : ${driftPct >= 0 ? '+' : ''}${driftPct.toFixed(1)}%`);

  const endMem = getHeapMB();
  console.log(
    `  Variation Mémoire   : ${startMem.toFixed(2)} MB ➔ ${endMem.toFixed(2)} MB (Delta : ${(endMem - startMem).toFixed(2)} MB)`,
  );

  // driftPct > 0 means slowdown; driftPct < 0 means speedup (JIT warming up)
  const isSlowdown = driftPct > 20;
  const isMemoryLeak = endMem - startMem > 15;

  if (!isSlowdown && !isMemoryLeak) {
    console.log('\n✅ SUCCÈS : Aucune dégradation de performance ni fuite mémoire détectée sur 200 générations.');
  } else {
    console.warn('\n⚠️ AVERTISSEMENT : Possible dégradation constatée.');
  }
}

runSoakTest().catch(console.error);
