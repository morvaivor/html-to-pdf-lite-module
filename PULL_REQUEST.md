## 📝 Description de la Pull Request

Cette Pull Request ajoute un workflow GitHub Actions automatisé pour valider le code lors de chaque Pull Request, ainsi qu'une suite de benchmarks et une commande d'audit des vulnérabilités de sécurité.

### 🚀 Principales évolutions apportées :
1. **GitHub Actions CI Workflow (`.github/workflows/pr-ci.yml`)** :
   - Déclenché automatiquement lors de chaque `pull_request` vers `main`, `master`, `feat/*`, `dev`.
   - **Job `test`** : Exécute `npm test` sur une matrice de versions Node.js (18.x, 20.x, 22.x).
   - **Job `benchmark`** : Exécute la suite de benchmarks automatisée (`npm run bench`).
   - **Job `security-audit`** : Exécute l'audit de sécurité des dépendances (`npm run audit`).
2. **Suite de Benchmarks Automatisée (`bench/benchmark.js`)** :
   - Mesure les performances du générateur PDF (temps total en ms, ops/sec, taille du PDF, delta mémoire heap).
   - Couvre 4 scénarios : Document simple, Tableau HTML, Document complexe (`@page`), Document volumineux (80 paragraphes).
3. **Scripts npm & Correctif de Sécurité (`package.json`, `package-lock.json`)** :
   - Ajout des commandes `npm run bench` et `npm run audit`.
   - Résolution des vulnérabilités de dépendances via `npm audit fix` (0 vulnérabilité restante).

---

## 🧪 Tests et Vérification

- [x] `npm test` s'exécute sans erreur (44 tests d'intégration passés).
- [x] `npm run bench` s'exécute sans erreur et affiche la table de métriques.
- [x] `npm run audit` s'exécute sans erreur (0 vulnérabilité détectée).

---

## ⚠️ Impact sur l'existant (Breaking Changes)

- [ ] Breaking changes (changement incompatible)
- [x] Rétro-compatible (aucun impact sur l'API publique)
