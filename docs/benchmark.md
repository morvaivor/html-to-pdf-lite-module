# 📊 Rapport de Benchmark, Offloading CPU (80%) & Endurance 15 000 PDFs

> **Date d'exécution** : 2026-09-02  
> **Environnement** : Node.js v24.19.0 (win32 x64 - 12 cœurs CPU)  
> **Module** : `html-to-pdf-lite-module`

---

## 🎯 Objectif

Évaluer la vitesse de rendu et le profil de mémoire lors de la génération concourante de **15 000 documents PDF variés** (incluant 75 rapports massifs de **>800 pages** chacun) en mode mono-thread et multi-thread (Worker Thread Pool élastique à la demande).

---

## 🚀 Benchmark Multi-Thread Zéro-Copie (Worker Pool Élastique - 15 000 PDFs)

Le script [`bench/soak-test-15k-parallel.js`](file:///d:/Code/html-to-pdf-lite-module/bench/soak-test-15k-parallel.js) a été exécuté avec l'architecture **Worker Pool Élastique à la Demande** et **Transfert Zéro-Copie (Transferable Objects)**.

```
====================================================================
🚀 TEST 15 000 PDFs MULTI-THREAD AVEC CONCURRENCE REGULÉE
====================================================================

  Progrès :  4 500/15000 ( 30%) | Vitesse : 3.80 ms/doc | Heap : 20.00 MB
  Progrès :  9 000/15000 ( 60%) | Vitesse : 3.75 ms/doc | Heap : 18.96 MB
  Progrès : 13 500/15000 ( 90%) | Vitesse : 3.72 ms/doc | Heap : 16.84 MB
  Progrès : 15 000/15000 (100%) | Vitesse : 3.71 ms/doc | Heap : 16.84 MB

--------------------------------------------------------------------
📊 RÉSULTATS DU BENCHMARK PARALLÈLE MULTI-THREAD (ÉLASTIQUE + ZERO-COPY)
--------------------------------------------------------------------
  Durée totale      : 55.72 secondes (3.71 ms / PDF en moyenne)
  Throughput        : ~270 PDFs générés par seconde
  Mémoire Heap Final: 16.84 MB (Stabilité absolue)
  Statut Workers    : Extinction automatique des workers inactifs (0 MB résiduel)
```

---

## 📉 Synthèse des Benchmarks

| Scénario d'essai | Mode d'exécution | Durée Totale | Vitesse Moyenne | Mémoire Heap |
|---|:---:|:---:|:---:|:---:|
| **Rapport Unitaire Complet** | Mono-thread | 11.22 ms | **11.22 ms/doc** | 39.37 MB |
| **Endurance 200 PDFs** | Mono-thread | 1.04 s | **5.20 ms/doc** | 21.80 MB |
| **Endurance 10 000 PDFs** | Mono-thread | 47.28 s | **4.73 ms/doc** | 18.36 MB |
| **Endurance 15 000 PDFs (dont 75 docs >800p)** | Mono-thread | 281.05 s | **18.74 ms/doc** | **19.33 MB** |
| **Endurance 15 000 PDFs en Parallèle (Zéro-Copie)** | **Multi-thread Élastique** | **55.72 s** | **3.71 ms/doc** | **16.84 MB** |

---

## 🎯 Conclusions

1. **Vitesse Record (270 PDFs / seconde)** : Temps moyen par PDF abaissé à **3.71 ms / PDF** pour 15 000 documents traités en 55.72 secondes.
2. **Mémoire Heap Minimaliste (16.84 MB)** : Aucune fuite de mémoire JavaScript après 15 000 documents.
3. **Extinction Élastique** : Les workers secondaires s'éteignent automatiquement 10 secondes après la fin du benchmark, restituant la mémoire RAM à l'OS.
