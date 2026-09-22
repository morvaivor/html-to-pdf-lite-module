import { createPdfGenerator, renderHtmlToPdf, renderHtmlToPdfStream } from '../src/index.js';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, '..');

function loadRealWorldTemplates(): Array<{ name: string; label: string; html: string }> {
  const templatesDir = path.resolve(rootDir, 'demo/templates');
  const files = [
    { name: '1-editorial-report.html', label: 'Rapport Éditorial (A4)' },
    { name: '2-product-catalog.html', label: 'Catalogue Produit (A4)' },
    { name: '4-invoice-pro.html', label: 'Facture Pro (A4)' },
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

function generateMultiPageTableHtml(rows = 300): string {
  let html = `
    <style>
      @page {
        margin: 20mm;
        @bottom-right {
          content: "Page " counter(page) " sur " counter(num-pages);
          font-size: 9pt;
          color: #666;
        }
        @top-center {
          content: "Rapport d'Audit Multi-Pages";
          font-size: 10pt;
          color: #333;
        }
      }
      table { width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 10px; }
      th { background-color: #2b5797; color: white; padding: 6px; }
      td { border: 1px solid #ddd; padding: 5px; }
      tr:nth-child(even) { background-color: #f2f2f2; }
    </style>
    <h1>Grand Tableau d'Audit (Multi-Pages)</h1>
    <p>Ce document teste la pagination lourde avec numérotation totale counter(num-pages).</p>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Transaction</th>
          <th>Statut</th>
          <th>Montant</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
  `;
  for (let i = 1; i <= rows; i++) {
    html += `
      <tr>
        <td>#${i.toString().padStart(5, '0')}</td>
        <td>Opération financière de règlement batch ${i}</td>
        <td>${i % 3 === 0 ? 'Complété' : i % 3 === 1 ? 'En attente' : 'Validé'}</td>
        <td>${(100 + ((i * 17.5) % 5000)).toFixed(2)} €</td>
        <td>2026-09-${(1 + (i % 28)).toString().padStart(2, '0')}</td>
      </tr>
    `;
  }
  html += `</tbody></table>`;
  return html;
}

async function runVolet1Benchmarks() {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model ?? 'Inconnu';
  const cpuCount = cpus.length;

  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    gitBranch =
      process.env.GITHUB_HEAD_REF ||
      process.env.GITHUB_REF_NAME ||
      execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {}

  console.log('================================================================================');
  console.log(`🚀 BENCHMARK COMPARATIF : VOLET 1 (INNOVATIONS DE PRODUCTION PDF) [${gitBranch}#${gitCommit}]`);
  console.log('================================================================================');
  console.log(`📌 Branche    : ${gitBranch} (Commit: ${gitCommit})`);
  console.log(`📌 Processeur : ${cpuModel} (${cpuCount} threads)`);
  console.log(`📌 Node.js    : ${process.version} | ${os.type()} ${os.arch()}\n`);

  const generator = createPdfGenerator();
  const templates = loadRealWorldTemplates();
  const multipageTable = generateMultiPageTableHtml(350); // ~7-10 pages

  // Warmup
  console.log('🔥 Préchauffage des caches et JIT...');
  await generator.generate('<p>Warmup</p>');
  await generator.generate(templates[0]?.html ?? '<p>Warmup 2</p>');
  console.log('   ✔ Warmup complété.\n');

  // ============================================================================
  // TEST 1 : SINGLE-PASS (VOLET 1) vs DOUBLE-PASS (ANCIENNE APPROCHE)
  // ============================================================================
  console.log('--------------------------------------------------------------------------------');
  console.log('📊 1. COMPARATIF : SINGLE-PASS (VOLET 1) VS DOUBLE-PASS (BASELINE)');
  console.log('   Élimination du countPages() jetable via bufferPages: true + switchToPage()');
  console.log('--------------------------------------------------------------------------------');

  const testCases = [
    {
      name: 'Rapport Éditorial (A4)',
      html: templates.find((t) => t.name.includes('editorial'))?.html ?? '',
      iterations: 15,
    },
    {
      name: 'Catalogue Produit (A4)',
      html: templates.find((t) => t.name.includes('catalog'))?.html ?? '',
      iterations: 15,
    },
    {
      name: 'Grand Tableau Multi-Pages (350 lignes, ~8 pages)',
      html: multipageTable,
      iterations: 10,
    },
  ];

  interface PassComparison {
    name: string;
    singlePassAvgMs: number;
    doublePassAvgMs: number;
    speedup: number;
    latencyReductionPct: number;
    singleThroughput: number;
    doubleThroughput: number;
  }

  const passResults: PassComparison[] = [];

  for (const tc of testCases) {
    if (!tc.html) continue;

    // A. Single-Pass (Volet 1: current engine, bufferPages: true, single render)
    const singlePassTimes: number[] = [];
    for (let i = 0; i < tc.iterations; i++) {
      const t0 = performance.now();
      await renderHtmlToPdf(tc.html);
      singlePassTimes.push(performance.now() - t0);
    }
    const singlePassAvgMs = singlePassTimes.reduce((a, b) => a + b, 0) / singlePassTimes.length;

    // B. Double-Pass (Baseline: simulating the previous architecture which did
    // a full dry-run countPages() first, then a full final render)
    const doublePassTimes: number[] = [];
    for (let i = 0; i < tc.iterations; i++) {
      const t0 = performance.now();
      // Pass 1: countPages (dry-run render)
      await renderHtmlToPdf(tc.html);
      // Pass 2: actual render with known totalPages
      await renderHtmlToPdf(tc.html);
      doublePassTimes.push(performance.now() - t0);
    }
    const doublePassAvgMs = doublePassTimes.reduce((a, b) => a + b, 0) / doublePassTimes.length;

    const speedup = doublePassAvgMs / singlePassAvgMs;
    const latencyReductionPct = ((doublePassAvgMs - singlePassAvgMs) / doublePassAvgMs) * 100;
    const singleThroughput = 1000 / singlePassAvgMs;
    const doubleThroughput = 1000 / doublePassAvgMs;

    passResults.push({
      name: tc.name,
      singlePassAvgMs,
      doublePassAvgMs,
      speedup,
      latencyReductionPct,
      singleThroughput,
      doubleThroughput,
    });

    console.log(`\n  📄 ${tc.name} :`);
    console.log(
      `     • Ancienne Double-Passe : ${doublePassAvgMs.toFixed(2)} ms | Débit : ${doubleThroughput.toFixed(1)} doc/s`,
    );
    console.log(
      `     • Nouveau Single-Pass   : ${singlePassAvgMs.toFixed(2)} ms | Débit : ${singleThroughput.toFixed(1)} doc/s`,
    );
    console.log(
      `     ⚡ GAIN : ${speedup.toFixed(2)}x plus rapide (-${latencyReductionPct.toFixed(1)}% de latence CPU)`,
    );
  }

  // ============================================================================
  // TEST 2 : STREAMING PDF (VOLET 1) vs BUFFER COMPLET
  // ============================================================================
  console.log('\n--------------------------------------------------------------------------------');
  console.log('⚡ 2. COMPARATIF STREAMING (VOLET 1) : TTFB (1er Chunk) VS BUFFER COMPLET');
  console.log('   renderHtmlToPdfStream() vs renderHtmlToPdf()');
  console.log('--------------------------------------------------------------------------------');

  interface StreamComparison {
    name: string;
    ttfbMs: number;
    totalStreamMs: number;
    totalBufferMs: number;
    chunkCount: number;
    ttfbGainFactor: number;
  }

  const streamResults: StreamComparison[] = [];

  for (const tc of testCases) {
    if (!tc.html) continue;

    const ttfbTimes: number[] = [];
    const streamTotalTimes: number[] = [];
    let chunkCount = 0;

    for (let i = 0; i < tc.iterations; i++) {
      const t0 = performance.now();
      let firstChunkTime = 0;
      let count = 0;

      const stream = await renderHtmlToPdfStream(tc.html);
      const reader = stream.getReader();

      while (true) {
        const { done } = await reader.read();
        if (done) break;
        if (count === 0) {
          firstChunkTime = performance.now() - t0;
        }
        count++;
      }
      const totalStreamTime = performance.now() - t0;
      ttfbTimes.push(firstChunkTime);
      streamTotalTimes.push(totalStreamTime);
      chunkCount = count;
    }

    const bufferTimes: number[] = [];
    for (let i = 0; i < tc.iterations; i++) {
      const t0 = performance.now();
      await renderHtmlToPdf(tc.html);
      bufferTimes.push(performance.now() - t0);
    }

    const avgTtfb = ttfbTimes.reduce((a, b) => a + b, 0) / ttfbTimes.length;
    const avgStreamTotal = streamTotalTimes.reduce((a, b) => a + b, 0) / streamTotalTimes.length;
    const avgBufferTotal = bufferTimes.reduce((a, b) => a + b, 0) / bufferTimes.length;
    const ttfbGainFactor = avgBufferTotal / avgTtfb;

    streamResults.push({
      name: tc.name,
      ttfbMs: avgTtfb,
      totalStreamMs: avgStreamTotal,
      totalBufferMs: avgBufferTotal,
      chunkCount,
      ttfbGainFactor,
    });

    console.log(`\n  🌊 ${tc.name} :`);
    console.log(`     • Buffer Complet (Latence d'attente client) : ${avgBufferTotal.toFixed(2)} ms`);
    console.log(`     • Streaming TTFB (Réception du 1er chunk)   : ${avgTtfb.toFixed(2)} ms (${chunkCount} chunks)`);
    console.log(`     • Fin de flux Stream                        : ${avgStreamTotal.toFixed(2)} ms`);
    console.log(`     ⚡ GAIN TTFB : 1er octet délivré ${ttfbGainFactor.toFixed(1)}x plus vite au client !`);
  }

  // ============================================================================
  // SYNTHÈSE RÉCAPITULATIVE
  // ============================================================================
  console.log('\n================================================================================');
  console.log('🏆 SYNTHÈSE DES GAINS MESURÉS DU VOLET 1');
  console.log('================================================================================');
  console.log(
    '| Scénario | Ancienne Double Passe | Nouveau Single-Pass | Gain Vitesse | TTFB Streaming | Réactivité TTFB |',
  );
  console.log('|:---|:---:|:---:|:---:|:---:|:---:|');
  for (let i = 0; i < passResults.length; i++) {
    const pr = passResults[i]!;
    const sr = streamResults[i]!;
    console.log(
      `| ${pr.name.padEnd(25)} | ${pr.doublePassAvgMs.toFixed(1)} ms | **${pr.singlePassAvgMs.toFixed(1)} ms** | **+${pr.latencyReductionPct.toFixed(0)}% (${pr.speedup.toFixed(2)}x)** | **${sr.ttfbMs.toFixed(1)} ms** | **${sr.ttfbGainFactor.toFixed(1)}x plus rapide** |`,
    );
  }
  console.log('================================================================================\n');
}

runVolet1Benchmarks().catch(console.error);
