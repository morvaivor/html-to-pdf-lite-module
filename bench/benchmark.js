import { createPdfGenerator } from '../src/index.js';
import { performance } from 'perf_hooks';

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

const scenarios = [
  {
    name: 'Simple HTML (Headings & Paragraphs)',
    iterations: 50,
    getHtml: () => `
      <h1>Rapport de Benchmark</h1>
      <p style="font-size: 14px; color: #333;">Ceci est un document simple de test pour mesurer les performances de base du générateur PDF.</p>
      <p style="font-weight: bold; color: #0066cc;">Texte mis en évidence</p>
      <span>Pied de note textuel</span>
    `,
  },
  {
    name: 'Tableau HTML (10 lignes avec bordures & styles)',
    iterations: 30,
    getHtml: () => `
      <h2>Tableau de données</h2>
      <table style="border: 1px solid #cccccc; padding: 4px;">
        <thead>
          <tr>
            <th style="border: 1px solid #000; padding: 4px;">ID</th>
            <th style="border: 1px solid #000; padding: 4px;">Nom</th>
            <th style="border: 1px solid #000; padding: 4px;">Valeur</th>
            <th style="border: 1px solid #000; padding: 4px;">Statut</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from({ length: 10 }, (_, i) => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 4px;">#${i + 1}</td>
              <td style="border: 1px solid #ddd; padding: 4px;">Élément ${i + 1}</td>
              <td style="border: 1px solid #ddd; padding: 4px;">${(i + 1) * 150} €</td>
              <td style="border: 1px solid #ddd; padding: 4px; color: ${i % 2 === 0 ? 'green' : 'blue'};">Actif</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `,
  },
  {
    name: 'Document Complexe (@page zones + CSS externe)',
    iterations: 25,
    options: {
      css: `
        h1 { color: #1a1a2e; font-size: 24px; }
        p { font-size: 12px; color: #333333; }
        @page {
          @top-left { content: "Rapport Automatisé"; font-size: 8px; color: #666; }
          @top-right { content: "Confidentiel"; font-size: 8px; color: #999; }
          @bottom-center { content: "Page " counter(page) " sur " counter(num-pages); font-size: 8px; }
        }
      `,
    },
    getHtml: () => `
      <h1>Document avec Règles CSS & @page</h1>
      <p>Test d'évaluation du traitement des sélecteurs CSS et des zones de pages dynamiques avec compteurs.</p>
      <ul>
        <li>Élément de liste 1</li>
        <li>Élément de liste 2 avec <b>texte en gras</b></li>
        <li>Élément de liste 3</li>
      </ul>
    `,
  },
  {
    name: 'Document Multi-pages Volumineux (80 paragraphes)',
    iterations: 15,
    getHtml: () => `
      <h1>Rapport Volumineux</h1>
      ${Array.from({ length: 80 }, (_, i) => `
        <p>Paragraphe ${i + 1} - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
      `).join('')}
    `,
  },
];

async function runBenchmark() {
  console.log('====================================================');
  console.log('   🚀 Suite de Benchmarks - HTML to PDF Generator  ');
  console.log('====================================================\n');

  const results = [];

  for (const scenario of scenarios) {
    console.log(`⏳ Exécution : ${scenario.name} (${scenario.iterations} itérations)...`);

    // Warmup
    for (let i = 0; i < 3; i++) {
      await generator.generate(scenario.getHtml(), scenario.options);
    }

    if (global.gc) global.gc();
    const startMemory = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    let lastSize = 0;
    for (let i = 0; i < scenario.iterations; i++) {
      const buffer = await generator.generate(scenario.getHtml(), scenario.options);
      lastSize = buffer.length;
    }

    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;

    const totalTimeMs = endTime - startTime;
    const avgTimeMs = totalTimeMs / scenario.iterations;
    const opsPerSec = (1000 / avgTimeMs).toFixed(2);
    const heapDiffMb = ((endMemory - startMemory) / (1024 * 1024)).toFixed(2);

    results.push({
      Scenario: scenario.name,
      'Total (ms)': totalTimeMs.toFixed(2),
      'Moy. (ms)': avgTimeMs.toFixed(2),
      'Ops/sec': opsPerSec,
      'Taille PDF': `${(lastSize / 1024).toFixed(1)} KB`,
      'Delta Heap': `${heapDiffMb} MB`,
    });
  }

  console.log('\n====================================================');
  console.log('               📊 RÉSULTATS DU BENCHMARK            ');
  console.log('====================================================');
  console.table(results);
  console.log('====================================================\n');
}

runBenchmark().catch((err) => {
  console.error('❌ Échec du benchmark :', err);
  process.exit(1);
});
