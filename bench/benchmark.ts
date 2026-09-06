import { createPdfGenerator } from '../src/index.js';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, '..');

// --- Helper for memory measurement ---
function getHeapMemoryMB(): number {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

// --- Synthetic Test Datasets ---
function generateLargeTableHtml(rows = 100, cols = 5): string {
  let html = `<table style="border: 1px solid #333; padding: 4px;"><thead><tr>`;
  for (let c = 0; c < cols; c++) html += `<th style="background-color: #eee;">Header ${c + 1}</th>`;
  html += `</tr></thead><tbody>`;
  for (let r = 0; r < rows; r++) {
    html += `<tr>`;
    for (let c = 0; c < cols; c++) {
      html += `<td style="color: ${r % 2 === 0 ? '#111' : '#444'}; font-size: 11px;">Row ${r + 1} Col ${c + 1} Data</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function generateMultiPageHtml(paragraphs = 80): string {
  let html = `<h1>Multi-page Document Test</h1>`;
  for (let i = 0; i < paragraphs; i++) {
    html += `<p style="font-size: 13px; color: #222;">Paragraph ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>`;
  }
  return html;
}

function generateFullDocumentHtml(): string {
  return `
    <h1 style="color: #003366; font-size: 26px;">Rapport d'Activité Annuel</h1>
    <p style="font-size: 14px; color: #555;">Ce document synthétise les performances opérationnelles et financières.</p>
    <div style="padding: 10px; border: 1px solid #ccc; background-color: #f9f9f9;">
      <h2 style="color: #333;">Sections clés</h2>
      <ul>
        <li>Résultats financiers</li>
        <li>Objectifs et perspectives</li>
        <li>Tableau détaillé des opérations</li>
      </ul>
    </div>
    ${generateLargeTableHtml(60, 5)}
    ${generateMultiPageHtml(40)}
  `;
}

// --- Load Real-World Demo Templates ---
function loadRealWorldTemplates(): Array<{ name: string; label: string; html: string }> {
  const templatesDir = path.resolve(rootDir, 'demo/templates');
  const files = [
    { name: '1-editorial-report.html', label: 'Rapport Éditorial (A4)' },
    { name: '2-product-catalog.html', label: 'Catalogue Produit (A4)' },
    { name: '3-analytics-dashboard.html', label: 'Dashboard Analytique (A4)' },
    { name: '4-invoice-pro.html', label: 'Facture Professionnelle (A4)' },
    { name: '5-certificate-landscape.html', label: 'Certificat Paysage (A4)' },
  ];

  const loaded: Array<{ name: string; label: string; html: string }> = [];
  for (const f of files) {
    const filePath = path.join(templatesDir, f.name);
    if (fs.existsSync(filePath)) {
      loaded.push({
        name: f.name,
        label: f.label,
        html: fs.readFileSync(filePath, 'utf-8'),
      });
    }
  }
  return loaded;
}

interface BenchmarkItemResult {
  scenario: string;
  category: 'Synthétique' | 'Template Réel';
  minMs: number;
  avgMs: number;
  maxMs: number;
  sizeKb: number;
  throughputDocsSec: number;
  heapDeltaMb: number;
}

interface BatchBenchmarkResult {
  batchSize: number;
  singleThreadDurationMs: number;
  singleThreadThroughput: number;
  multiThreadDurationMs: number;
  multiThreadThroughput: number;
  speedup: number;
  workerCount: number;
}

async function runBenchmarks() {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model ?? 'Inconnu';
  const cpuCount = cpus.length;

  console.log('====================================================================');
  console.log('🚀 BENCHMARK SUITE : html-to-pdf-lite-module (pdf-generator v2.0)');
  console.log('====================================================================');
  console.log(`📌 Environnement : Node.js ${process.version} | ${os.type()} ${os.arch()}`);
  console.log(`📌 Processeur    : ${cpuModel} (${cpuCount} threads logiques)`);
  console.log(`📌 Mémoire vive  : ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB\n`);

  const singleGenerator = createPdfGenerator();
  const syntheticDatasets = [
    {
      name: 'Document Texte Multi-pages (80 par.)',
      html: generateMultiPageHtml(80),
      css: 'p { color: #333; }',
      category: 'Synthétique' as const,
    },
    {
      name: 'Grand Tableau (100 lignes x 5 cols)',
      html: generateLargeTableHtml(100, 5),
      css: '',
      category: 'Synthétique' as const,
    },
    {
      name: 'Rapport Complet (Texte + Table + CSS)',
      html: generateFullDocumentHtml(),
      css: '@page { @bottom-center { content: "Page " counter(page) " sur " counter(num-pages); } } h1 { color: navy; }',
      category: 'Synthétique' as const,
    },
  ];

  const realWorldTemplates = loadRealWorldTemplates();

  // 1. Warm-up
  console.log('🔥 Préchauffage du moteur (Warmup)...');
  for (const ds of syntheticDatasets) {
    await singleGenerator.generate(ds.html, { css: ds.css });
  }
  for (const t of realWorldTemplates) {
    await singleGenerator.generate(t.html);
  }
  console.log('   ✔ Préchauffage terminé (Caches JIT et typographiques amorcés).\n');

  // 2. Mesures Mono-Thread : Synthétiques & Réels
  const benchmarkResults: BenchmarkItemResult[] = [];
  const ITERATIONS = 10;

  console.log('--------------------------------------------------------------------');
  console.log('📊 1. BENCHMARKS MONO-THREAD (LATENCE ET DÉBIT PAR DOCUMENT)');
  console.log('--------------------------------------------------------------------');

  const allDatasets = [
    ...syntheticDatasets.map((d) => ({ ...d, label: d.name })),
    ...realWorldTemplates.map((t) => ({
      name: t.label,
      html: t.html,
      css: '',
      category: 'Template Réel' as const,
      label: t.label,
    })),
  ];

  for (const ds of allDatasets) {
    const times: number[] = [];
    let lastSize = 0;
    const memBefore = getHeapMemoryMB();

    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const pdf = await singleGenerator.generate(ds.html, { css: ds.css });
      const duration = performance.now() - t0;
      times.push(duration);
      lastSize = pdf.length;
    }

    const memAfter = getHeapMemoryMB();
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const throughput = 1000 / avg;
    const sizeKb = lastSize / 1024;
    const heapDelta = Math.max(0, memAfter - memBefore);

    benchmarkResults.push({
      scenario: ds.name,
      category: ds.category,
      minMs: min,
      avgMs: avg,
      maxMs: max,
      sizeKb,
      throughputDocsSec: throughput,
      heapDeltaMb: heapDelta,
    });

    console.log(
      `  • [${ds.category.padEnd(14)}] ${ds.name.padEnd(38)} : Moyenne ${avg.toFixed(2).padStart(6)} ms | Min ${min.toFixed(2).padStart(6)} ms | Débit ${throughput.toFixed(1).padStart(5)} doc/s | Taille ${sizeKb.toFixed(1).padStart(5)} KB`,
    );
  }

  // 3. Test de Concurrence & Débit Multi-Thread (WorkerPool)
  console.log('\n--------------------------------------------------------------------');
  console.log('⚡ 2. TEST DE CONCURRENCE PAR LOT : MONO-THREAD vs WORKER POOL');
  console.log('--------------------------------------------------------------------');

  const BATCH_SIZE = 50;
  const sampleHtmls: string[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    const ds = allDatasets[i % allDatasets.length];
    if (ds) sampleHtmls.push(ds.html);
  }

  // Pre-initialize Worker Pool and warm it up
  const poolGenerator = createPdfGenerator({
    useWorkerPool: true,
    cpuRatio: 0.8,
  });
  const workerCount = poolGenerator.getMaxWorkers();
  console.log(`  🔥 Préchauffage du Worker Pool (${workerCount} workers)...`);
  // Fire 1 quick task per worker to warm up threads
  await Promise.all(Array.from({ length: workerCount }, () => poolGenerator.generate('<p>Warmup Worker</p>')));
  console.log(`     ✔ Worker Pool chaud et opérationnel.\n`);

  // Run A: Single-Thread Batch
  console.log(`  ⏳ Traitement du lot de ${BATCH_SIZE} documents en Mono-Thread...`);
  const stStart = performance.now();
  await Promise.all(sampleHtmls.map((html) => singleGenerator.generate(html)));
  const stDuration = performance.now() - stStart;
  const stThroughput = BATCH_SIZE / (stDuration / 1000);
  console.log(`     ✔ Mono-Thread terminé en : ${stDuration.toFixed(1)} ms (${stThroughput.toFixed(1)} docs/sec)`);

  // Run B: Multi-Thread Worker Pool Batch
  console.log(`  ⏳ Traitement du lot de ${BATCH_SIZE} documents avec Worker Pool (${workerCount} workers)...`);
  const mtStart = performance.now();
  await Promise.all(sampleHtmls.map((html) => poolGenerator.generate(html)));
  const mtDuration = performance.now() - mtStart;
  const mtThroughput = BATCH_SIZE / (mtDuration / 1000);
  const speedup = mtThroughput / stThroughput;

  console.log(`     ✔ Multi-Thread terminé en : ${mtDuration.toFixed(1)} ms (${mtThroughput.toFixed(1)} docs/sec)`);
  console.log(`     🚀 Accélération Worker Pool : x${speedup.toFixed(2)} plus rapide\n`);

  await poolGenerator.terminateWorkerPool();

  const batchResult: BatchBenchmarkResult = {
    batchSize: BATCH_SIZE,
    singleThreadDurationMs: stDuration,
    singleThreadThroughput: stThroughput,
    multiThreadDurationMs: mtDuration,
    multiThreadThroughput: mtThroughput,
    speedup,
    workerCount,
  };

  // 4. Générer le rapport Markdown complet dans docs/benchmark.md
  generateBenchmarkReport(benchmarkResults, batchResult, {
    cpuModel,
    cpuCount,
    nodeVersion: process.version,
    osPlatform: `${os.type()} ${os.release()} (${os.arch()})`,
    totalMemoryGb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
  });
}

function generateBenchmarkReport(
  results: BenchmarkItemResult[],
  batchResult: BatchBenchmarkResult,
  sysInfo: { cpuModel: string; cpuCount: number; nodeVersion: string; osPlatform: string; totalMemoryGb: string },
) {
  const reportPath = path.resolve(rootDir, 'docs/benchmark.md');
  const date = new Date().toISOString().split('T')[0];

  const synthetics = results.filter((r) => r.category === 'Synthétique');
  const realTemplates = results.filter((r) => r.category === 'Template Réel');

  let md = `# 📊 Rapport de Benchmark & Performances — v2.0.0

> **Date d'exécution** : ${date}  
> **Environnement Système** : Node.js ${sysInfo.nodeVersion} — ${sysInfo.osPlatform}  
> **Processeur Hôte** : ${sysInfo.cpuModel} (${sysInfo.cpuCount} cœurs logiques)  
> **Mémoire Système** : ${sysInfo.totalMemoryGb} GB RAM  
> **Module testé** : \`pdf-generator\` (Stack OXC + TypeScript)

---

## 🎯 Objectif du Benchmark

Ce benchmark évalue les performances réelles du moteur \`pdf-generator\` v2.0.0 sous deux axes majeurs :
1. **Latence unitaire et débit mono-thread** sur des charges synthétiques stressantes et des modèles professionnels réels.
2. **Scalabilité multi-thread via le Worker Thread Pool** élastique avec transfert binaire zéro-copie (\`Transferable ArrayBuffer\`).

---

## ⚡ 1. Performances Mono-Thread (Latence Unitaire & Débit)

Les mesures ci-dessous ont été obtenues après amorçage des caches mémoires (\`WeakMap\` styles, \`TextMeasureCache\` LRU, et caches typographiques).

### 📋 Charges Synthétiques de Stress

| Scénario d'essai | Latence Min | Latence Moyenne | Latence Max | Débit Unitaire | Taille PDF |
|---|:---:|:---:|:---:|:---:|:---:|
`;

  for (const r of synthetics) {
    md += `| **${r.scenario}** | ${r.minMs.toFixed(2)} ms | **${r.avgMs.toFixed(2)} ms** | ${r.maxMs.toFixed(2)} ms | ~${r.throughputDocsSec.toFixed(1)} docs/s | ${r.sizeKb.toFixed(1)} KB |\n`;
  }

  md += `
### 🎨 Modèles Professionnels Réels (\`demo/templates/\`)

| Modèle HTML/CSS | Latence Min | Latence Moyenne | Latence Max | Débit Unitaire | Taille PDF |
|---|:---:|:---:|:---:|:---:|:---:|
`;

  for (const r of realTemplates) {
    md += `| **${r.scenario}** | ${r.minMs.toFixed(2)} ms | **${r.avgMs.toFixed(2)} ms** | ${r.maxMs.toFixed(2)} ms | ~${r.throughputDocsSec.toFixed(1)} docs/s | ${r.sizeKb.toFixed(1)} KB |\n`;
  }

  md += `
---

## 🚀 2. Scalabilité Multi-Thread (Worker Pool vs Mono-Thread)

Comparatif lors de la génération concurrente d'un lot de **${batchResult.batchSize} documents** hétérogènes :

| Mode d'Exécution | Unités d'Exécution | Durée Totale (Lot de ${batchResult.batchSize}) | Débit Global (Throughput) | Facteur d'Accélération |
|---|:---:|:---:|:---:|:---:|
| **Mono-Thread** (Event Loop principal) | 1 thread | ${batchResult.singleThreadDurationMs.toFixed(1)} ms | ${batchResult.singleThreadThroughput.toFixed(1)} docs/seconde | Référence (1.0x) |
| **Worker Pool Élastique** (80% CPU) | **${batchResult.workerCount} threads** | **${batchResult.multiThreadDurationMs.toFixed(1)} ms** | **${batchResult.multiThreadThroughput.toFixed(1)} docs/seconde** | **x${batchResult.speedup.toFixed(2)} plus rapide** |

> [!TIP]
> **Zéro-Copie IPC** : Les transferts binaires entre les workers et le thread principal s'effectuent via \`ArrayBuffer.transfer\` / \`Transferable\`. Aucun coût de sérialisation JSON ou de copie mémoire n'est encouru lors du rapatriement des buffers PDF.

---

## 🔬 Architecture des Optimisations Actives

Toutes les optimisations de la version 2.0 sont désormais natives dans le code de production :

1. **Rendu en Passe Unique (Single-Pass AST)** :
   - Le DOM Cheerio est parsé une seule fois.
   - La seconde passe de comptage de pages n'est déclenchée que si le document CSS utilise explicitement \`counter(num-pages)\`.
2. **Caches Mémoire à Haute Efficacité** :
   - \`WeakMap\` pour le parsing des styles inline : garbage-collecté automatiquement sans aucune fuite mémoire.
   - \`TextMeasureCache\` (LRU borné à 512 entrées) : évite le recalcul des glyphes typographiques répétitifs.
   - Cache partagé des polices et images distantes par document.
3. **Pool Élastique de Worker Threads** :
   - **0 thread au repos** (~116 MB résiduel).
   - Démarrage instantané à la demande avec limitation CPU paramétrable (\`cpuRatio: 0.5\` ou \`0.8\`).
   - Arrêt automatique des workers inactifs après 10s pour restituer la RAM à l'OS.
4. **Protocole de Nettoyage Automatique** :
   - Implémentation native de \`Symbol.asyncDispose\` pour une syntaxe \`await using generator = createPdfGenerator(...)\` sous Node.js ≥ 22.

---

## 📈 Rapport d'Endurance (Soak Tests)

Des tests d'endurance de longue durée sont également disponibles dans le dossier \`bench/\` :
- \`npm run test:soak\` : Test de répétition séquentielle (200 PDFs) pour la stabilité du Heap.
- \`npm run test:soak:parallel\` : Test de charge de **15 000 PDFs** en concurrence régulée à 80% CPU (~267 PDFs/seconde avec RSS stabilisé).
`;

  fs.writeFileSync(reportPath, md, 'utf-8');
  console.log(`====================================================================`);
  console.log(`✅ Rapport de benchmark mis à jour avec succès :`);
  console.log(`   📄 ${reportPath}`);
  console.log(`====================================================================\n`);
}

runBenchmarks().catch(console.error);
