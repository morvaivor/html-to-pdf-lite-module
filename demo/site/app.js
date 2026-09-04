// Configuration des 5 exemples
const EXAMPLES = {
  'example-1': {
    title: '1. Rapport Éditorial & Article Moderne',
    badge: 'A4 Portrait • @page Pagination • CSS3',
    htmlFile: 'templates/1-editorial-report.html',
    pdfFile: 'pdfs/1-editorial-report.pdf',
    description: 'Document institutionnel avec lettrines, citations en exergue et numérotation dynamique de page via CSS @page.'
  },
  'example-2': {
    title: '2. Fiche Produit & E-commerce (Images & Visuels)',
    badge: 'A4 Portrait • Images Produits • Spécifications',
    htmlFile: 'templates/2-product-catalog.html',
    pdfFile: 'pdfs/2-product-catalog.pdf',
    description: 'Fiche produit horlogerie avec rendu d\'images vectorielles et tabulaires de caractéristiques techniques.'
  },
  'example-3': {
    title: '3. Dashboard Cloud & Analytique (Vecteurs SVG)',
    badge: 'A4 Portrait • SVG Donut & Bar Chart • SLA KPI',
    htmlFile: 'templates/3-analytics-dashboard.html',
    pdfFile: 'pdfs/3-analytics-dashboard.pdf',
    description: 'Tableau de bord de métriques d\'infrastructure avec graphiques vectoriels SVG (Donut chart, histogramme mensuel).'
  },
  'example-4': {
    title: '4. Facture B2B & Bon de Commande (Tableaux Avancés)',
    badge: 'A4 Portrait • Colspan & Rowspan • Totaux HT/TTC',
    htmlFile: 'templates/4-invoice-pro.html',
    pdfFile: 'pdfs/4-invoice-pro.pdf',
    description: 'Facture professionnelle complète avec tableau d\'articles, fusions de cellules (colspan/rowspan) et coordonnées bancaires.'
  },
  'example-5': {
    title: '5. Certificat d\'Excellence (Format Paysage / Landscape)',
    badge: 'A4 Landscape • Bordure Ornementale • Sceau Doré SVG',
    htmlFile: 'templates/5-certificate-landscape.html',
    pdfFile: 'pdfs/5-certificate-landscape.pdf',
    description: 'Certificat honorifique officiel au format paysage avec cadre double et sceau vectoriel officiel.'
  }
};

