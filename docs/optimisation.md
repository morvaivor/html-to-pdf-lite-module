# Guide & Bilan d'Optimisation — `html-to-pdf-lite-module`

> **Philosophie du projet** : Maintenir un moteur ultra-léger, sans dépendances headless lourdes (sans Chromium/Puppeteer), hautement concurrentiel et préservant l'Event Loop de Node.js.

---

## 📊 Bilan des Optimisations Natives (v2.0)

Toutes les optimisations suivantes sont implémentées en standard dans le code de production :

| ID | Domaine | Statut | Gain Obtenu |
|---|---|:---:|---|
| **OPT-1** | Conditional Two-Pass Rendering | ✅ Appliqué | Élimine 100% de la passe de comptage si `counter(num-pages)` n'est pas utilisé dans le CSS. |
| **OPT-2** | Partage de l'AST Cheerio | ✅ Appliqué | Le HTML n'est parsé qu'une seule fois au lieu de multiples traversées DOM. |
| **OPT-3** | Cache `WeakMap` des Styles Inline | ✅ Appliqué | Élimine les parsings répétés d'attributs `style="..."` sur les nœuds du DOM. Libération automatique par V8 GC sans fuite mémoire. |
| **OPT-4** | Cache LRU de Mesure de Texte (`TextMeasureCache`) | ✅ Appliqué | Évite les ré-exécutions coûteuses de `doc.heightOfString()` sur des textes identiques (borné à 512 entrées). |
| **OPT-5** | Pré-compilation des Regex Module-Level | ✅ Appliqué | Supprime la re-compilation de regex dans les boucles CSS. |
| **OPT-6** | Hoisting des Sérialisations CSS | ✅ Appliqué | La chaîne CSS d'une règle est sérialisée 1 fois par règle au lieu de N fois par élément. |
| **OPT-7** | Chargement Parallèle I/O (`Promise.all`) | ✅ Appliqué | Téléchargement parallèle asynchrone des polices `@font-face` et images distantes avec timeouts stricts. |
| **OPT-8** | Correction du Bug de Concurrence Typographique | ✅ Appliqué | Registre des polices scopé par document (Set thread-safe par génération de PDF). |
| **OPT-9** | Classe `PageLayout` | ✅ Appliqué | Marges, hauteurs et limites géométriques de page pré-calculées une fois par page. |
| **OPT-10**| Couverture de Tests >90% | ✅ Appliqué | **90.66% de lignes** et **86.29% de branches** couvertes par les tests (`test/optimizations.test.ts`). |
| **OPT-11**| Test d'Endurance Séquentiel (Soak Test) | ✅ Appliqué | 200 PDFs consécutifs exécutés sans dégradation de vitesse ni fuite mémoire Heap (`npm run test:soak`). |
| **OPT-12**| Transfert Zéro-Copie (`Transferable ArrayBuffers`) | ✅ Appliqué | Transfert binaire IPC instantané sans copie d'octets entre les workers et le thread principal. |
| **OPT-13**| Offloading Multi-Thread (Worker Pool Élastique) | ✅ Appliqué | **15 000 PDFs** traités en **56.03 s** (~267 PDFs/sec) avec concurrence régulée à 80% CPU (`npm run test:soak:parallel`). |

---

## 📈 Résultats des Benchmarks de Performance

Pour consulter les mesures détaillées et actualisées sur machine physique, référez-vous au [**Rapport de Benchmark Complet (`docs/benchmark.md`)**](benchmark.md).

### Synthèse des Débits par Document (Mono-Thread) :

| Document / Modèle | Latence Moyenne | Débit Approximatif |
|---|:---:|:---:|
| **Certificat Paysage (A4)** | ~11.8 ms | **~85 docs / seconde** |
| **Facture Professionnelle (A4)** | ~18.1 ms | **~55 docs / seconde** |
| **Catalogue Produit (A4)** | ~21.2 ms | **~47 docs / seconde** |
| **Rapport Éditorial (A4)** | ~25.6 ms | **~39 docs / seconde** |
| **Dashboard Analytique (A4)** | ~26.1 ms | **~38 docs / seconde** |
| **Document Texte Multi-pages (80 par.)** | ~29.1 ms | **~34 docs / seconde** |
| **Grand Tableau (100 lignes × 5 cols)** | ~38.0 ms | **~26 docs / seconde** |
| **Rapport Complet (Texte + Table + CSS `@page`)** | ~60.5 ms | **~16 docs / seconde** |

---

## 🔬 Test d'Endurance Multi-Thread (15 000 PDFs en 56s)

Exécution de 15 000 générations de PDF avec le pool de Worker Threads secondaires et *Transferable ArrayBuffers* (`bench/soak-test-15k-parallel.ts`) :

- **Throughput Extrême** : **~267 PDFs / seconde** (3.74 ms / PDF en moyenne sous charge massive).
- **Consommation CPU** : Plafonnée à **80% de la totalité des cœurs** processeur (mode paramétrable).
- **Stabilité Mémoire (RSS)** : Mémoire RSS régulée à **~20.9 MB** sans explosion mémoire grâce à la queue de concurrence `maxWorkers * 2`.
- **Auto-Extinction Élastique** : Extinction automatique des workers inactifs après 10s d'inactivité pour restituer la RAM à l'OS.

---

## 🛠️ Exécuter les Benchmarks

```bash
# Benchmark officiel unifié (Mono-Thread, Templates réels, WorkerPool 50 docs)
npm run benchmark

# Test d'endurance séquentiel (200 docs)
npm run test:soak

# Test de charge massif parallèle (15 000 docs)
npm run test:soak:parallel
```
