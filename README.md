# PDF Generator

Moteur minimal HTML → PDF en Node.js. Utilise **pdfkit** (pur JS) + **cheerio** (parseur HTML).

## Fonctionnalités

| Fonctionnalité | Support |
|---|---|
| Balises : `<h1>`-`<h6>`, `<p>`, `<div>`, `<span>`, `<br>`, `<a>` | ✅ |
| CSS inline : `color`, `font-size`, `font-weight`, `font-style`, `font-family` | ✅ |
| CSS externe (fichier `.css` ou chaîne) | ✅ |
| Pagination automatique | ✅ |
| Options : format (A4, Letter...), orientation, marges | ✅ |
| Tableaux (`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`, `<th>`) | ✅ |
| Bordures et padding sur tableaux | ✅ |
| `colspan` | ✅ |
| Tableaux imbriqués (jusqu'à 5 niveaux) | ✅ |
| Listes (`<ul>`, `<ol>`, `<li>` avec indentation) | ✅ |
| Listes imbriquées | ✅ |
| Images (`<img>` : fichier local, data URI, width/height) | ✅ |
| En-tête / pied de page sur chaque page | ✅ |

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
  cssFile: './styles.css',
  header: '<div style="font-size: 8px;">En-tête</div>',
  footer: '<div style="font-size: 8px;">Page {page}</div>',
});
```

| Option | Type | Description |
|---|---|---|
| `defaultFormat` | `string` | Format de page : `A3`, `A4`, `A5`, `Letter`, `Legal` |
| `defaultOrientation` | `string` | `portrait` ou `landscape` |
| `defaultMargin` | `object` | Marges `{ top, bottom, left, right }` en points |
| `css` | `string` | CSS en chaîne (appliqué globalement) |
| `cssFile` | `string` | Chemin vers un fichier CSS |
| `header` | `string` | HTML de l'en-tête (répété sur chaque page) |
| `footer` | `string` | HTML du pied de page (`{page}` = numéro de page) |

## Options par appel

```js
const pdf = await generator.generate(html, {
  format: 'Letter',
  orientation: 'landscape',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  css: 'p { color: green; }',
  cssFile: './override.css',
  header: '<div>Mon en-tête</div>',
  footer: '<div>Page {page}</div>',
});
```

Les options passées à `generate()` **remplacent** les options globales pour l'appel en cours.

## CSS externe

### Via chaîne CSS

```js
const pdf = await generator.generate(html, {
  css: `
    h1 { color: #1a1a2e; font-size: 24px; }
    p  { color: #555; font-size: 14px; }
    .highlight { color: red; font-weight: bold; }
  `,
});
```

### Via fichier CSS

```js
const pdf = await generator.generate(html, {
  cssFile: './styles.css',
});
```

### Sélecteurs supportés

| Sélecteur | Exemple | Support |
|---|---|---|
| Élément | `h1`, `p`, `div` | ✅ |
| Classe | `.classname` | ✅ |
| ID | `#myid` | ✅ |
| Combiné | `div.highlight` | ✅ |

Propriétés CSS supportées : `color`, `font-size`, `font-weight`, `font-style`, `font-family`.

## Tableaux

```html
<table border="1" cellpadding="5">
  <thead>
    <tr>
      <th>Nom</th>
      <th>Prénom</th>
      <th>Âge</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Dupont</td>
      <td>Marie</td>
      <td>30</td>
    </tr>
    <tr>
      <td colspan="2">Ligne fusionnée</td>
      <td>25</td>
    </tr>
  </tbody>
</table>
```

### Tableaux imbriqués

Jusqu'à 5 niveaux de `<table>` imbriqués sont supportés :

```html
<table border="1">
  <tr>
    <td>
      <table border="1">
        <tr>
          <td>
            <table border="1">
              <tr><td>Niveau 3</td></tr>
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
```

Si une image dépasse la largeur de page, elle est redimensionnée automatiquement.

## En-tête et pied de page

```js
const pdf = await generator.generate(html, {
  header: '<div style="font-size: 8px; color: gray;">Rapport confidentiel</div>',
  footer: '<div style="font-size: 8px; color: gray;">Page {page}</div>',
});
```

Le marqueur `{page}` est remplacé automatiquement par le numéro de page.

## Tests

```bash
npm test
```

35 tests couvrant : headings, paragraphes, CSS inline, pagination, options, tableaux (simple, thead/tbody, bordures, colspan, CSS, contenu imbriqué, 5 niveaux), CSS externe (chaîne, fichier, classes, IDs, override), en-tête/pied de page, listes (ul, ol, imbriquées, CSS, pagination), images (fichier, dimensions, data URI, overflow).

## Dépendances

- **pdfkit** — moteur de rendu PDF (pur JS)
- **cheerio** — parseur HTML (compatible jQuery)

## Prochaines itérations

1. **`rowspan`** pour tableaux
2. **CSS avancé** : `text-align`, `line-height`, `letter-spacing`, `text-decoration`
3. **Support des polices** : charger des polices TTF/OTF personnalisées
4. **Images externes** : charger des images via URL
5. **Media queries** et styles `@page`
6. **Encapsulation CSS** : `float`, `display`, `position`
7. **Formes** : `<hr>`, `<blockquote>`, `<pre>`, `<code>`