const { createPdfGenerator } = require('../src/index');
const { writeFileSync, mkdirSync } = require('fs');

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

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

  console.log('\n=== All tests passed ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
