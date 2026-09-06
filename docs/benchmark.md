# 📊 Rapport de Benchmark & Performances — v2.0.0

> **Date d'exécution** : 2026-09-06  
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
| **Document Texte Multi-pages (80 par.)** | 26.51 ms | **28.48 ms** | 33.65 ms | ~35.1 docs/s | 7.0 KB |
| **Grand Tableau (100 lignes x 5 cols)** | 32.44 ms | **34.31 ms** | 36.51 ms | ~29.1 docs/s | 7.7 KB |
| **Rapport Complet (Texte + Table + CSS)** | 54.35 ms | **58.13 ms** | 72.43 ms | ~17.2 docs/s | 8.9 KB |

### 🎨 Modèles Professionnels Réels (`demo/templates/`)

| Modèle HTML/CSS | Latence Min | Latence Moyenne | Latence Max | Débit Unitaire | Taille PDF |
|---|:---:|:---:|:---:|:---:|:---:|
| **Rapport Éditorial (A4)** | 21.40 ms | **22.84 ms** | 25.37 ms | ~43.8 docs/s | 5.3 KB |
| **Catalogue Produit (A4)** | 18.21 ms | **20.39 ms** | 24.86 ms | ~49.0 docs/s | 5.9 KB |
| **Dashboard Analytique (A4)** | 21.83 ms | **25.61 ms** | 34.23 ms | ~39.0 docs/s | 7.2 KB |
| **Facture Professionnelle (A4)** | 15.83 ms | **17.15 ms** | 20.75 ms | ~58.3 docs/s | 4.1 KB |
| **Certificat Paysage (A4)** | 10.57 ms | **11.36 ms** | 13.63 ms | ~88.0 docs/s | 3.6 KB |

---

## 🚀 2. Scalabilité Multi-Thread (Worker Pool vs Mono-Thread)

Comparatif lors de la génération concurrente d'un lot de **50 documents** hétérogènes :

| Mode d'Exécution | Unités d'Exécution | Durée Totale (Lot de 50) | Débit Global (Throughput) | Facteur d'Accélération |
|---|:---:|:---:|:---:|:---:|
| **Mono-Thread** (Event Loop principal) | 1 thread | 1280.9 ms | 39.0 docs/seconde | Référence (1.0x) |
| **Worker Pool Élastique** (80% CPU) | **9 threads** | **565.7 ms** | **88.4 docs/seconde** | **x2.26 plus rapide** |

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
