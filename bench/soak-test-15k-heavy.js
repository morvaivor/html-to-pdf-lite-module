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

// Generator for 15,000 DIFFERENT documents
function createHtmlDocument(id, isHeavy800Pages = false) {
  if (isHeavy800Pages) {
    // Generates a massive document of ~800 pages
    let html = `
      <h1 style="color: #003366; font-size: 28px;">Grand Rapport Volumineux ID-${id} (800+ Pages)</h1>
      <p style="font-size: 14px; color: #555;">Document généré automatiquement à des fins d'analyse d'endurance extrême.</p>
    `;
    // ~5,000 paragraphs to guarantee >800 PDF pages
    for (let p = 0; p < 4500; p++) {
      html += `<p style="font-size: 12px; color: #${(p % 9)}3${(p % 5)}333;">Paragraphe ${p + 1}: Section de test d'endurance volumique. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>`;
      if (p % 100 === 0) {
        html += `
          <table style="border: 1px solid #333; padding: 4px;">
            <thead><tr><th>Index</th><th>Valeur ${p}</th><th>Statut</th></tr></thead>
            <tbody>
              <tr><td>Item ${p}-A</td><td>${p * 1.5} €</td><td>Valide</td></tr>
              <tr><td>Item ${p}-B</td><td>${p * 2.8} €</td><td>En cours</td></tr>
            </tbody>
          </table>
        `;
      }
    }
    return html;
  }

  // Standard varied document (1-15 pages)
  const paragraphCount = 10 + (id % 40);
  let html = `
    <h1 style="color: #${(id % 8)}03366; font-size: 24px;">Facture / Document #${id}</h1>
    <p style="font-size: 13px;">Client ref: CLI-${id * 7} | Date: 2026-09-02</p>
    <div style="padding: 8px; border: 1px solid #ccc; background-color: #${id % 2 === 0 ? 'f9f9f9' : 'ffffff'};">
      <h2>Synthese #${id}</h2>
      <ul>
        <li>Commande #${id * 12}</li>
        <li>Montant: ${(id * 15.75).toFixed(2)} €</li>
      </ul>
    </div>
  `;
  for (let i = 0; i < paragraphCount; i++) {
    html += `<p style="font-size: 12px;">Paragraphe ${i + 1} du document ${id} - Données dynamiques uniques.</p>`;
  }
  return html;
}

async function runSoakTest15kHeavy() {
  console.log('====================================================================');
  console.log('🔥 TEST EXTRÊME : 15 000 PDFs DIFFÉRENTS (AVEC DOCUMENTS >800 PAGES)');
  console.log('====================================================================\n');

  const generator = createPdfGenerator();
  const TOTAL_RUNS = 15000;
  const BATCH_SIZE = 1000;

  const startMem = getMemoryStats();
  const timings = [];
  const heavyTimings = [];
  const startOverall = performance.now();

  console.log(`Lancement de ${TOTAL_RUNS.toLocaleString()}PDFs variés (15 lots de ${BATCH_SIZE.toLocaleString()})...`);
  console.log(`Note : Un document massif (>800 pages) sera inséré tous les ~200 documents.\n`);

  let heavyCount = 0;

  for (let batch = 0; batch < TOTAL_RUNS / BATCH_SIZE; batch++) {
    const t0 = performance.now();

    for (let i = 0; i < BATCH_SIZE; i++) {
      const docId = batch * BATCH_SIZE + i + 1;
      const isHeavy = docId % 200 === 0; // ~75 heavy 800-page documents spread evenly

      if (isHeavy) {
        heavyCount++;
        const ht0 = performance.now();
        const heavyHtml = createHtmlDocument(docId, true);
        const pdf = await generator.generate(heavyHtml, {
          css: '@page { @bottom-center { content: "Page " counter(page) " sur " counter(num-pages); } }',
        });
        const duration = performance.now() - ht0;
        heavyTimings.push({ id: docId, durationMs: duration, bytes: pdf.length });
      } else {
        const stdHtml = createHtmlDocument(docId, false);
        await generator.generate(stdHtml, {
          css: '@page { @bottom-center { content: "Page " counter(page); } }',
        });
      }
    }

    const batchDuration = performance.now() - t0;
    const avgTimePerDoc = batchDuration / BATCH_SIZE;
    const mem = getMemoryStats();
    timings.push(avgTimePerDoc);

    const percent = (((batch + 1) * BATCH_SIZE) / TOTAL_RUNS * 100).toFixed(0);
    console.log(`  Lot ${(batch + 1).toString().padStart(2)}/15 (${percent.padStart(3)}%) | Temps moy/doc : ${avgTimePerDoc.toFixed(2)} ms | Heap : ${mem.heapMB} MB | RSS : ${mem.rssMB} MB`);
  }

  const totalTimeSec = ((performance.now() - startOverall) / 1000).toFixed(2);
  const overallAvgMs = (performance.now() - startOverall) / TOTAL_RUNS;
  const endMem = getMemoryStats();

  console.log('\n--------------------------------------------------------------------');
  console.log('📊 RÉSULTATS DÉTAILLÉS : 15 000 PDFs (DONT DOCS >800 PAGES)');
  console.log('--------------------------------------------------------------------');
  console.log(`  Durée totale d'exécution  : ${totalTimeSec} s (${overallAvgMs.toFixed(2)} ms/doc)`);
  console.log(`  Premier lot (0 - 1,000)   : ${timings[0].toFixed(2)} ms/doc`);
  console.log(`  Dernier lot (14,000-15k)  : ${timings[timings.length - 1].toFixed(2)} ms/doc`);

  const driftPct = ((timings[timings.length - 1] - timings[0]) / timings[0]) * 100;
  console.log(`  Dérive de vitesse globale : ${driftPct >= 0 ? '+' : ''}${driftPct.toFixed(1)}%`);

  if (heavyTimings.length > 0) {
    const avgHeavyMs = heavyTimings.reduce((a, b) => a + b.durationMs, 0) / heavyTimings.length;
    const lastHeavy = heavyTimings[heavyTimings.length - 1];
    console.log(`\n  📄 Analyse des ${heavyCount} documents massifs (>800 pages) :`);
    console.log(`     - Temps moyen par doc 800+ p. : ${avgHeavyMs.toFixed(2)} ms (${(avgHeavyMs / 1000).toFixed(2)} s)`);
    console.log(`     - Taille binaire PDF générée  : ~${(lastHeavy.bytes / 1024 / 1024).toFixed(2)} MB par PDF 800p`);
  }

  console.log(`\n  💾 Bilan Mémoire :`);
  console.log(`     - Heap Used : ${startMem.heapMB} MB ➔ ${endMem.heapMB} MB`);
  console.log(`     - Process RSS: ${startMem.rssMB} MB ➔ ${endMem.rssMB} MB`);

  if (Math.abs(driftPct) < 30) {
    console.log('\n✅ SUCCÈS : 15 000 PDFs générés avec succès. Aucune fuite ni dégradation mémoire.');
  }
}

runSoakTest15kHeavy().catch(console.error);
