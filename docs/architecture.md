# Architecture Technique — `html-to-pdf-lite-module`

## 📐 Vue d'Ensemble & Structure Modulaire

`html-to-pdf-lite-module` est un moteur léger de conversion HTML + CSS vers PDF sous Node.js.  
Le moteur est structuré de façon strictement modulaire suivant les principes **SOLID** et inclut un pool de Worker Threads **100% élastique et à la demande** (Mode Modéré par défaut : 50% CPU, RAM hors charge ~116 MB).

```
src/
├── index.js                     # Point d'entrée du package
├── pdfGenerator.js              # Façade principale (API publique & diagnostics)
├── cssParser.js                 # Parser CSS (règles, sélecteurs, @font-face, @page)
├── types.d.ts                   # Définitions des types TypeScript
├── core/
│   ├── PageLayout.js            # Définition de la géométrie et limites de page
│   ├── cacheManager.js          # TextMeasureCache (LRU) et WeakMap style cache
│   └── fontManager.js           # Téléchargement et enregistrement des polices @font-face
├── renderers/
│   ├── registry.js              # Element Handler Registry (Map des handlers de balises)
│   ├── textRenderer.js          # Rendu des paragraphes et nœuds de texte
│   ├── tableRenderer.js         # Rendu des tableaux, grilles, colspan, rowspan
│   ├── listRenderer.js          # Rendu des listes ul, ol, li
│   ├── imageRenderer.js         # Rendu des images (fichiers locaux, HTTP, base64)
│   └── headerFooterRenderer.js  # Rendu des zones @page et templates header/footer
├── workers/
│   ├── pdfWorker.js             # Handler exécuté sur les Worker Threads secondaires (Zero-Copy)
│   └── workerPool.js            # Gestionnaire du pool élastique à la demande (Dynamic Scale Up/Down)
└── htmlRenderer.js              # Orchestrateur du pipeline de rendu
```

---

## ⚙️ Worker Pool Élastique à la Demande (`workers/`)

- **0 Worker au repos (RAM ~116 MB)** : Au démarrage, 0 worker n'est réservé en mémoire.
- **Scale-Up dynamique** : Dès que des requêtes concourantes arrivent, les workers sont instanciés à la demande jusqu'à `maxWorkers` (défaut `cpuRatio: 0.5` soit **50% des cœurs processeur**).
- **Transfert Zéro-Copie (`Transferable ArrayBuffers`)** : Transmission des PDF binaires sans aucune copie d'octets inter-threads.
- **Scale-Down & Auto-Extinction** : Après `idleTimeoutMs` (défaut : 10s d'inactivité), chaque worker s'éteint automatiquement et rend toute sa mémoire RAM au système d'exploitation.
- **Diagnostics (`generator.getWorkerStats()`)** : Retourne en temps réel le nombre de workers actifs, libres, et de tâches en file d'attente.