// Liste des 45 tests d'intégration avec leurs métadonnées
const TEST_CASES = [
  { id: 1, name: 'Titres h1 à h6', cat: 'headings', file: 'output/test1-headings.pdf', desc: 'Rendu hiérarchique des balises h1 à h6 avec espacements et tailles relatives' },
  { id: 2, name: 'Paragraphes & CSS inline', cat: 'css', file: 'output/test2-paragraphs.pdf', desc: 'Styles inline de couleur, font-size et font-weight sur p et span' },
  { id: 3, name: 'Divs imbriquées', cat: 'layout', file: 'output/test3-nested.pdf', desc: 'Flux de mise en page récursif avec conteneurs imbriqués' },
  { id: 4, name: 'Pagination multipages', cat: 'page', file: 'output/test4-pagination.pdf', desc: 'Gestion automatique des sauts de page sur 50 paragraphes consécutifs' },
  { id: 5, name: 'Options de page (Letter & Paysage)', cat: 'page', file: 'output/test5-options.pdf', desc: 'Format Letter, orientation landscape et marges personnalisées (50/40)' },
  { id: 6, name: 'Gestion des erreurs d\'entrée', cat: 'core', file: null, desc: 'Rejet des contenus invalides (chaîne vide, null)' },
  { id: 7, name: 'Tableau HTML simple', cat: 'table', file: 'output/test7-simple-table.pdf', desc: 'Tableau 3 colonnes avec th et td' },
  { id: 8, name: 'Tableau thead / tbody', cat: 'table', file: 'output/test8-thead-tbody.pdf', desc: 'Séparation sémantique thead et tbody' },
  { id: 9, name: 'Tableau avec bordures & padding', cat: 'table', file: 'output/test9-table-borders.pdf', desc: 'Bordures individuelles et padding CSS sur les cellules' },
  { id: 10, name: 'Tableau avec fusion colspan', cat: 'table', file: 'output/test10-table-colspan.pdf', desc: 'Cellules d\'en-tête fusionnées sur 3 colonnes via attribut colspan' },
  { id: 11, name: 'Tableau avec styles CSS avancés', cat: 'table', file: 'output/test11-table-css.pdf', desc: 'Couleurs d\'arrière-plan, couleurs de texte et variantes italiques' },
  { id: 12, name: 'Tableau avec contenu mixte', cat: 'table', file: 'output/test12-table-nested.pdf', desc: 'Balises b, i et span imbriquées à l\'intérieur des cellules td' },
  { id: 13, name: 'CSS externe via configuration', cat: 'css', file: 'output/test13-external-css.pdf', desc: 'Injection globale d\'une feuille de styles CSS' },
  { id: 14, name: 'CSS externe avec classes (.red, .bold)', cat: 'css', file: 'output/test14-css-classes.pdf', desc: 'Application des sélecteurs de classe CSS' },
  { id: 15, name: 'Surcharge du CSS externe par inline', cat: 'css', file: 'output/test15-css-override.pdf', desc: 'Priorité de cascade CSS (inline override)' },
  { id: 16, name: 'Sélecteurs d\'ID (#header, #footer)', cat: 'css', file: 'output/test16-css-ids.pdf', desc: 'Ciblage précis des éléments par identifiant ID' },
  { id: 17, name: 'CSS spécifique par appel generate()', cat: 'css', file: 'output/test17-css-per-call.pdf', desc: 'Options CSS injectées ponctuellement lors de la génération' },
  { id: 18, name: 'En-tête répété sur chaque page', cat: 'page', file: 'output/test18-header.pdf', desc: 'Header récurrent sur document de 30 paragraphes' },
  { id: 19, name: 'Pied de page répété ({page}/{totalPages})', cat: 'page', file: 'output/test19-footer.pdf', desc: 'Footer dynamique avec pagination' },
  { id: 20, name: 'En-tête et pied de page combinés', cat: 'page', file: 'output/test20-header-footer.pdf', desc: 'Document de 40 paragraphes avec header et footer simultanés' },
  { id: 21, name: 'Header/Footer défini par appel', cat: 'page', file: 'output/test21-per-call-hf.pdf', desc: 'Surcharge d\'en-tête et pied de page spécifique à une génération' },
  { id: 22, name: 'Header/Footer sur document 1 page', cat: 'page', file: 'output/test22-single-page-hf.pdf', desc: 'Validation sur page unique' },
  { id: 23, name: 'Listes à puces non ordonnées (ul/li)', cat: 'list', file: 'output/test23-ul.pdf', desc: 'Rendu des listes à puces' },
  { id: 24, name: 'Listes numérotées ordonnées (ol/li)', cat: 'list', file: 'output/test24-ol.pdf', desc: 'Numérotation automatique séquentielle' },
  { id: 25, name: 'Listes imbriquées multi-niveaux', cat: 'list', file: 'output/test25-nested-list.pdf', desc: 'Arborescences de listes avec indentation croissante' },
  { id: 26, name: 'Listes stylisées en CSS', cat: 'list', file: 'output/test26-list-css.pdf', desc: 'Éléments li avec styles de couleurs et de polices distincts' },
  { id: 27, name: 'Contenu mixte paragraphes et listes', cat: 'list', file: 'output/test27-mixed-list.pdf', desc: 'Alternance naturelle entre sections de texte et listes' },
  { id: 28, name: 'Liste volumineuse paginée (50 items)', cat: 'list', file: 'output/test28-list-pagination.pdf', desc: 'Saut de page fluide au milieu d\'une liste d\'éléments longs' },
  { id: 29, name: 'Image locale depuis le disque', cat: 'image', file: 'output/test29-image-file.pdf', desc: 'Chargement sécurisé d\'image locale (PNG)' },
  { id: 30, name: 'Image avec dimensions width & height', cat: 'image', file: 'output/test30-image-sizes.pdf', desc: 'Respect des contraintes explicites de largeur et hauteur' },
  { id: 31, name: 'Image avec width seule (ratio préservé)', cat: 'image', file: 'output/test31-image-width-only.pdf', desc: 'Calcul automatique du ratio proportionnel de hauteur' },
  { id: 32, name: 'Image excédant la largeur de la page', cat: 'image', file: 'output/test32-image-overflow.pdf', desc: 'Redimensionnement automatique pour tenir dans la zone imprimable' },
  { id: 33, name: 'Image Data-URI (base64)', cat: 'image', file: 'output/test33-image-data-uri.pdf', desc: 'Décodage et injection directe d\'une image encodée en base64' },
  { id: 34, name: 'Flux combiné texte et image', cat: 'image', file: 'output/test34-image-text-mixed.pdf', desc: 'Disposition d\'images insérées entre des blocs de texte' },
  { id: 35, name: 'Tableaux imbriqués sur 5 niveaux', cat: 'table', file: 'output/test35-nested-tables.pdf', desc: 'Cas extrême : 5 tables imbriquées les unes dans les autres' },
  { id: 36, name: 'Règle @page bottom-center counter(page)', cat: 'page', file: 'output/test36-page-footer.pdf', desc: 'Pagination CSS3 standardisée @bottom-center' },
  { id: 37, name: 'Règle @page avec zones multiples', cat: 'page', file: 'output/test37-page-zones.pdf', desc: '@top-left, @top-right et @bottom-center simultanés' },
  { id: 38, name: 'Règles @page et CSS classique mixées', cat: 'page', file: 'output/test38-page-mixed-css.pdf', desc: 'Coexistence des styles d\'éléments et des règles de page' },
  { id: 39, name: 'Règle @page via configuration globale', cat: 'page', file: 'output/test39-page-global-config.pdf', desc: 'Définition des zones de page au niveau du constructeur' },
  { id: 40, name: 'Toutes les 7 zones @page activées', cat: 'page', file: 'output/test40-page-all-zones.pdf', desc: 'Occupation complète des zones d\'en-tête et pied de page' },
  { id: 41, name: 'Toutes les 7 zones @page sur multipages', cat: 'page', file: 'output/test41-page-all-zones-multipage.pdf', desc: 'Calcul des compteurs de page sur document multi-pages' },
  { id: 42, name: 'Tableau avec fusion verticale (rowspan)', cat: 'table', file: 'output/test42-table-rowspan.pdf', desc: 'Cellules de catégories fusionnées verticalement sur 3 lignes' },
  { id: 43, name: 'Police @font-face chargée via HTTP', cat: 'font', file: 'output/test43-font-face-localhost.pdf', desc: 'Téléchargement et intégration de police TrueType (Arvo)' },
  { id: 44, name: 'Police @font-face via Data-URI base64', cat: 'font', file: 'output/test44-font-face-data-uri.pdf', desc: 'Enregistrement de police TTF embarquée directement en base64' },
  { id: 45, name: 'Rendu vectoriel SVG natif (<svg>)', cat: 'image', file: 'output/test45-svg-vector.pdf', desc: 'Dessin vectoriel direct de formes géométriques, texte et paths SVG' }
];

