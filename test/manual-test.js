import { createPdfGenerator } from '../src/index.js';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let fileIdx = 0;

async function savePdf(path, buffer) {
  const newPath = path.replace('.pdf', `_${++fileIdx}.pdf`);
  await sleep(100);
  try {
    writeFileSync(newPath, buffer);
  } catch {
    const fallbackPath = path.replace('.pdf', `_${Date.now()}.pdf`);
    writeFileSync(fallbackPath, buffer);
    console.log('  (fallback) Saved ' + fallbackPath);
    return fallbackPath;
  }
  return newPath;
}

async function runTests() {
  console.log('=== Test 1: Headings ===');
  const pdf1 = await generator.generate('<h1>Hello World</h1>');
  console.log('  Buffer size: ' + pdf1.length + ' bytes');
  mkdirSync('output', { recursive: true });
  writeFileSync('output/test1-headings.pdf', pdf1);
  console.log('  Saved output/test1-headings.pdf\n');

  console.log('=== Test 2: Paragraphs + inline CSS ===');
  const pdf2 = await generator.generate(`
    <h1 style="color: #333333;">Rapport</h1>
    <p style="font-size: 14px; color: #666666;">Ceci est un paragraphe de test.</p>
    <p style="font-weight: bold; color: #ff0000;">Texte rouge en gras</p>
    <span style="font-size: 10px;">Petit texte</span>
  `);
  console.log('  Buffer size: ' + pdf2.length + ' bytes');
  writeFileSync('output/test2-paragraphs.pdf', pdf2);
  console.log('  Saved output/test2-paragraphs.pdf\n');

  console.log('=== Test 3: Nested divs ===');
  const pdf3 = await generator.generate(`
    <div>
      <h2>Section 1</h2>
      <p>Premier paragraphe</p>
      <div>
        <p>Div imbriquée</p>
        <span>Span dans la div</span>
      </div>
    </div>
    <div>
      <h2>Section 2</h2>
      <p>Deuxième paragraphe</p>
    </div>
  `);
  console.log('  Buffer size: ' + pdf3.length + ' bytes');
  writeFileSync('output/test3-nested.pdf', pdf3);
  console.log('  Saved output/test3-nested.pdf\n');

  console.log('=== Test 4: Pagination ===');
  let content = '<h1>Rapport Long</h1>';
  for (let i = 0; i < 50; i++) {
    content += '<p>Paragraphe ' + i + ' - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>';
  }
  const pdf4 = await generator.generate(content);
  console.log('  Buffer size: ' + pdf4.length + ' bytes');
  writeFileSync('output/test4-pagination.pdf', pdf4);
  console.log('  Saved output/test4-pagination.pdf\n');

  console.log('=== Test 5: Options (Letter, landscape, custom margins) ===');
  const pdf5 = await generator.generate('<h1>Landscape Letter</h1><p>Test with custom options</p>', {
    format: 'Letter',
    orientation: 'landscape',
    margin: { top: 50, bottom: 50, left: 40, right: 40 },
  });
  console.log('  Buffer size: ' + pdf5.length + ' bytes');
  writeFileSync('output/test5-options.pdf', pdf5);
  console.log('  Saved output/test5-options.pdf\n');

  console.log('=== Test 6: Error handling ===');
  try {
    await generator.generate('');
    console.log('  FAILED: Should have thrown');
    process.exit(1);
  } catch (e) {
    console.log('  OK: ' + e.message);
  }

  try {
    await generator.generate(null);
    console.log('  FAILED: Should have thrown');
    process.exit(1);
  } catch (e) {
    console.log('  OK: ' + e.message);
  }

  console.log('\n=== Test 7: Simple table ===');
  const pdf7 = await generator.generate(`
    <table>
      <tr><th>Nom</th><th>Prénom</th><th>Âge</th></tr>
      <tr><td>John</td><td>Doe</td><td>30</td></tr>
      <tr><td>Jane</td><td>Smith</td><td>25</td></tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf7.length + ' bytes');
  writeFileSync('output/test7-simple-table.pdf', pdf7);
  console.log('  Saved output/test7-simple-table.pdf\n');

  console.log('=== Test 8: Table with thead/tbody ===');
  const pdf8 = await generator.generate(`
    <table>
      <thead>
        <tr><th>Col1</th><th>Col2</th></tr>
      </thead>
      <tbody>
        <tr><td>A</td><td>B</td></tr>
        <tr><td>C</td><td>D</td></tr>
      </tbody>
    </table>
  `);
  console.log('  Buffer size: ' + pdf8.length + ' bytes');
  writeFileSync('output/test8-thead-tbody.pdf', pdf8);
  console.log('  Saved output/test8-thead-tbody.pdf\n');

  console.log('=== Test 9: Table with borders and padding ===');
  const pdf9 = await generator.generate(`
    <table style="border: 1px solid #000000; padding: 5px;">
      <tr><td style="border: 1px solid #000000; padding: 8px;">Cell 1</td><td style="border: 1px solid #000000; padding: 8px;">Cell 2</td></tr>
      <tr><td style="border: 1px solid #000000; padding: 8px;">Cell 3</td><td style="border: 1px solid #000000; padding: 8px;">Cell 4</td></tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf9.length + ' bytes');
  writeFileSync('output/test9-table-borders.pdf', pdf9);
  console.log('  Saved output/test9-table-borders.pdf\n');

  console.log('=== Test 10: Table with colspan ===');
  const pdf10 = await generator.generate(`
    <table>
      <tr><th colspan="3">En-tête large</th></tr>
      <tr><td>A</td><td>B</td><td>C</td></tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf10.length + ' bytes');
  writeFileSync('output/test10-table-colspan.pdf', pdf10);
  console.log('  Saved output/test10-table-colspan.pdf\n');

  console.log('=== Test 11: Table with CSS styling ===');
  const pdf11 = await generator.generate(`
    <table>
      <tr><th style="color: #ffffff; background-color: #333333; font-weight: bold;">Titre</th></tr>
      <tr><td style="color: #ff0000; font-size: 14px;">Texte rouge</td></tr>
      <tr><td style="font-style: italic; font-size: 10px;">Petit italique</td></tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf11.length + ' bytes');
  writeFileSync('output/test11-table-css.pdf', pdf11);
  console.log('  Saved output/test11-table-css.pdf\n');

  console.log('=== Test 12: Table with nested content ===');
  const pdf12 = await generator.generate(`
    <table>
      <tr><td><b>Gras</b> et <i>italique</i></td><td><span style="color: blue;">Bleu</span></td></tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf12.length + ' bytes');
  writeFileSync('output/test12-table-nested.pdf', pdf12);
  console.log('  Saved output/test12-table-nested.pdf\n');

  console.log('\n=== Test 13: External CSS via config ===');
  const generatorWithCSS = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    css: `
      h1 { color: #333333; font-size: 28px; }
      h2 { color: #555555; font-size: 22px; }
      p { color: #666666; font-size: 14px; }
    `,
  });
  const pdf13 = await generatorWithCSS.generate(`
    <h1>Titre principal</h1>
    <h2>Sous-titre</h2>
    <p>Paragraphe de test</p>
  `);
  console.log('  Buffer size: ' + pdf13.length + ' bytes');
  writeFileSync('output/test13-external-css.pdf', pdf13);
  console.log('  Saved output/test13-external-css.pdf\n');

  console.log('=== Test 14: External CSS with classes ===');
  const generatorWithClassCSS = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    css: `
      .red { color: #ff0000; }
      .bold-text { font-weight: bold; }
      .small { font-size: 10px; }
    `,
  });
  const pdf14 = await generatorWithClassCSS.generate(`
    <p class="red bold-text">Texte rouge en gras</p>
    <span class="small">Texte petit</span>
  `);
  console.log('  Buffer size: ' + pdf14.length + ' bytes');
  writeFileSync('output/test14-css-classes.pdf', pdf14);
  console.log('  Saved output/test14-css-classes.pdf\n');

  console.log('=== Test 15: Inline CSS overrides external CSS ===');
  const generatorOverride = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    css: `
      p { color: #0000ff; font-size: 20px; }
    `,
  });
  const pdf15 = await generatorOverride.generate(`
    <p>Paragraphe bleu (CSS externe)</p>
    <p style="color: #ff0000;">Paragraphe rouge (inline override)</p>
    <p style="font-size: 10px;">Petit (inline override)</p>
  `);
  console.log('  Buffer size: ' + pdf15.length + ' bytes');
  writeFileSync('output/test15-css-override.pdf', pdf15);
  console.log('  Saved output/test15-css-override.pdf\n');

  console.log('=== Test 16: External CSS with IDs ===');
  const generatorIdCSS = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    css: `
      #header { color: #333333; font-size: 24px; font-weight: bold; }
      #footer { color: #999999; font-size: 10px; }
    `,
  });
  const pdf16 = await generatorIdCSS.generate(`
    <div id="header">En-tête du document</div>
    <p>Contenu principal</p>
    <div id="footer">Pied de page</div>
  `);
  console.log('  Buffer size: ' + pdf16.length + ' bytes');
  writeFileSync('output/test16-css-ids.pdf', pdf16);
  console.log('  Saved output/test16-css-ids.pdf\n');

  console.log('=== Test 17: External CSS with per-call option ===');
  const generatorNoCSS = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
  });
  const pdf17 = await generatorNoCSS.generate(`
    <h1>Titre</h1>
    <p>Paragraphe</p>
  `, {
    css: `
      h1 { color: #cc0000; font-size: 26px; }
      p { color: #006600; font-size: 16px; }
    `,
  });
  console.log('  Buffer size: ' + pdf17.length + ' bytes');
  writeFileSync('output/test17-css-per-call.pdf', pdf17);
  console.log('  Saved output/test17-css-per-call.pdf\n');

  console.log('\n=== Test 18: Header on every page ===');
  const generatorHeader = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    header: '<div style="font-size: 10px; color: #666666;">Mon Document - Rapport</div>',
  });
  let content18 = '<h1>Rapport</h1>';
  for (let i = 0; i < 30; i++) {
    content18 += '<p>Paragraphe ' + i + ' - Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>';
  }
  const pdf18 = await generatorHeader.generate(content18);
  console.log('  Buffer size: ' + pdf18.length + ' bytes');
  await savePdf('output/test18-header.pdf', pdf18);
  console.log('  Saved output/test18-header.pdf\n');

  console.log('=== Test 19: Footer on every page ===');
  const generatorFooter = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    footer: '<div style="font-size: 8px; color: #999999;">Page {page} / {totalPages} - Confidential</div>',
  });
  let content19 = '<h1>Rapport</h1>';
  for (let i = 0; i < 30; i++) {
    content19 += '<p>Paragraphe ' + i + ' - Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>';
  }
  const pdf19 = await generatorFooter.generate(content19);
  console.log('  Buffer size: ' + pdf19.length + ' bytes');
  await savePdf('output/test19-footer.pdf', pdf19);
  console.log('  Saved output/test19-footer.pdf\n');

  console.log('=== Test 20: Header + Footer combined ===');
  const generatorBoth = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    header: '<div style="font-size: 10px; font-weight: bold;">En-tête du document</div>',
    footer: '<div style="font-size: 8px; color: #999999;">Page {page} / {totalPages}</div>',
  });
  let content20 = '<h1>Rapport Complet</h1>';
  for (let i = 0; i < 40; i++) {
    content20 += '<p>Paragraphe ' + i + ' - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam.</p>';
  }
  const pdf20 = await generatorBoth.generate(content20);
  console.log('  Buffer size: ' + pdf20.length + ' bytes');
  await savePdf('output/test20-header-footer.pdf', pdf20);
  console.log('  Saved output/test20-header-footer.pdf\n');

  console.log('=== Test 21: Header/Footer per-call option ===');
  const generatorNoHF = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
  });
  let content21 = '<h1>Test</h1>';
  for (let i = 0; i < 20; i++) {
    content21 += '<p>Ligne ' + i + ' - Lorem ipsum dolor sit amet.</p>';
  }
  const pdf21 = await generatorNoHF.generate(content21, {
    header: '<div style="font-size: 9px;">Per-call header</div>',
    footer: '<div style="font-size: 8px;">Per-call footer</div>',
  });
  console.log('  Buffer size: ' + pdf21.length + ' bytes');
  await savePdf('output/test21-per-call-hf.pdf', pdf21);
  console.log('  Saved output/test21-per-call-hf.pdf\n');

  console.log('=== Test 22: Header/Footer single page ===');
  const generatorSingle = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    header: '<div style="font-size: 10px;">Header</div>',
    footer: '<div style="font-size: 8px;">Footer - Page 1/1</div>',
  });
  const pdf22 = await generatorSingle.generate('<h1>Single Page</h1><p>Just one page.</p>');
  console.log('  Buffer size: ' + pdf22.length + ' bytes');
  await savePdf('output/test22-single-page-hf.pdf', pdf22);
  console.log('  Saved output/test22-single-page-hf.pdf\n');

  console.log('\n=== Test 23: Unordered list ===');
  const pdf23 = await generator.generate(`
    <ul>
      <li>Premier élément</li>
      <li>Deuxième élément</li>
      <li>Troisième élément</li>
    </ul>
  `);
  console.log('  Buffer size: ' + pdf23.length + ' bytes');
  await savePdf('output/test23-ul.pdf', pdf23);
  console.log('  Saved output/test23-ul.pdf\n');

  console.log('=== Test 24: Ordered list ===');
  const pdf24 = await generator.generate(`
    <ol>
      <li>Premier</li>
      <li>Deuxième</li>
      <li>Troisième</li>
      <li>Quatrième</li>
    </ol>
  `);
  console.log('  Buffer size: ' + pdf24.length + ' bytes');
  await savePdf('output/test24-ol.pdf', pdf24);
  console.log('  Saved output/test24-ol.pdf\n');

  console.log('=== Test 25: Nested lists ===');
  const pdf25 = await generator.generate(`
    <ul>
      <li>Fruits
        <ul>
          <li>Pomme</li>
          <li>Banane</li>
        </ul>
      </li>
      <li>Légumes
        <ul>
          <li>Carotte</li>
          <li>Tomate</li>
        </ul>
      </li>
    </ul>
  `);
  console.log('  Buffer size: ' + pdf25.length + ' bytes');
  await savePdf('output/test25-nested-list.pdf', pdf25);
  console.log('  Saved output/test25-nested-list.pdf\n');

  console.log('=== Test 26: List with CSS styling ===');
  const pdf26 = await generator.generate(`
    <ul>
      <li style="color: #ff0000;">Rouge</li>
      <li style="font-weight: bold; font-size: 14px;">Gras et grand</li>
      <li style="font-style: italic;">Italique</li>
    </ul>
  `);
  console.log('  Buffer size: ' + pdf26.length + ' bytes');
  await savePdf('output/test26-list-css.pdf', pdf26);
  console.log('  Saved output/test26-list-css.pdf\n');

  console.log('=== Test 27: Mixed content with lists ===');
  const pdf27 = await generator.generate(`
    <h1>Mon Document</h1>
    <p>Introduction au document.</p>
    <h2>Liste des points</h2>
    <ul>
      <li>Premier point</li>
      <li>Deuxième point</li>
      <li>Troisième point</li>
    </ul>
    <p>Conclusion du document.</p>
    <ol>
      <li>Étape 1</li>
      <li>Étape 2</li>
    </ol>
  `);
  console.log('  Buffer size: ' + pdf27.length + ' bytes');
  await savePdf('output/test27-mixed-list.pdf', pdf27);
  console.log('  Saved output/test27-mixed-list.pdf\n');

  console.log('=== Test 28: List with long items (pagination) ===');
  let list28 = '<ul>';
  for (let i = 0; i < 50; i++) {
    list28 += '<li>Élement ' + i + ' - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.</li>';
  }
  list28 += '</ul>';
  const pdf28 = await generator.generate(list28);
  console.log('  Buffer size: ' + pdf28.length + ' bytes');
  await savePdf('output/test28-list-pagination.pdf', pdf28);
  console.log('  Saved output/test28-list-pagination.pdf\n');

  const testImg = './output/test-image.png';
  const smallImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFUlEQVR4nGNgOJFCGhrVMKph+GoAABn1LBB8AQh5AAAAAElFTkSuQmCC';

  console.log('=== Test 29: Image from file ===');
  const pdf29 = await generator.generate(`<p>Before image</p><img src="${testImg}" /><p>After image</p>`);
  console.log('  Buffer size: ' + pdf29.length + ' bytes');
  await savePdf('output/test29-image-file.pdf', pdf29);
  console.log('  Saved output/test29-image-file.pdf\n');

  console.log('=== Test 30: Image with width/height ===');
  const pdf30 = await generator.generate(`<img src="${testImg}" width="200" height="200" />`);
  console.log('  Buffer size: ' + pdf30.length + ' bytes');
  await savePdf('output/test30-image-sizes.pdf', pdf30);
  console.log('  Saved output/test30-image-sizes.pdf\n');

  console.log('=== Test 31: Image width only (auto height) ===');
  const pdf31 = await generator.generate(`<img src="${testImg}" width="300" />`);
  console.log('  Buffer size: ' + pdf31.length + ' bytes');
  await savePdf('output/test31-image-width-only.pdf', pdf31);
  console.log('  Saved output/test31-image-width-only.pdf\n');

  console.log('=== Test 32: Image larger than page width ===');
  const pdf32 = await generator.generate(`<img src="${testImg}" width="1000" />`);
  console.log('  Buffer size: ' + pdf32.length + ' bytes');
  await savePdf('output/test32-image-overflow.pdf', pdf32);
  console.log('  Saved output/test32-image-overflow.pdf\n');

  console.log('=== Test 33: Image with data URI (small) ===');
  const pdf33 = await generator.generate(`<p>Small inline image:</p><img src="${smallImg}" width="50" height="50" /><p>Done</p>`);
  console.log('  Buffer size: ' + pdf33.length + ' bytes');
  await savePdf('output/test33-image-data-uri.pdf', pdf33);
  console.log('  Saved output/test33-image-data-uri.pdf\n');

  console.log('=== Test 34: Image with text mixed ===');
  const pdf34 = await generator.generate(`<h1>Report</h1><p>Introduction with image.</p><img src="${testImg}" width="150" height="150" /><p>Conclusion.</p>`);
  console.log('  Buffer size: ' + pdf34.length + ' bytes');
  await savePdf('output/test34-image-text-mixed.pdf', pdf34);
  console.log('  Saved output/test34-image-text-mixed.pdf\n');

  console.log('=== Test 35: Nested tables (5 levels) ===');
  const pdf35 = await generator.generate(`
    <table style="border: 1px solid #000000; padding: 2px;">
      <tr>
        <th style="border: 1px solid #000000; padding: 2px;">Niveau 1 - Col A</th>
        <th style="border: 1px solid #000000; padding: 2px;">Niveau 1 - Col B</th>
      </tr>
      <tr>
        <td style="border: 1px solid #000000; padding: 2px;">
          <table style="border: 1px solid #009900; padding: 2px;">
            <tr>
              <th style="border: 1px solid #009900; padding: 2px;">Niveau 2 - A1</th>
              <th style="border: 1px solid #009900; padding: 2px;">Niveau 2 - A2</th>
            </tr>
            <tr>
              <td style="border: 1px solid #009900; padding: 2px;">
                <table style="border: 1px solid #0000cc; padding: 2px;">
                  <tr>
                    <th style="border: 1px solid #0000cc; padding: 2px;">Niveau 3 - X</th>
                    <th style="border: 1px solid #0000cc; padding: 2px;">Niveau 3 - Y</th>
                  </tr>
                  <tr>
                    <td style="border: 1px solid #0000cc; padding: 2px;">
                      <table style="border: 1px solid #cc0000; padding: 2px;">
                        <tr>
                          <th style="border: 1px solid #cc0000; padding: 2px;">Niveau 4 - P</th>
                          <th style="border: 1px solid #cc0000; padding: 2px;">Niveau 4 - Q</th>
                        </tr>
                        <tr>
                          <td style="border: 1px solid #cc0000; padding: 2px;">
                            <table style="border: 1px solid #9900cc; padding: 2px;">
                              <tr>
                                <th style="border: 1px solid #9900cc; padding: 2px;">Niveau 5 - 1</th>
                                <th style="border: 1px solid #9900cc; padding: 2px;">Niveau 5 - 2</th>
                              </tr>
                              <tr>
                                <td style="border: 1px solid #9900cc; padding: 2px;">Donnée finale</td>
                                <td style="border: 1px solid #9900cc; padding: 2px;">Valeur 2</td>
                              </tr>
                            </table>
                          </td>
                          <td style="border: 1px solid #cc0000; padding: 2px;">Cellule Q</td>
                        </tr>
                      </table>
                    </td>
                    <td style="border: 1px solid #0000cc; padding: 2px;">Cellule Y</td>
                  </tr>
                </table>
              </td>
              <td style="border: 1px solid #009900; padding: 2px;">Cellule A2</td>
            </tr>
          </table>
        </td>
        <td style="border: 1px solid #000000; padding: 2px;">Cellule B simple</td>
      </tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf35.length + ' bytes');
  await savePdf('output/test35-nested-tables.pdf', pdf35);
  console.log('  Saved output/test35-nested-tables.pdf\n');

  console.log('=== Test 36: @page bottom-center with counter(page) ===');
  const css36 = `
    @page {
      @bottom-center {
        content: "Page " counter(page);
        font-size: 10px;
        color: #666666;
      }
    }
  `;
  let content36 = '<h1>Rapport</h1>';
  for (let i = 0; i < 50; i++) content36 += `<p>Ligne ${i + 1} pour tester la pagination.</p>`;
  const pdf36 = await generator.generate(content36, { css: css36 });
  console.log('  Buffer size: ' + pdf36.length + ' bytes');
  await savePdf('output/test36-page-footer.pdf', pdf36);
  console.log('  Saved output/test36-page-footer.pdf\n');

  console.log('=== Test 37: @page with multiple zones ===');
  const css37 = `
    @page {
      @top-left {
        content: "Mon Rapport";
        font-size: 10px;
        color: #333333;
      }
      @top-right {
        content: "Confidentiel";
        font-size: 8px;
        color: #999999;
      }
      @bottom-center {
        content: "Page " counter(page) " sur " counter(num-pages);
        font-size: 10px;
        color: #666666;
      }
    }
  `;
  let content37 = '<h1>Analyse</h1>';
  for (let i = 0; i < 40; i++) content37 += `<p>Section ${i + 1} avec du contenu détaillé.</p>`;
  const pdf37 = await generator.generate(content37, { css: css37 });
  console.log('  Buffer size: ' + pdf37.length + ' bytes');
  await savePdf('output/test37-page-zones.pdf', pdf37);
  console.log('  Saved output/test37-page-zones.pdf\n');

  console.log('=== Test 38: @page with CSS rules mixed ===');
  const css38 = `
    h1 { color: #1a1a2e; font-size: 24px; }
    p { font-size: 12px; color: #333; }

    @page {
      @top-center {
        content: "Titre du document";
        font-size: 10px;
      }
      @bottom-right {
        content: "Page " counter(page);
        font-size: 9px;
        color: #999999;
      }
    }
  `;
  const content38 = '<h1>Document</h1><p>Contenu principal avec style CSS et zones de page.</p>';
  const pdf38 = await generator.generate(content38, { css: css38 });
  console.log('  Buffer size: ' + pdf38.length + ' bytes');
  await savePdf('output/test38-page-mixed-css.pdf', pdf38);
  console.log('  Saved output/test38-page-mixed-css.pdf\n');

  console.log('=== Test 39: @page via global config ===');
  const generator39 = createPdfGenerator({
    defaultFormat: 'A4',
    defaultOrientation: 'portrait',
    defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
    css: `
      @page {
        @bottom-center {
          content: "Global Footer";
          font-size: 8px;
        }
      }
    `,
  });
  const content39 = '<h1>Config globale</h1><p>Le pied de page est défini dans la configuration.</p>';
  const pdf39 = await generator39.generate(content39);
  console.log('  Buffer size: ' + pdf39.length + ' bytes');
  await savePdf('output/test39-page-global-config.pdf', pdf39);
  console.log('  Saved output/test39-page-global-config.pdf\n');

  console.log('=== Test 40: @page all 7 zones at once ===');
  const css40 = `
    @page {
      @top-left {
        content: "Gauche-Haut";
        font-size: 8px;
        color: #ff0000;
      }
      @top-center {
        content: "Centre-Haut";
        font-size: 8px;
        color: #00aa00;
      }
      @top-right {
        content: "Droite-Haut";
        font-size: 8px;
        color: #0000ff;
      }
      @bottom-left {
        content: "Gauche-Bas";
        font-size: 8px;
        color: #ff6600;
      }
      @bottom-center {
        content: "Centre-Bas Page " counter(page);
        font-size: 8px;
        color: #aa00aa;
      }
      @bottom-right {
        content: "Droite-Bas";
        font-size: 8px;
        color: #00aaaa;
      }
    }
  `;
  let content40 = '<h1>Tout les zones</h1>';
  for (let i = 0; i < 30; i++) content40 += `<p>Ligne ${i + 1} pour pagination.</p>`;
  const pdf40 = await generator.generate(content40, { css: css40 });
  console.log('  Buffer size: ' + pdf40.length + ' bytes');
  await savePdf('output/test40-page-all-zones.pdf', pdf40);
  console.log('  Saved output/test40-page-all-zones.pdf\n');

  console.log('=== Test 41: @page all 7 zones, multi-page content ===');
  const css41 = `
    @page {
      @top-left {
        content: "Gauche-Haut";
        font-size: 8px;
        color: #ff0000;
      }
      @top-center {
        content: "Centre-Haut";
        font-size: 8px;
        color: #00aa00;
      }
      @top-right {
        content: "Droite-Haut";
        font-size: 8px;
        color: #0000ff;
      }
      @bottom-left {
        content: "Gauche-Bas";
        font-size: 8px;
        color: #ff6600;
      }
      @bottom-center {
        content: "Centre-Bas Page " counter(page) " sur " counter(num-pages);
        font-size: 8px;
        color: #aa00aa;
      }
      @bottom-right {
        content: "Droite-Bas";
        font-size: 8px;
        color: #00aaaa;
      }
    }
  `;
  let content41 = '<h1>Tout les zones - Multi-pages</h1>';
  for (let i = 0; i < 70; i++) content41 += `<p>Ligne ${i + 1} pour tester les zones sur plusieurs pages.</p>`;
  const pdf41 = await generator.generate(content41, { css: css41 });
  console.log('  Buffer size: ' + pdf41.length + ' bytes');
  await savePdf('output/test41-page-all-zones-multipage.pdf', pdf41);
  console.log('  Saved output/test41-page-all-zones-multipage.pdf\n');

  console.log('=== Test 42: Table with rowspan ===');
  const pdf42 = await generator.generate(`
    <table style="border: 1px solid #000000">
      <tr><th rowspan="3">Groupe</th><th>Catégorie</th><th>Valeur</th></tr>
      <tr><td>Produits</td><td>100</td></tr>
      <tr><td>Services</td><td>200</td></tr>
      <tr><td colspan="2">Total</td><td>300</td></tr>
    </table>
  `);
  console.log('  Buffer size: ' + pdf42.length + ' bytes');
  await savePdf('output/test42-table-rowspan.pdf', pdf42);
  console.log('  Saved output/test42-table-rowspan.pdf\n');

  console.log('=== Test 43: @font-face via localhost URL ===');
  const http = await import('http');
  const { readFileSync } = await import('fs');
  const server = http.createServer((req, res) => {
    const file = decodeURIComponent(req.url.replace(/^\//, ''));
    try {
      res.writeHead(200, { 'Content-Type': 'font/ttf' });
      res.end(readFileSync(`test/fixtures/fonts/${file}`));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const css43 = `
    @font-face { font-family: 'Arvo'; src: url('http://127.0.0.1:${port}/Arvo-Regular.ttf'); font-weight: normal; font-style: normal; }
    @font-face { font-family: 'Arvo'; src: url('http://127.0.0.1:${port}/Arvo-Bold.ttf'); font-weight: bold; font-style: normal; }
    @font-face { font-family: 'Arvo'; src: url('http://127.0.0.1:${port}/Arvo-Italic.ttf'); font-weight: normal; font-style: italic; }
    @font-face { font-family: 'Arvo'; src: url('http://127.0.0.1:${port}/Arvo-BoldItalic.ttf'); font-weight: bold; font-style: italic; }
  `;
  const content43 = `
    <h1 style="font-family: Arvo;">Police Arvo</h1>
    <p style="font-family: Arvo;">Texte normal en Arvo.</p>
    <p style="font-family: Arvo; font-weight: bold;">Texte bold en Arvo.</p>
    <p style="font-family: Arvo; font-style: italic;">Texte italic en Arvo.</p>
    <p style="font-family: Arvo; font-weight: bold; font-style: italic;">Texte bold italic en Arvo.</p>
  `;
  const pdf43 = await generator.generate(content43, { css: css43 });
  const raw43 = pdf43.toString('latin1');
  const arvo43 = (raw43.match(/Arvo/g) || []).length;
  console.log('  Arvo embedded references: ' + arvo43);
  if (arvo43 === 0) throw new Error('Arvo font was not embedded in the PDF');
  server.close();
  await savePdf('output/test43-font-face-localhost.pdf', pdf43);
  console.log('  Saved output/test43-font-face-localhost.pdf\n');

  console.log('=== Test 44: @font-face via data URI ===');
  const arvoBase64 = readFileSync('test/fixtures/fonts/Arvo-Regular.ttf').toString('base64');
  const css44 = `
    @font-face { font-family: 'ArvoData'; src: url(data:font/ttf;base64,${arvoBase64}); }
  `;
  const content44 = '<p style="font-family: ArvoData; font-size: 14px;">Texte en Arvo via data URI.</p>';
  const pdf44 = await generator.generate(content44, { css: css44 });
  const arvo44 = (pdf44.toString('latin1').match(/ArvoData|Arvo/g) || []).length;
  console.log('  ArvoData embedded references: ' + arvo44);
  if (arvo44 === 0) throw new Error('ArvoData font was not embedded in the PDF');
  await savePdf('output/test44-font-face-data-uri.pdf', pdf44);
  console.log('  Saved output/test44-font-face-data-uri.pdf\n');

  console.log('\n=== All tests passed ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
