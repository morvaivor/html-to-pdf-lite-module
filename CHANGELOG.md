# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) or [Release Please](https://github.com/googleapis/release-please) for automated commit specifications.

## [2.1.0](https://github.com/morvaivor/html-to-pdf-lite-module/compare/pdf-generator-v2.0.0...pdf-generator-v2.1.0) (2026-09-06)


### Features

* add [@font-face](https://github.com/font-face) support (TTF/OTF via url() http(s) and data URI) ([5642dde](https://github.com/morvaivor/html-to-pdf-lite-module/commit/5642dde64bda246d3b5783b56a2009415c703a28))
* add [@page](https://github.com/page) CSS rule support for headers/footers with counter(page) ([a16ac22](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a16ac2213eb6dc5a8184b01120a0c2e0649ca5e5))
* add benchmark and optimization documentation for html-to-pdf-lite-module ([748485c](https://github.com/morvaivor/html-to-pdf-lite-module/commit/748485cd31e2e73914df1d2051fe221860027aed))
* add external CSS support (config, classes, IDs, per-call override) ([574f56a](https://github.com/morvaivor/html-to-pdf-lite-module/commit/574f56aee02aac3f9f337e64cbd9ec27c3d4aef3))
* add header and footer support with page numbering ({page} / {totalPages}) ([7ae79f4](https://github.com/morvaivor/html-to-pdf-lite-module/commit/7ae79f48ed0b7592ad016ed67e2046e2ca832ea2))
* add image support (data URI, local files, URLs, width/height, pagination) ([9fe99c2](https://github.com/morvaivor/html-to-pdf-lite-module/commit/9fe99c24ec57ec15bba0cf9d0cd11cd5fb6b6430))
* add list rendering support (ul, ol, li, nested lists, pagination) ([746254d](https://github.com/morvaivor/html-to-pdf-lite-module/commit/746254dcb38afa36128fc58215ec501f54083868))
* add rowspan support for tables ([23ec60a](https://github.com/morvaivor/html-to-pdf-lite-module/commit/23ec60afae5da41a9f28480daaab2df5801945f4))
* add table rendering support (thead, tbody, tr, td, th, colspan, borders, padding, CSS) ([4d13fd7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/4d13fd726837cde7b9d425888ec1a2c7afd263f3))
* ajouter des instructions d'installation et de configuration dans le README ([0a12e89](https://github.com/morvaivor/html-to-pdf-lite-module/commit/0a12e896b67b72f37d3c74da0fb3929806da2e1d))
* ajouter l'audit de qualité de rendu pour les PDF générés et améliorer la gestion des styles ([32840d2](https://github.com/morvaivor/html-to-pdf-lite-module/commit/32840d296c441df6da96eafa2ae6e705d35d1da8))
* ajouter la démo GitHub Pages avec 5 exemples HTML-to-PDF et suivi des tests ([744f4d7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/744f4d777ac06b8f9388dd5dafe91c86b34d5411))
* ajouter la gestion du cache de résolution des polices et améliorer le calcul de la hauteur des éléments ([3a04ae1](https://github.com/morvaivor/html-to-pdf-lite-module/commit/3a04ae1021ab615817f140791c2d06e1adb72e8c))
* ajouter la prise en charge des mises en page flexibles et en grille, améliorer la gestion des styles et des tests associés ([c97d592](https://github.com/morvaivor/html-to-pdf-lite-module/commit/c97d5929278ea303b2334bf86f9a2d9ad251c4b2))
* ajouter le support de text-decoration (underline/line-through) + tests 46/47 ([c40acf5](https://github.com/morvaivor/html-to-pdf-lite-module/commit/c40acf55d42f9fa804b94206caf2cf0068e646d1))
* Améliorer le rendu des tableaux et des listes, optimiser le parsing CSS ([89edd99](https://github.com/morvaivor/html-to-pdf-lite-module/commit/89edd9965fb6de8f0de8ce38e7671e51b6685cee))
* améliorer le traitement des styles CSS et la gestion des largeurs de colonnes dans le rendu des tableaux ([d7d6f43](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d7d6f43c2dac7e4c6c9ce3af956b66f1c2764c4b))
* **ci:** add dependabot, commitlint, and release please workflow ([27e672e](https://github.com/morvaivor/html-to-pdf-lite-module/commit/27e672e0d05d1efd94ad93bda98fddba3a528bd8))
* enhance rendering capabilities and style handling ([05aa264](https://github.com/morvaivor/html-to-pdf-lite-module/commit/05aa2644b043f95d7e0898396280dd2c2e015c0d))
* HTML to PDF generator with pagination, CSS inline, and page options ([a1130fe](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a1130feafa12af7354799744fc8ba57942bee48b))
* Implement list and table rendering in PDF generator ([3829265](https://github.com/morvaivor/html-to-pdf-lite-module/commit/3829265d8788f76d6b166834a424cb4f203fa76f))
* optimize render css style add a github pages ([8248b7a](https://github.com/morvaivor/html-to-pdf-lite-module/commit/8248b7ad59bd6ed9e7c726439f051a2ce3bce3a2))
* **perf:** optimize rendering pipeline, memory stability and test coverage ([#10](https://github.com/morvaivor/html-to-pdf-lite-module/issues/10)) ([1411c8c](https://github.com/morvaivor/html-to-pdf-lite-module/commit/1411c8cae45e49fc34e1f4f1e0f84cc78ff85139))
* support nested tables up to 5 levels deep ([eedda24](https://github.com/morvaivor/html-to-pdf-lite-module/commit/eedda2484a003fcde7350c3774729ee81a864b5f))
* supprimer la branche de déploiement pour GitHub Pages ([a0d23c8](https://github.com/morvaivor/html-to-pdf-lite-module/commit/a0d23c85973463d5430ddf1934a54666038204a5))
* supprimer le workflow de déploiement vers GitHub Pages ([80609c0](https://github.com/morvaivor/html-to-pdf-lite-module/commit/80609c067bf67d1bfe6d52fca7e3a19045f87cd7))


### Bug Fixes

* **ci:** installer unrun en devDependency et passer Node.js à v22 pour tsdown ([fffe0ca](https://github.com/morvaivor/html-to-pdf-lite-module/commit/fffe0ca83e74dea2dcb08187adeec426e14af0a7))
* correct list pagination by using doc.x/doc.y positioning instead of explicit coordinates ([45bfe15](https://github.com/morvaivor/html-to-pdf-lite-module/commit/45bfe1546967c4ba328a28c150124e29a35d99d1))
* header/footer rendering and page numbering on multi-page PDFs ([582a9ec](https://github.com/morvaivor/html-to-pdf-lite-module/commit/582a9ec38ed071297a841f14a832e8df03990ede))
* **lint:** corriger les 9 erreurs oxlint (node: protocol, imports et variable inutilisés) ([d1596dd](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d1596dda73108aa08254c7948de44c48ab457fbd))
* **lint:** corriger les 9 erreurs oxlint (node: protocol, imports et variable inutilisés) ([423ce54](https://github.com/morvaivor/html-to-pdf-lite-module/commit/423ce540d29f3ccf8478ef65ba0c1c52357677b1))
* prevent double rendering of block elements with single text child ([da4fe94](https://github.com/morvaivor/html-to-pdf-lite-module/commit/da4fe94ec6a96f8b7c367ac3c9de4b1d8a64755d))
* reserve space for header/footer in pagination to prevent blank pages ([1c1d356](https://github.com/morvaivor/html-to-pdf-lite-module/commit/1c1d3563113ebccd3b59e7ca079d573d4942d99a))
* save/restore cursor position after drawing header/footer to prevent blank pages ([f0f57b7](https://github.com/morvaivor/html-to-pdf-lite-module/commit/f0f57b7393b986874ce3ddc3dca8d1a588f4f7af))
* use Helvetica-Oblique instead of Helvetica-Italic for Standard 14 fonts ([d81e829](https://github.com/morvaivor/html-to-pdf-lite-module/commit/d81e829b776a07e3bcaba3241e460748cd665f03))

## [2.0.0] - 2026-09-05

### Features
- Support for inline and external CSS styling (`line-height`, `letter-spacing`, `text-decoration`).
- Advanced table rendering support including `thead`/`tbody`, borders, padding, `colspan`, and `rowspan`.
- Dynamic header & footer support with `@page` pseudo-selectors and multi-zone layout.
- Support for SVG vector graphics and custom `@font-face` resolution (local files and data URIs).
- High performance Worker Pool execution architecture for multi-page PDF generation.