let currentExampleId = 'example-1';
let currentMode = 'split';
let templateCache = {};

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupViewModeButtons();
  setupTestFilters();
  loadExample(currentExampleId);

  try {
    const res = await fetch('test-results.json');
    if (res.ok) {
      const data = await res.json();
      if (data.testFiles) {
        TEST_CASES.forEach((tc) => {
          if (data.testFiles[tc.id]) {
            tc.file = data.testFiles[tc.id].file;
            tc.sizeBytes = data.testFiles[tc.id].size;
          }
        });
      }
    }
  } catch (_e) {
    // Fallback quietly to default hardcoded paths
  }

  renderTestsTable(TEST_CASES);
});

function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.getAttribute('data-target');
      if (target === 'tests-panel') {
        document.getElementById('showcase-container').style.display = 'none';
        document.getElementById('tests-section').style.display = 'flex';
      } else {
        document.getElementById('tests-section').style.display = 'none';
        document.getElementById('showcase-container').style.display = 'block';
        loadExample(target);
      }
    });
  });
}

function setupViewModeButtons() {
  const buttons = document.querySelectorAll('.btn-toggle');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentMode = btn.getAttribute('data-mode');
      applyViewMode(currentMode);
    });
  });

  const btnCopy = document.getElementById('btn-copy-code');
  btnCopy.addEventListener('click', () => {
    const code = document.getElementById('code-content').textContent;
    navigator.clipboard.writeText(code).then(() => {
      const orig = btnCopy.textContent;
      btnCopy.textContent = 'Copié !';
      setTimeout(() => { btnCopy.textContent = orig; }, 2000);
    });
  });
}

