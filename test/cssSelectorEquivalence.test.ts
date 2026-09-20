import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { applyCssToElements, buildCssRuleIndex, parseCssRules } from '../src/cssParser.js';

describe('Patch 03: Indexed CSS Selector Matching', () => {
  test('buildCssRuleIndex classifies rules into byId, byClass, byTag, and complex', () => {
    const css = `
      #title { color: red; }
      div#main { padding: 10px; }
      .btn { font-size: 14px; }
      button.btn { border: 1px solid black; }
      h1 { font-size: 24px; }
      div p { line-height: 1.5; }
      ul > li { margin-left: 20px; }
      .card.highlight { background: yellow; }
    `;

    const rules = parseCssRules(css);
    const index = buildCssRuleIndex(rules);

    assert.ok(index.byId.has('title'), 'Should index #title in byId');
    assert.ok(index.byId.has('main'), 'Should index div#main in byId');
    assert.ok(index.byClass.has('btn'), 'Should index .btn in byClass');
    assert.ok(index.byClass.has('card'), 'Should index .card.highlight in byClass');
    assert.ok(index.byTag.has('h1'), 'Should index h1 in byTag');
    assert.equal(index.complex.length, 2, 'Should index div p and ul > li in complex');
  });

  test('applies ID, class, tag, and combined selectors correctly', () => {
    const html = `
      <div id="main" class="container dark">
        <h1 id="title" class="heading">Header Text</h1>
        <p class="intro">Introductory paragraph.</p>
        <button class="btn primary">Click me</button>
      </div>
    `;

    const css = `
      div { margin: 0; }
      #main { padding: 16px; }
      .container { background-color: #f0f0f0; }
      .dark { color: #ffffff; }
      h1.heading { font-size: 22px; }
      #title { font-weight: bold; }
      p.intro { line-height: 1.4; }
      button.btn.primary { background-color: #007bff; color: #fff; }
    `;

    const $ = cheerio.load(html);
    applyCssToElements($, css);

    const mainStyle = $('#main').attr('style') || '';
    assert.ok(mainStyle.includes('margin: 0'), 'div tag rule applied');
    assert.ok(mainStyle.includes('padding: 16px'), '#main id rule applied');
    assert.ok(mainStyle.includes('background-color: #f0f0f0'), '.container class rule applied');
    assert.ok(mainStyle.includes('color: #ffffff'), '.dark class rule applied');

    const h1Style = $('#title').attr('style') || '';
    assert.ok(h1Style.includes('font-size: 22px'), 'h1.heading rule applied');
    assert.ok(h1Style.includes('font-weight: bold'), '#title id rule applied');

    const pStyle = $('p.intro').attr('style') || '';
    assert.ok(pStyle.includes('line-height: 1.4'), 'p.intro rule applied');

    const btnStyle = $('button').attr('style') || '';
    assert.ok(btnStyle.includes('background-color: #007bff'), 'button.btn.primary rule applied');
  });

  test('complex selectors (descendants and child) work alongside indexed selectors', () => {
    const html = `
      <div class="wrapper">
        <div class="section">
          <p>Inner paragraph</p>
        </div>
        <ul>
          <li>List item</li>
        </ul>
      </div>
    `;

    const css = `
      .wrapper { padding: 20px; }
      .section p { color: #333333; }
      ul > li { list-style-type: square; }
    `;

    const $ = cheerio.load(html);
    applyCssToElements($, css);

    assert.ok($('.wrapper').attr('style')?.includes('padding: 20px'));
    assert.ok($('.section p').attr('style')?.includes('color: #333333'));
    assert.ok($('li').attr('style')?.includes('list-style-type: square'));
  });

  test('respects source-order precedence for rules of same priority', () => {
    const html = `<p class="item">Text</p>`;
    const css = `
      .item { color: red; }
      .item { color: blue; }
    `;

    const $ = cheerio.load(html);
    applyCssToElements($, css);

    const style = $('p').attr('style') || '';
    // blue should be applied after red
    const redIdx = style.indexOf('color: red');
    const blueIdx = style.indexOf('color: blue');
    assert.ok(redIdx !== -1 && blueIdx !== -1 && blueIdx > redIdx, 'Later rule must come after earlier rule');
  });

  test('inline style takes highest precedence over stylesheet rules', () => {
    const html = `<h1 class="title" style="color: purple; font-size: 30px;">Title</h1>`;
    const css = `
      h1 { color: red; font-size: 20px; margin: 10px; }
      .title { color: green; }
    `;

    const $ = cheerio.load(html);
    applyCssToElements($, css);

    const style = $('h1').attr('style') || '';
    assert.ok(style.includes('margin: 10px'), 'Stylesheet properties added');
    // Inline styles must come after stylesheet rules so parseInlineStyle picks them up
    assert.ok(style.lastIndexOf('color: purple') > style.lastIndexOf('color: green'));
  });
});
