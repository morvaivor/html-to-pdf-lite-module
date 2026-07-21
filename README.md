# PDF Generator

Moteur minimal HTML → PDF en Node.js. Utilise **pdfkit** (pur JS) + **cheerio** (parseur HTML).

## Itération 1 — Fonctionnalités actuelles

| Fonctionnalité | Support |
|---|---|
| Balises : `<h1>`-`<h6>`, `<p>`, `<div>`, `<span>`, `<br>`, `<a>` | ✅ |
| CSS inline : `color`, `font-size`, `font-weight`, `font-style`, `font-family` | ✅ |
| Pagination automatique | ✅ |
| Options : format (A4, Letter...), orientation, marges | ✅ |
| Tableaux | ❌ (itération suivante) |
| CSS externe | ❌ (itération suivante) |

## Installation

```bash
npm install
```

## Utilisation

```ts
import { createPdfGenerator } from './dist/index.js';

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

## Options par appel

```ts
const pdf = await generator.generate(html, {
  format: 'Letter',
  orientation: 'landscape',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
});
```

## Tests

```bash
npm test
```

## Prochaines itérations

1. **Tableaux** : `<table>`, `<tr>`, `<td>`, `<th>`, `colspan`, `rowspan`, bordures
2. **CSS externe** : injecter une feuille de style globale
3. **Listes** : `<ul>`, `<ol>`, `<li>` avec puces
4. **Images** : `<img>` via chemin local ou data URI
5. **En-tête / pied de page** répétitifs
