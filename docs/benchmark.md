# 📊 Rapport de Benchmark & Performances — v2.0.0

> **Date d'exécution** : 2026-09-05  
> **Environnement Système** : Node.js v24.19.0 — Windows_NT 10.0.26200 (x64)  
> **Processeur Hôte** : AMD Ryzen 5 3600 6-Core Processor               (12 cœurs logiques)  
> **Mémoire Système** : 15.9 GB RAM  
> **Module testé** : `pdf-generator` (Stack OXC + TypeScript)

---

## 🎯 Objectif du Benchmark

Ce benchmark évalue les performances réelles du moteur `pdf-generator` v2.0.0 sous deux axes majeurs :
1. **Latence unitaire et débit mono-thread** sur des charges synthétiques stressantes et des modèles professionnels réels.
2. **Scalabilité multi-thread via le Worker Thread Pool** élastique avec transfert binaire zéro-copie (`Transferable ArrayBuffer`).

---

## ⚡ 1. Performances Mono-Thread (Latence Unitaire & Débit)

Les mesures ci-dessous ont été obtenues après amorçage des caches mémoires (`WeakMap` styles, `TextMeasureCache` LRU, et caches typographiques).

### 📋 Charges Synthétiques de Stress

| Scénario d'essai | Latence Min | Latence Moyenne | Latence Max | Débit Unitaire | Taille PDF |
|---|:---:|:---:|:---:|:---:|:---:|
| **Document Texte Multi-pages (80 par.)** | 25.89 ms | **29.13 ms** | 36.18 ms | ~34.3 docs/s | 7.0 KB |
| **Grand Tableau (100 lignes x 5 cols)** | 32.73 ms | **38.00 ms** | 47.09 ms | ~26.3 docs/s | 7.7 KB |
| **Rapport Complet (Texte + Table + CSS)** | 57.27 ms | **60.57 ms** | 70.55 ms | ~16.5 docs/s | 8.9 KB |

### 🎨 Modèles Professionnels Réels (`demo/templates/`)

| Modèle HTML/CSS | Latence Min | Latence Moyenne | Latence Max | Débit Unitaire | Taille PDF |
|---|:---:|:---:|:---:|:---:|:---:|
| **Rapport Éditorial (A4)** | 22.54 ms | **25.63 ms** | 37.96 ms | ~39.0 docs/s | 5.3 KB |
| **Catalogue Produit (A4)** | 19.59 ms | **21.19 ms** | 23.77 ms | ~47.2 docs/s | 5.9 KB |
| **Dashboard Analytique (A4)** | 23.26 ms | **26.09 ms** | 29.84 ms | ~38.3 docs/s | 7.2 KB |
| **Facture Professionnelle (A4)** | 17.02 ms | **18.14 ms** | 20.97 ms | ~55.1 docs/s | 4.1 KB |
| **Certificat Paysage (A4)** | 11.09 ms | **11.82 ms** | 14.51 ms | ~84.6 docs/s | 3.6 KB |

---

## 🚀 2. Scalabilité Multi-Thread (Worker Pool vs Mono-Thread)

Comparatif lors de la génération concurrente d'un lot de **50 documents** hétérogènes :

| Mode d'Exécution | Unités d'Exécution | Durée Totale (Lot de 50) | Débit Global (Throughput) | Facteur d'Accélération |
|---|:---:|:---:|:---:|:---:|
| **Mono-Thread** (Event Loop principal) | 1 thread | 1263.3 ms | 39.6 docs/seconde | Référence (1.0x) |
| **Worker Pool Élastique** (80% CPU) | **9 threads** | **597.0 ms** | **83.8 docs/seconde** | **x2.12 plus rapide** |

> [!TIP]
> **Zéro-Copie IPC** : Les transferts binaires entre les workers et le thread principal s'effectuent via `ArrayBuffer.transfer` / `Transferable`. Aucun coût de sérialisation JSON ou de copie mémoire n'est encouru lors du rapatriement des buffers PDF.

---

## 🔬 Architecture des Optimisations Actives

Toutes les optimisations de la version 2.0 sont désormais natives dans le code de production :

1. **Rendu en Passe Unique (Single-Pass AST)** :
   - Le DOM Cheerio est parsé une seule fois.
   - La seconde passe de comptage de pages n'est déclenchée que si le document CSS utilise explicitement `counter(num-pages)`.
2. **Caches Mémoire à Haute Efficacité** :
   - `WeakMap` pour le parsing des styles inline : garbage-collecté automatiquement sans aucune fuite mémoire.
   - `TextMeasureCache` (LRU borné à 512 entrées) : évite le recalcul des glyphes typographiques répétitifs.
   - Cache partagé des polices et images distantes par document.
3. **Pool Élastique de Worker Threads** :
   - **0 thread au repos** (~116 MB résiduel).
   - Démarrage instantané à la demande avec limitation CPU paramétrable (`cpuRatio: 0.5` ou `0.8`).
   - Arrêt automatique des workers inactifs après 10s pour restituer la RAM à l'OS.
4. **Protocole de Nettoyage Automatique** :
   - Implémentation native de `Symbol.asyncDispose` pour une syntaxe `await using generator = createPdfGenerator(...)` sous Node.js ≥ 22.

---

## 📈 Rapport d'Endurance (Soak Tests)

Des tests d'endurance de longue durée sont également disponibles dans le dossier `bench/` :
- `npm run test:soak` : Test de répétition séquentielle (200 PDFs) pour la stabilité du Heap.
- `npm run test:soak:parallel` : Test de charge de **15 000 PDFs** en concurrence régulée à 80% CPU (~267 PDFs/seconde avec RSS stabilisé).
