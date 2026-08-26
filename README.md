# PDF Generator

Moteur minimal HTML → PDF en Node.js. Utilise **pdfkit** (pur JS) + **cheerio** (parseur HTML).

## Fonctionnalités

| Fonctionnalité | Support |
|---|---|
| Balises : `<h1>`-`<h6>`, `<p>`, `<div>`, `<span>`, `<br>`, `<a>` | ✅ |
| CSS inline : `color`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-align`, `border`, `padding`, `background-color` | ✅ |
| CSS externe (chaîne CSS) | ✅ |
| Polices personnalisées via `@font-face` (TTF/OTF, `url()` http(s) ou data URI, bold/italic) | ✅ |
| Zones de page `@page` (6 zones, `counter(page)`, `counter(num-pages)`) | ✅ |
| Pagination automatique | ✅ |
| Options : format (A4, Letter...), orientation, marges | ✅ |
| Tableaux (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`, `<th>`) | ✅ |
| Bordures et padding sur tableaux | ✅ |
| `colspan` | ✅ |
| `rowspan` | ✅ |
| Tableaux imbriqués (jusqu'à 5 niveaux) | ✅ |
| Listes (`<ul>`, `<ol>`, `<li>` avec indentation) | ✅ |
| Listes imbriquées | ✅ |
| Images (`<img>` : fichier local, data URI, URL http(s), width/height) | ✅ |
| En-tête / pied de page sur chaque page (`{page}`, `{totalPages}`) | ✅ |

## Installation

```bash
npm install
```

## Utilisation

```js
import { createPdfGenerator } from './src/index.js';

const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
});

const html = `
  <h1 style="color: #333;">Rapport</h1>
  <p style="font-size: 14px;">Bonjour le monde</p>
  <div>
    <span style="color: red; font-weight: bold;">Important</span>
    <p>Texte normal</p>
  </div>
`;

const pdfBuffer = await generator.generate(html);

import { writeFileSync } from 'fs';
writeFileSync('output.pdf', pdfBuffer);
```

## Options globales (création du générateur)

```js
const generator = createPdfGenerator({
  defaultFormat: 'A4',
  defaultOrientation: 'portrait',
  defaultMargin: { top: 20, bottom: 20, left: 20, right: 20 },
  css: `h1 { color: blue; } p { font-size: 14px; }`,
  header: '<div style="font-size: 8px;">En-tête</div>',
  footer: '<div style="font-size: 8px;">Page {page} / {totalPages}</div>',
});
```

| Option | Type | Description |
|---|---|---|
| `defaultFormat` | `string` | Format de page : `A3`, `A4`, `A5`, `Letter`, `Legal` |
| `defaultOrientation` | `string` | `portrait` ou `landscape` |
| `defaultMargin` | `object` | Marges `{ top, bottom, left, right }` en points |
| `css` | `string` | CSS en chaîne (appliqué globalement, y compris les règles `@page`) |
| `header` | `string` | HTML de l'en-tête (répété sur chaque page) |
| `footer` | `string` | HTML du pied de page (`{page}` = numéro de page, `{totalPages}` = nombre total de pages) |

## Options par appel

```js
const pdf = await generator.generate(html, {
  format: 'Letter',
  orientation: 'landscape',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  css: 'p { color: green; }',
  header: '<div>Mon en-tête</div>',
  footer: '<div>Page {page} / {totalPages}</div>',
});
```

Les options passées à `generate()` **remplacent** les options globales pour l'appel en cours.

## CSS externe

Le CSS est fourni en chaîne, soit globalement (option `css` du générateur), soit par appel (option `css` de `generate()`).

```js
const pdf = await generator.generate(html, {
  css: `
    h1 { color: #1a1a2e; font-size: 24px; }
    p  { color: #555; font-size: 14px; }
    .highlight { color: red; font-weight: bold; }
  `,
});
```

### Sélecteurs supportés

| Sélecteur | Exemple | Support |
|---|---|---|
| Élément | `h1`, `p`, `div` | ✅ |
| Classe | `.classname` | ✅ |
| ID | `#myid` | ✅ |
| Combiné | `div.highlight` | ✅ |

Propriétés CSS supportées : `color`, `background-color`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-align`, `border`, `border-color`, `border-width`, `padding`.

> Les styles inline (`style="..."`) ont la priorité sur le CSS externe.

## Polices personnalisées (`@font-face`)

Les polices TTF/OTF sont embarquées dans le PDF et se définissent via `@font-face` dans le CSS :

```css
@font-face { font-family: 'Arvo'; src: url('http://localhost:3000/fonts/Arvo-Regular.ttf'); font-weight: normal; font-style: normal; }
@font-face { font-family: 'Arvo'; src: url('http://localhost:3000/fonts/Arvo-Bold.ttf'); font-weight: bold; font-style: normal; }
@font-face { font-family: 'Arvo'; src: url('http://localhost:3000/fonts/Arvo-Italic.ttf'); font-weight: normal; font-style: italic; }
@font-face { font-family: 'Arvo'; src: url('http://localhost:3000/fonts/Arvo-BoldItalic.ttf'); font-weight: bold; font-style: italic; }
```

- `src: url(...)` — URL http(s) (ex. un serveur local) ou data URI (`data:font/ttf;base64,...`)
- `font-weight` / `font-style` — déclarent les variantes bold/italic de la famille (fallback sur la face la plus proche si une variante est manquante)
- Usage : `font-family: Arvo` dans le CSS externe ou le style inline

## Tableaux

Les bordures et le padding se définissent en CSS inline sur le `<table>` (hérité par les cellules) ou directement sur les `<td>`/`<th>` :

```html
<table style="border: 1px solid #000000; padding: 5px;">
  <thead>
    <tr>
      <th style="border: 1px solid #000000; padding: 4px;">Nom</th>
      <th style="border: 1px solid #000000; padding: 4px;">Prénom</th>
      <th style="border: 1px solid #000000; padding: 4px;">Âge</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border: 1px solid #000000; padding: 4px;">Dupont</td>
      <td style="border: 1px solid #000000; padding: 4px;">Marie</td>
      <td style="border: 1px solid #000000; padding: 4px;">30</td>
    </tr>
    <tr>
      <td colspan="2" style="border: 1px solid #000000; padding: 4px;">Ligne fusionnée</td>
      <td style="border: 1px solid #000000; padding: 4px;">25</td>
    </tr>
  </tbody>
</table>
```

`rowspan` est aussi supporté pour fusionner des cellules verticalement :

```html
<table style="border: 1px solid #000000; padding: 5px;">
  <tr>
    <th rowspan="2" style="border: 1px solid #000000; padding: 4px;">Groupe</th>
    <th style="border: 1px solid #000000; padding: 4px;">Catégorie</th>
    <th style="border: 1px solid #000000; padding: 4px;">Valeur</th>
  </tr>
  <tr>
    <td style="border: 1px solid #000000; padding: 4px;">Produits</td>
    <td style="border: 1px solid #000000; padding: 4px;">100</td>
  </tr>
  <tr>
    <td colspan="2" style="border: 1px solid #000000; padding: 4px;">Total</td>
    <td style="border: 1px solid #000000; padding: 4px;">300</td>
  </tr>
</table>
```

### Tableaux imbriqués

Jusqu'à 5 niveaux de `<table>` imbriqués sont supportés :

```html
<table style="border: 1px solid #000000; padding: 2px;">
  <tr>
    <td style="border: 1px solid #000000; padding: 2px;">
      <table style="border: 1px solid #009900; padding: 2px;">
        <tr>
          <td style="border: 1px solid #009900; padding: 2px;">
            <table style="border: 1px solid #0000cc; padding: 2px;">
              <tr><td style="border: 1px solid #0000cc; padding: 2px;">Niveau 3</td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

## Listes

```html
<ul>
  <li>Élément 1
    <ul>
      <li>Sous-élément A</li>
      <li>Sous-élément B</li>
    </ul>
  </li>
  <li>Élément 2</li>
</ul>

<ol>
  <li>Premier</li>
  <li>Deuxième</li>
</ol>
```

## Images

```html
<!-- Fichier local -->
<img src="./image.png" />

<!-- Avec dimensions -->
<img src="./image.png" width="200" height="150" />

<!-- Largeur seule (hauteur auto) -->
<img src="./image.png" width="300" />

<!-- Data URI -->
<img src="data:image/png;base64,iVBORw0KGgo..." />

<!-- URL http(s) -->
<img src="https://example.com/image.png" />
```

Si une image dépasse la largeur de page, elle est redimensionnée automatiquement.

## En-tête et pied de page

```js
const pdf = await generator.generate(html, {
  header: '<div style="font-size: 8px; color: gray;">Rapport confidentiel</div>',
  footer: '<div style="font-size: 8px; color: gray;">Page {page} / {totalPages}</div>',
});
```

Les marqueurs `{page}` et `{totalPages}` sont remplacés automatiquement par le numéro de page et le nombre total de pages. L'en-tête et le pied de page sont répétés sur **chaque** page, y compris la première.

## Zones de page `@page`

Les zones de page se définissent dans une règle `@page` du CSS (option `css` globale ou par appel). 6 zones sont supportées : `@top-left`, `@top-center`, `@top-right`, `@bottom-left`, `@bottom-center`, `@bottom-right`.

```js
const pdf = await generator.generate(html, {
  css: `
    @page {
      @top-left {
        content: "Mon Document";
        font-size: 8px;
        color: #ff0000;
      }
      @bottom-center {
        content: "Page " counter(page) " sur " counter(num-pages);
        font-size: 8px;
        color: #666666;
      }
      @bottom-right {
        content: "Confidentiel";
        font-size: 8px;
      }
    }
  `,
});
```

Les compteurs `counter(page)` et `counter(num-pages)` sont résolus par page. Les propriétés `content`, `font-size`, `color`, `font-weight`, `font-style` et `font-family` sont supportées dans les zones. Les zones `@page` et les options `header`/`footer` sont mutuellement exclusives : si une règle `@page` est présente, ce sont les zones qui sont utilisées.

## Tests

```bash
npm test
```

44 tests couvrant : headings, paragraphes, CSS inline, pagination, options, tableaux (simple, thead/tbody, bordures, colspan, rowspan, CSS, contenu imbriqué, 5 niveaux), CSS externe (chaîne, classes, IDs, override, par appel), en-tête/pied de page (global, par appel, multi-pages), listes (ul, ol, imbriquées, CSS, pagination), images (fichier, dimensions, data URI, overflow, URL), zones `@page` (6 zones, `counter(page)`, multi-pages), polices `@font-face` (URL http(s), data URI, variantes bold/italic).

## Dépendances

- **pdfkit** — moteur de rendu PDF (pur JS)
- **cheerio** — parseur HTML (compatible jQuery)

## Prochaines itérations

1. **CSS avancé** : `line-height`, `letter-spacing`, `text-decoration`, `margin`
2. **Media queries**
3. **Encapsulation CSS** : `float`, `display`, `position`
4. **Formes** : `<hr>`, `<blockquote>`, `<pre>`, `<code>`