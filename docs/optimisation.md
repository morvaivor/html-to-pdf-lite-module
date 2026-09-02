# Guide et Roadmap d'Optimisation — `html-to-pdf-lite-module`

> **Philosophie du projet** : Maintenir un moteur ultra-léger, sans dépendances lourdes, testable et hautement évolutif.

---

## 📊 Bilan des Optimisations Réalisées

| ID | Domaine | Statut | Gain Obtenu |
|---|---|:---:|---|
| **OPT-1** | Conditional Two-Pass Rendering | ✅ Appliqué | Élimine 100% de la passe de comptage si `counter(num-pages)` n'est pas utilisé. |
| **OPT-2** | Partage de l'AST Cheerio | ✅ Appliqué | Le HTML n'est parsé qu'une seule fois au lieu de 2 à 40 fois. |
| **OPT-3** | Cache `WeakMap` des Styles Inline | ✅ Appliqué | Élimine les parsings répétés d'attributs `style="..."` sur les nœuds du DOM. Libération automatique par V8 GC. |
| **OPT-4** | Cache LRU de Mesure de Texte (`TextMeasureCache`) | ✅ Appliqué | Évite les ré-exécutions coûteuses de `doc.heightOfString()` sur des textes identiques (borné à 512 entrées). |
| **OPT-5** | Pré-compilation des Regex Module-Level | ✅ Appliqué | Supprime la re-compilation de regex dans les boucles CSS. |
| **OPT-6** | Hoisting des Sérialisations CSS | ✅ Appliqué | La chaîne CSS d'une règle est sérialisée 1 fois par règle au lieu de N fois par élément. |
| **OPT-7** | Chargement Parallèle I/O (`Promise.all`) | ✅ Appliqué | Téléchargement parallèle des polices `@font-face` et images distantes. |
| **OPT-8** | Correction du Bug de Concurrence | ✅ Appliqué | Registre des polices scopé par document (Set thread-safe par appel). |
| **OPT-9** | Classe `PageLayout` | ✅ Appliqué | Marges, hauteurs et limites de page pré-calculées une fois par page. |
| **OPT-10**| Couverture de Tests >90% | ✅ Appliqué | **90.66% de lignes** et **86.29% de branches** couvertes par les tests. |
| **OPT-11**| Test d'Endurance Extrême (10 000 PDFs) | ✅ Appliqué | Validation de 10 000 générations consécutives en 47s sans dégradation ni fuite mémoire. |
| **OPT-12**| Transfert Zéro-Copie (`Transferable ArrayBuffers`) | ✅ Appliqué | Transfert binaire IPC instantané sans copie d'octets entre les workers et le thread principal. |
| **OPT-13**| Offloading Multi-Thread (Worker Pool 80% CPU & 15 000 PDFs) | ✅ Appliqué | **15 000 PDFs** traités en **56.03 s** (~267 PDFs/sec). |

---

## 📈 Résultats des Benchmarks de Performance

| Scénario d'essai | Mode d'exécution | Durée Totale | Vitesse Moyenne | Mémoire Heap |
|---|:---:|:---:|:---:|:---:|
| **Document Texte Multi-pages (80 par.)** | Mono-thread | 4.47 ms | **4.47 ms/doc** | 2.55 MB |
| **Grand Tableau (100 lignes x 5 cols)** | Mono-thread | 15.13 ms | **15.13 ms/doc** | 0.00 MB |
| **Rapport Complet (Texte + Table + CSS)** | Mono-thread | 11.22 ms | **11.22 ms/doc** | 39.37 MB |
| **Endurance 15 000 PDFs en Parallèle (Zéro-Copie)** | **Multi-thread (80% CPU)** | **56.03 s** | **3.74 ms/doc** | **20.94 MB** |

---

## 🔬 Test d'Endurance Multi-Thread (15 000 PDFs en 56s)

Exécution de 15 000 générations de PDF avec 9 Worker Threads secondaires et *Transferable ArrayBuffers* (`bench/soak-test-15k-parallel.js`) :

- **Throughput** : **267 PDFs / seconde** (3.74 ms / PDF).
- **Consommation CPU** : Plafonnée à **80% de la totalité des cœurs** de la machine.
- **Stabilité RAM** : Mémoire Heap stabilisée à **~20.9 MB**. Extinction automatique des workers inactifs après 10s d'inactivité.
