const { createPdfGenerator } = require('../src/index');
const { writeFileSync, mkdirSync } = require('fs');

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function savePdf(path, buffer) {
  await sleep(100);
  writeFileSync(path, buffer);
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

  console.log('\n=== All tests passed ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
