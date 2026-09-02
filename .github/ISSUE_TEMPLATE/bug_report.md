---
name: 🐛 Rapport de bug
about: Signaler un problème ou un comportement inattendu
title: "[BUG] "
labels: bug
assignees: ''
---

## Description du bug

<!-- Décrivez clairement le problème rencontré. -->

## Étapes de reproduction

<!-- Détaillez les étapes pour reproduire le bug. -->

1. ...
2. ...
3. ...

## Code minimal pour reproduire

<!-- Fournissez un extrait de code minimal qui reproduit le problème. -->

```js
import { createPdfGenerator } from './src/index.js';

const generator = createPdfGenerator();

const html = `
  <!-- Votre HTML ici -->
`;

const pdf = await generator.generate(html, {
  // Vos options ici
});
```

## Comportement attendu

<!-- Décrivez ce qui devrait se passer. -->

## Comportement obtenu

<!-- Décrivez ce qui se passe réellement. Ajoutez des captures d'écran du PDF généré si possible. -->

## Environnement

- **Node.js** : <!-- ex: v20.11.0 -->
- **OS** : <!-- ex: Windows 11, Ubuntu 22.04, macOS 14 -->
- **Version du module** : <!-- ex: 1.0.0 -->

## Logs / Erreurs

<!-- Collez ici les messages d'erreur ou les stack traces. -->

```
```

## Contexte supplémentaire

<!-- Toute information utile : PDF de sortie, CSS utilisé, polices personnalisées, etc. -->
