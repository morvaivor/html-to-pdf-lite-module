# Guide & Bilan d'Optimisation — `html-to-pdf-lite-module`

> **Philosophie du projet** : Maintenir un moteur ultra-léger, sans dépendances headless lourdes (sans Chromium/Puppeteer), hautement concurrentiel et préservant l'Event Loop de Node.js.

---

## 📊 Bilan des Optimisations Natives (Patches 01 à 12 — v2.3.0)

Toutes les optimisations suivantes sont implémentées en standard dans le code de production :

| Patch | Domaine | Statut | Gain & Description |
|:---:|---|:---:|---|
| **01** | Correctness `TextMeasureCache` | ✅ Actif | Clé composite intégrale (`fontFamily\|fontSize\|maxWidth\|lineGap\|text`) et rafraîchissement LRU lors d'un hit. Élimine les collisions sur chaînes de même longueur. |
| **02** | Cache générique réutilisable `LruCache` | ✅ Actif | Éviction $O(1)$ par double liste chaînée + Map. Remplace les purges destructives `cache.clear()` sur les styles et le CSS, supprimant le cache-thrashing. |
| **03** | Sélecteurs CSS indexés | ✅ Actif | Indexation des règles CSS par ID (`byId`), classe (`byClass`), balise (`byTag`) et sélecteurs complexes. Résolution en une seule passe DOM ($O(nodes)$ au lieu de $O(rules \times nodes)$). |
| **04** | Cache d'actifs inter-PDF | ✅ Actif | `AssetCache` partagé avec déduplication des requêtes distantes en vol (*promise coalescing*). Les polices et images récurrentes ne sont téléchargées et décodées qu'une seule fois. |
| **05** | Sommes préfixes de tableau en $O(1)$ | ✅ Actif | Calcul instantané des positions et largeurs de colonnes (`columnX`) et hauteurs de lignes (`rowPrefix`). Supprime les `.slice().reduce()` répétitifs dans les grands tableaux (ex: 1 000 lignes × 10 colonnes en ~378 ms). |
| **06** | Mémoïsation du layout (`estimateElementHeight`) | ✅ Actif | Cache `WeakMap` de layout (`LayoutMeasurementCache`) associant élément DOM et contraintes de largeur pour court-circuiter les ré-estimations dans les conteneurs flex/grid. |
| **07** | Indexation directe des polices | ✅ Actif | Indexation normalisée `family\|bold\|italic` dans `_aliasDirectIndex`. Résolution des variantes typographiques en $O(1)$ direct sans scan linéaire de `Set`. |
| **08** | Bounded Backpressure & File bornée | ✅ Actif | `maxQueueSize` configurable (défaut `maxWorkers * 2`). En cas de surcharge, rejet immédiat avec `WorkerPoolBusyError` sans fuite mémoire ni tâche pendante. |
| **09** | Seuil de workers chauds (`minWorkers`) | ✅ Actif | Maintien d'un plancher de threads chauds pré-initialisés pour éliminer la latence de démarrage à froid sur les requêtes initiales. |
| **10** | Profilage par phase sans surcoût | ✅ Actif | Déclenchable via `debug: true` (ou `verbose: true` / `logLevel: 'DEBUG'`) pour afficher le log `[Sondes Profilage]`, ou via `profiling: true` et `onProfile(timings)` pour inspection programmatique. Zéro surcoût au repos. |
| **11** | Matrice de benchmark étendue | ✅ Actif | Fixtures complètes dans `bench/benchmark.ts` (CSS scale, typographie répétée vs unique, tables massives, deep layout, matrices de concurrence 1 à 16). |
| **12** | Documentation automatisée des performances | ✅ Actif | Génération dynamique de `docs/benchmark.md` avec horodatage, hash git, version exacte et caractéristiques matérielles. |

---

## 📈 Résultats des Benchmarks de Performance

Pour consulter les mesures détaillées et actualisées sur machine physique, référez-vous au [**Rapport de Benchmark Complet (`docs/benchmark.md`)**](benchmark.md).

### Synthèse des Débits par Document (Mono-Thread) :

| Document / Modèle | Latence Moyenne | Débit Mesuré | Taille PDF |
|---|:---:|:---:|:---:|
| **Certificat Paysage (A4)** | ~13.3 ms | **~75.0 docs / s** | 3.6 KB |
| **Catalogue Produit (A4)** | ~20.2 ms | **~49.4 docs / s** | 5.9 KB |
| **Facture Professionnelle (A4)** | ~20.9 ms | **~47.8 docs / s** | 4.1 KB |
| **Rapport Éditorial (A4)** | ~23.9 ms | **~41.8 docs / s** | 5.3 KB |
| **Table (100 lignes × 5 cols)** | ~26.6 ms | **~37.6 docs / s** | 7.2 KB |
| **Dashboard Analytique (A4)** | ~29.6 ms | **~33.7 docs / s** | 7.2 KB |
| **Typography (1000 par. répétés)** | ~105.5 ms | **~9.5 docs / s** | 38.6 KB |
| **Table Massive (1000 lignes × 10 cols)** | ~378.4 ms | **~2.6 docs / s** | 102.3 KB |

---

## 🔬 Scalabilité Multi-Thread (Worker Pool)

Exécution concurrente avec le pool de Worker Threads secondaires et *Transferable ArrayBuffers* (`bench/benchmark.ts`) :

- **Throughput de pointe** : **~60.6 PDFs / seconde** sur requêtes simultanées.
- **Protection contre la surcharge** : Bounded queue avec rejet `WorkerPoolBusyError` au-delà de `maxQueueSize`.
- **Zéro-Copie Binaire** : Transfert mémoire instantané via `ArrayBuffer.transfer` sans duplication de mémoire.
- **Plancher de Workers Chauds** : Démarrage instantané dès la 1ère requête via `minWorkers: 2`.
- **Auto-Extinction Élastique** : Extinction automatique des workers au-dessus du plancher après 10s d'inactivité.

---

## 🛠️ Exécuter les Benchmarks

```bash
# Benchmark officiel unifié (Mono-Thread, Microbenchmarks, Profilage, Concurrence)
npm run benchmark

# Test d'endurance séquentiel (200 docs)
npm run test:soak

# Test de charge massif parallèle (15 000 docs)
npm run test:soak:parallel
```
