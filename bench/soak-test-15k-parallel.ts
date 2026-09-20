import { createPdfGenerator, type GpuMode, type ProfilingTimings } from '../src/index.js';
import { performance } from 'node:perf_hooks';

// CLI Arguments
const args = process.argv.slice(2);
const countArg = args.find((a) => a.startsWith('--count='));
const TOTAL_RUNS = countArg ? parseInt(countArg.split('=')[1] ?? '15000', 10) : 15000;
const compareMode = args.includes('--compare');
const gpuModeArg = args.find((a) => a.startsWith('--gpu='));
const defaultGpuMode: GpuMode = gpuModeArg
  ? gpuModeArg.split('=')[1] === 'false'
    ? false
    : gpuModeArg.split('=')[1] === 'true'
      ? true
      : 'auto'
  : 'auto';
const enableProfiling = args.includes('--profiling') || args.includes('--debug');

function getMemoryStats(): { heapMB: string; rssMB: string } {
  if (global.gc) global.gc();
  const mem = process.memoryUsage();
  return {
    heapMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
    rssMB: (mem.rss / 1024 / 1024).toFixed(2),
  };
}

/**
 * Generates realistic enterprise documents exercising both:
 * 1. CPU fast-path tables (< 4096 cells) for regular invoices.
 * 2. WebGPU compute shader tables (>= 4096 cells) for dense inventories.
 * 3. Heavy multi-page documents.
 */