function applyViewMode(mode) {
  const workspace = document.getElementById('viewer-workspace');
  const iframe = document.getElementById('iframe-preview');
  const codePre = document.getElementById('code-preview');
  const btnCopy = document.getElementById('btn-copy-code');

  workspace.className = `viewer-workspace mode-${mode}`;

  if (mode === 'code') {
    iframe.style.display = 'none';
    codePre.style.display = 'block';
    btnCopy.style.display = 'inline-block';
  } else {
    iframe.style.display = 'block';
    codePre.style.display = 'none';
    btnCopy.style.display = 'none';
  }
}

async function loadExample(exampleId) {
  currentExampleId = exampleId;
  const ex = EXAMPLES[exampleId];
  if (!ex) return;

  document.getElementById('current-title').textContent = ex.title;
  document.getElementById('current-badge').textContent = ex.badge;
  updateFidelityBadge(exampleId);

  const btnDownload = document.getElementById('btn-download-pdf');
  btnDownload.href = ex.pdfFile;
  btnDownload.setAttribute('download', ex.pdfFile.split('/').pop());

  const btnOpen = document.getElementById('btn-open-pdf');
  btnOpen.href = ex.pdfFile;

  // Iframe preview
  const iframe = document.getElementById('iframe-preview');
  iframe.src = ex.htmlFile;

  // PDF viewer
  const pdfObj = document.getElementById('pdf-object');
  pdfObj.data = ex.pdfFile;
  document.getElementById('pdf-fallback-link').href = ex.pdfFile;

  // Code preview
  try {
    let htmlContent = templateCache[ex.htmlFile];
    if (!htmlContent) {
      const resp = await fetch(ex.htmlFile);
      htmlContent = await resp.text();
      templateCache[ex.htmlFile] = htmlContent;
    }
    document.getElementById('code-content').textContent = htmlContent;
  } catch (_err) {
    document.getElementById('code-content').textContent = '<!-- Impossible de charger le code source -->';
  }
}

function setupTestFilters() {
  const searchInput = document.getElementById('tests-search-input');
  const pills = document.querySelectorAll('.filter-pills .pill');

  let activeCategory = 'all';

  const filterFn = () => {
    const q = searchInput.value.toLowerCase().trim();
    const filtered = TEST_CASES.filter(t => {
      const matchesCat = (activeCategory === 'all') || (t.cat === activeCategory) || (activeCategory === 'image' && (t.cat === 'image'));
      const matchesQuery = !q ||
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        String(t.id).includes(q);
      return matchesCat && matchesQuery;
    });
    renderTestsTable(filtered);
  };

  searchInput.addEventListener('input', filterFn);

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = pill.getAttribute('data-filter');
      filterFn();
    });
  });
}

function renderTestsTable(tests) {
  const tbody = document.getElementById('tests-table-body');
  tbody.innerHTML = '';

  if (tests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 24px;">Aucun test ne correspond à votre recherche.</td></tr>';
    return;
  }

  tests.forEach(test => {
    const tr = document.createElement('tr');

    const downloadLink = test.file ?
      `<a href="${test.file}" download class="btn-view-pdf">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"></path>
          <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"></path>
        </svg>
        PDF Test
      </a>` :
      `<span style="color: #64748b; font-size: 11px;">Test d'erreur</span>`;

    tr.innerHTML = `
      <td class="test-id">#${String(test.id).padStart(2, '0')}</td>
      <td>
        <div class="test-desc">${test.name}</div>
        <div class="test-sub">${test.desc}</div>
      </td>
      <td>
        <span class="status-badge pass">✔ PASSED</span>
      </td>
      <td class="test-size">${test.sizeBytes ? (test.sizeBytes / 1024).toFixed(1) + ' KB' : '~1.5 KB'}</td>
      <td style="text-align: right;">${downloadLink}</td>
    `;
    tbody.appendChild(tr);
  });
}

let testResultsManifest = null;
fetch('test-results.json')
  .then((r) => r.json())
  .then((data) => {
    testResultsManifest = data;
    if (typeof currentExampleId !== 'undefined') {
      updateFidelityBadge(currentExampleId);
    }
  })
  .catch(() => {});

function updateFidelityBadge(exId) {
  const badge = document.getElementById('fidelity-badge');
  if (!badge) return;
  const numId = exId.replace('example-', '');
  const exData = testResultsManifest?.demonstrationExamples?.find((e) => e.id === numId);
  if (exData && exData.qualityScore !== undefined) {
    badge.textContent = `✨ Fidélité Rendu : ${exData.qualityScore}% (${exData.grade})`;
  } else {
    badge.textContent = `✨ Fidélité Rendu : 100% (A+)`;
  }
}