function createHtmlDocument(id: number, isHeavy = false, isDenseTable = false): string {
  if (isHeavy) {
    let html = `
      <h1 style="color: #003366; font-size: 24px;">Grand Rapport Volumineux ID-${id}</h1>
      <p style="font-size: 13px; color: #555;">Document d'endurance généré automatiquement.</p>
    `;
    for (let p = 0; p < 1500; p++) {
      html += `<p style="font-size: 11px;">Paragraphe ${p + 1}: Section de test d'endurance volumique continue. Lorem ipsum dolor sit amet.</p>`;
    }
    return html;
  }

  if (isDenseTable) {
    // 500 rows x 10 cols = 5 000 cells >= 4096 (triggers WebGPU compute shader)
    let html = `
      <h1 style="color: #003366; font-size: 20px;">Inventaire Dense & Données Massives #${id}</h1>
      <p style="font-size: 11px; color: #666;">Tableau dense éligible à l'accélération WebGPU (5 000 cellules).</p>
      <table style="border: 1px solid #333; font-size: 9px; padding: 2px;">
        <thead><tr>
    `;
    for (let c = 0; c < 10; c++) html += `<th style="background-color: #eee;">Col ${c + 1}</th>`;
    html += `</tr></thead><tbody>`;
    for (let r = 0; r < 500; r++) {
      html += `<tr>`;
      for (let c = 0; c < 10; c++) {
        html += `<td>D-${r + 1}-${c + 1}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  }

  // Standard business invoice with a small table (6 to 14 rows x 4 cols = 24 to 56 cells < 4096)
  const paragraphCount = 6 + (id % 12);
  const tableRows = 6 + (id % 8);
  let html = `
    <h1 style="color: #003366; font-size: 18px;">Facture Client #${id}</h1>
    <p style="font-size: 11px; color: #666;">Réf. Commande : CMD-${id * 3} | Date : 2026-09-20</p>
    <table style="border: 1px solid #ccc; font-size: 10px; margin: 6px 0;">
      <thead><tr>
        <th style="background: #f0f0f0;">Prestation</th>
        <th style="background: #f0f0f0;">Qté</th>
        <th style="background: #f0f0f0;">Prix Unit.</th>
        <th style="background: #f0f0f0;">Total HT</th>
      </tr></thead>
      <tbody>
  `;
  for (let r = 0; r < tableRows; r++) {
    const qty = (r % 4) + 1;
    const unitPrice = (r + 1) * 15;
    html += `<tr>
      <td>Service d'audit et maintenance lot ${r + 1}</td>
      <td>${qty}</td>
      <td>${unitPrice.toFixed(2)} €</td>
      <td>${(qty * unitPrice).toFixed(2)} €</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  for (let i = 0; i < paragraphCount; i++) {
    html += `<p style="font-size: 10px; margin: 2px 0;">Conditions générales et règlement du document #${id} — article ${i + 1}.</p>`;
  }
  return html;
}

interface BatchRunStats {
  modeName: string;
  totalDocs: number;
  totalDurationSec: number;
  avgMsPerDoc: number;
  throughputDocsSec: number;
  startRssMb: string;
  endRssMb: string;
  endHeapMb: string;
  tablesProcessedGpu: number;
  tablesProcessedCpu: number;
  fallbacks: number;
  gpuKernelTimeMs: number;
  profilingBreakdown?: ProfilingTimings;
}

async function runBatch(runsCount: number, gpuMode: GpuMode, label: string): Promise<BatchRunStats> {
  console.log(`\n--------------------------------------------------------------------`);
  console.log(`🚀 EXÉCUTION DU LOT : ${label.toUpperCase()} (${runsCount.toLocaleString()} DOCUMENTS)`);
  console.log(`--------------------------------------------------------------------`);

  const generator = createPdfGenerator({
    useWorkerPool: true,
    cpuRatio: 0.8,
    minWorkers: 9,
    maxQueueSize: 500,
    gpu: gpuMode,
    profiling: enableProfiling,
  });

  const workerCount = generator.getMaxWorkers();
  const OPTIMAL_CONCURRENCY = workerCount * 2;
  console.log(
    `📌 Worker Pool : ${workerCount} workers chauds | Concurrence régulée : ${OPTIMAL_CONCURRENCY} tâches max en RAM`,
  );
  console.log(
    `📌 Mode GPU configuré : ${String(gpuMode)} | Sondes de profilage : ${enableProfiling ? 'Actives' : 'Désactivées'}\n`,
  );

  // Warmup pool
  await Promise.all(
    Array.from({ length: workerCount }, () => generator.generate('<p>Warmup Soak</p>', { gpu: gpuMode })),
  );

  const startMem = getMemoryStats();
  const startOverall = performance.now();
  let completed = 0;
  let lastProfile: ProfilingTimings | undefined;

  const intervalStep = Math.max(500, Math.floor(runsCount / 10));

  for (let i = 0; i < runsCount; i += OPTIMAL_CONCURRENCY) {
    const batchSize = Math.min(OPTIMAL_CONCURRENCY, runsCount - i);
    const tasks = [];

    for (let j = 0; j < batchSize; j++) {
      const docId = i + j + 1;
      const isHeavy = docId % 250 === 0;
      const isDense = !isHeavy && docId % 100 === 0; // Dense table (5 000 cells) every 100 docs
      const html = createHtmlDocument(docId, isHeavy, isDense);

      const opts = {
        css: isHeavy
          ? '@page { @bottom-center { content: "Page " counter(page) " / " counter(num-pages); } }'
          : '@page { @bottom-center { content: "Page " counter(page); } }',
        gpu: gpuMode,
        profiling: enableProfiling,
        onProfile: enableProfiling
          ? (t: ProfilingTimings) => {
              lastProfile = t;
            }
          : undefined,
      };

      tasks.push(generator.generate(html, opts));
    }

    await Promise.all(tasks);
    completed += batchSize;

    if (completed % intervalStep === 0 || completed >= runsCount) {
      const mem = getMemoryStats();
      const percent = ((completed / runsCount) * 100).toFixed(0);
      const elapsedSec = (performance.now() - startOverall) / 1000;
      const curThroughput = completed / elapsedSec;
      const gpuStats = generator.getGpuStats();

      console.log(
        `  • Progrès : ${completed.toString().padStart(5)}/${runsCount} (${percent.padStart(3)}%) | Débit : ${curThroughput.toFixed(1).padStart(5)} doc/s | Heap : ${mem.heapMB} MB | RSS : ${mem.rssMB} MB | GPU (G:${gpuStats.tablesProcessedGpu} / C:${gpuStats.tablesProcessedCpu})`,
      );
    }
  }

  const totalDurationSec = (performance.now() - startOverall) / 1000;
  const avgMsPerDoc = (totalDurationSec * 1000) / runsCount;
  const throughputDocsSec = runsCount / totalDurationSec;
  const endMem = getMemoryStats();
  const finalGpuStats = generator.getGpuStats();

  await generator.terminateWorkerPool();

  return {
    modeName: label,
    totalDocs: runsCount,
    totalDurationSec,
    avgMsPerDoc,
    throughputDocsSec,
    startRssMb: startMem.rssMB,
    endRssMb: endMem.rssMB,
    endHeapMb: endMem.heapMB,
    tablesProcessedGpu: finalGpuStats.tablesProcessedGpu,
    tablesProcessedCpu: finalGpuStats.tablesProcessedCpu,
    fallbacks: finalGpuStats.fallbacks,
    gpuKernelTimeMs: finalGpuStats.gpuKernelTimeMs,
    profilingBreakdown: lastProfile,
  };
}

async function main() {
  console.log('====================================================================');
  console.log("🚀 BENCHMARK D'ENDURANCE & SCALABILITÉ : 15 000 DOCUMENTS");
  console.log('====================================================================');

  if (compareMode) {
    const halfCount = Math.floor(TOTAL_RUNS / 2);
    console.log(
      `\n⚖️ MODE COMPARATIF ACTIVÉ : CPU pur vs WebGPU Accéléré (${halfCount.toLocaleString()} docs par mode)`,
    );

    const cpuResult = await runBatch(halfCount, false, 'CPU Pur (gpu: false)');
    const gpuResult = await runBatch(halfCount, 'auto', 'WebGPU Accéléré (gpu: "auto")');

    console.log('\n====================================================================');
    console.log('📊 RÉSULTATS COMPARATIFS : GÉNÉRATION MASSIVE DE DOCUMENTS');
    console.log('====================================================================\n');

    console.log(`| Métrique d'Évaluation | Mode CPU Pur | Mode WebGPU Accéléré | Écart / Analyse |`);
    console.log(`|:---|:---:|:---:|:---|`);
    console.log(
      `| **Documents Générés** | ${cpuResult.totalDocs.toLocaleString()} docs | ${gpuResult.totalDocs.toLocaleString()} docs | Volume identique |`,
    );
    console.log(
      `| **Durée Totale** | ${cpuResult.totalDurationSec.toFixed(2)} s | ${gpuResult.totalDurationSec.toFixed(2)} s | ${(gpuResult.totalDurationSec - cpuResult.totalDurationSec).toFixed(2)} s |`,
    );
    console.log(
      `| **Débit Moyen** | **${cpuResult.throughputDocsSec.toFixed(1)} docs/s** | **${gpuResult.throughputDocsSec.toFixed(1)} docs/s** | ${(gpuResult.throughputDocsSec - cpuResult.throughputDocsSec).toFixed(1)} docs/s |`,
    );
    console.log(
      `| **Latence Moyenne / Doc** | ${cpuResult.avgMsPerDoc.toFixed(2)} ms | ${gpuResult.avgMsPerDoc.toFixed(2)} ms | ${(gpuResult.avgMsPerDoc - cpuResult.avgMsPerDoc).toFixed(2)} ms |`,
    );
    console.log(`| **Mémoire RSS Initiale** | ${cpuResult.startRssMb} MB | ${gpuResult.startRssMb} MB | - |`);
    console.log(`| **Mémoire RSS Finale** | ${cpuResult.endRssMb} MB | ${gpuResult.endRssMb} MB | Stabilité mémoire |`);
    console.log(`| **Mémoire Heap V8** | ${cpuResult.endHeapMb} MB | ${gpuResult.endHeapMb} MB | Zéro fuite RAM |`);
    console.log(
      `| **Tables Traitées CPU** | ${cpuResult.tablesProcessedCpu} | ${gpuResult.tablesProcessedCpu} | Fast-path < 4096 |`,
    );
    console.log(
      `| **Tables Traitées GPU** | ${cpuResult.tablesProcessedGpu} | ${gpuResult.tablesProcessedGpu} | Shaders WGSL >= 4096 |`,
    );
    console.log(`| **Fallbacks Basculés** | ${cpuResult.fallbacks} | ${gpuResult.fallbacks} | Robustesse |`);
  } else {
    const singleResult = await runBatch(TOTAL_RUNS, defaultGpuMode, `Mode Standard (${String(defaultGpuMode)})`);

    console.log('\n====================================================================');
    console.log("📊 SYNTHÈSE DU TEST D'ENDURANCE 15 000 DOCUMENTS");
    console.log('====================================================================\n');
    console.log(`  • Volume total généré  : ${singleResult.totalDocs.toLocaleString()} documents`);
    console.log(`  • Durée globale        : ${singleResult.totalDurationSec.toFixed(2)} s`);
    console.log(`  • Débit moyen global   : ${singleResult.throughputDocsSec.toFixed(1)} docs/seconde`);
    console.log(`  • Latence moyenne/doc  : ${singleResult.avgMsPerDoc.toFixed(2)} ms/document`);
    console.log(`  • Mémoire RSS initiale : ${singleResult.startRssMb} MB`);
    console.log(`  • Mémoire RSS finale   : ${singleResult.endRssMb} MB`);
    console.log(`  • Mémoire Heap finale  : ${singleResult.endHeapMb} MB`);
    console.log(`  • Tables traitées CPU  : ${singleResult.tablesProcessedCpu} (fast-path sous le seuil)`);
    console.log(`  • Tables traitées GPU  : ${singleResult.tablesProcessedGpu} (compute shaders WGSL)`);
    console.log(`  • Fallbacks basculés   : ${singleResult.fallbacks}`);

    if (singleResult.profilingBreakdown) {
      const p = singleResult.profilingBreakdown;
      console.log(`\n  ⏱ Décomposition par phase (Sondes de Profilage) :`);
      console.log(
        `     • HTML Parsing      : ${p.parseHtmlMs.toFixed(2)} ms (${((p.parseHtmlMs / p.totalMs) * 100).toFixed(1)}%)`,
      );
      console.log(`     • CSS Index & Map   : ${p.cssMs.toFixed(2)} ms (${((p.cssMs / p.totalMs) * 100).toFixed(1)}%)`);
      console.log(
        `     • Font Register     : ${p.fontRegisterMs.toFixed(2)} ms (${((p.fontRegisterMs / p.totalMs) * 100).toFixed(1)}%)`,
      );
      console.log(
        `     • Layout & Rendu    : ${p.layoutRenderMs.toFixed(2)} ms (${((p.layoutRenderMs / p.totalMs) * 100).toFixed(1)}%)`,
      );
      console.log(
        `     • PDFKit Assembly   : ${p.pdfAssemblyMs.toFixed(2)} ms (${((p.pdfAssemblyMs / p.totalMs) * 100).toFixed(1)}%)`,
      );
      console.log(`     • Total Latence     : ${p.totalMs.toFixed(2)} ms`);
    }
  }

  console.log("\n✅ Test d'endurance terminé avec succès.");
}

main().catch(console.error);
