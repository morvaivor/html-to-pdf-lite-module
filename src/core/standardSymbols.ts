/**
 * Glyphs of the standard Symbol and ZapfDingbats fonts, which every PDF viewer provides: symbols such as
 * ✔ ★ ● → ≤ ∞ β are drawn with them instead of being dropped, without embedding any font. Both fonts use
 * their built-in encoding, so each glyph is one byte whose advance width comes from the Adobe Core 14
 * metrics (units of 1/1000 em).
 */

export type SymbolFontName = 'Symbol' | 'ZapfDingbats';

export interface SymbolGlyph {
  readonly font: SymbolFontName;
  /** Byte of the glyph in the font's built-in encoding. */
  readonly code: number;
  /** Advance width, in 1/1000 em. */
  readonly width: number;
}

// "unicode:code:width" (code point and byte in hexadecimal), generated from the AFM files shipped with
// PDFKit (js/data/Symbol.afm and ZapfDingbats.afm) with the Adobe Glyph List and ZapfDingbats glyph list.
// Characters that WinAnsi already encodes are left out.
const SYMBOL_GLYPHS: readonly string[] = [
  '391:41:722 392:42:667 393:47:603 394:44:612 395:45:611 396:5a:611 397:48:722 398:51:741 399:49:333',
  '39a:4b:722 39b:4c:686 39c:4d:889 39d:4e:722 39e:58:645 39f:4f:722 3a0:50:768 3a1:52:556 3a3:53:592',
  '3a4:54:611 3a5:55:690 3a6:46:763 3a7:43:722 3a8:59:795 3a9:57:768 3b1:61:631 3b2:62:549 3b3:67:411',
  '3b4:64:494 3b5:65:439 3b6:7a:494 3b7:68:603 3b8:71:521 3b9:69:329 3ba:6b:549 3bb:6c:549 3bc:6d:576',
  '3bd:6e:521 3be:78:493 3bf:6f:549 3c0:70:549 3c1:72:549 3c2:56:439 3c3:73:603 3c4:74:439 3c5:75:576',
  '3c6:66:521 3c7:63:549 3c8:79:686 3c9:77:686 3d1:4a:631 3d2:a1:620 3d5:6a:603 3d6:76:713 2032:a2:247',
  '2033:b2:411 2044:a4:167 2111:c1:686 2118:c3:987 211c:c2:795 2126:57:768 2135:c0:823 2190:ac:987 2191:ad:603',
  '2192:ae:987 2193:af:603 2194:ab:1042 21b5:bf:658 21d0:dc:987 21d1:dd:603 21d2:de:987 21d3:df:603 21d4:db:1042',
  '2200:22:713 2202:b6:494 2203:24:549 2205:c6:823 2206:44:612 2207:d1:713 2208:ce:713 2209:cf:713 220b:27:439',
  '220f:d5:823 2211:e5:713 2212:2d:549 2217:2a:500 221a:d6:549 221d:b5:713 221e:a5:713 2220:d0:768 2227:d9:603',
  '2228:da:603 2229:c7:768 222a:c8:768 222b:f2:274 2234:5c:863 223c:7e:549 2245:40:549 2248:bb:549 2260:b9:549',
  '2261:ba:549 2264:a3:549 2265:b3:549 2282:cc:713 2283:c9:713 2284:cb:713 2286:cd:713 2287:ca:713 2295:c5:768',
  '2297:c4:768 22a5:5e:658 22c5:d7:250 2329:e1:329 232a:f1:329 23af:be:1000 23d0:bd:603 25ca:e0:494 2660:aa:753',
  '2663:a7:753 2665:a9:753 2666:a8:753',
];

const ZAPF_DINGBATS_GLYPHS: readonly string[] = [
  '2192:d5:838 2194:d6:1016 2195:d7:458 2460:ac:788 2461:ad:788 2462:ae:788 2463:af:788 2464:b0:788 2465:b1:788',
  '2466:b2:788 2467:b3:788 2468:b4:788 2469:b5:788 25a0:6e:761 25b2:73:892 25bc:74:892 25c6:75:788 25cf:6c:791',
  '25d7:77:438 2605:48:816 260e:25:719 261b:2a:960 261e:2b:939 2660:ab:626 2663:a8:776 2665:aa:694 2666:a9:595',
  '2701:21:974 2702:22:961 2703:23:974 2704:24:980 2706:26:789 2707:27:790 2708:28:791 2709:29:690 270c:2c:549',
  '270d:2d:855 270e:2e:911 270f:2f:933 2710:30:911 2711:31:945 2712:32:974 2713:33:755 2714:34:846 2715:35:762',
  '2716:36:761 2717:37:571 2718:38:677 2719:39:763 271a:3a:760 271b:3b:759 271c:3c:754 271d:3d:494 271e:3e:552',
  '271f:3f:537 2720:40:577 2721:41:692 2722:42:786 2723:43:788 2724:44:788 2725:45:790 2726:46:793 2727:47:794',
  '2729:49:823 272a:4a:789 272b:4b:841 272c:4c:823 272d:4d:833 272e:4e:816 272f:4f:831 2730:50:923 2731:51:744',
  '2732:52:723 2733:53:749 2734:54:790 2735:55:792 2736:56:695 2737:57:776 2738:58:768 2739:59:792 273a:5a:759',
  '273b:5b:707 273c:5c:708 273d:5d:682 273e:5e:701 273f:5f:826 2740:60:815 2741:61:789 2742:62:789 2743:63:707',
  '2744:64:687 2745:65:696 2746:66:689 2747:67:786 2748:68:787 2749:69:713 274a:6a:791 274b:6b:785 274d:6d:873',
  '274f:6f:762 2750:70:762 2751:71:759 2752:72:759 2756:76:784 2758:78:138 2759:79:277 275a:7a:415 275b:7b:392',
  '275c:7c:392 275d:7d:668 275e:7e:668 2761:a1:732 2762:a2:544 2763:a3:544 2764:a4:910 2765:a5:667 2766:a6:760',
  '2767:a7:760 2776:b6:788 2777:b7:788 2778:b8:788 2779:b9:788 277a:ba:788 277b:bb:788 277c:bc:788 277d:bd:788',
  '277e:be:788 277f:bf:788 2780:c0:788 2781:c1:788 2782:c2:788 2783:c3:788 2784:c4:788 2785:c5:788 2786:c6:788',
  '2787:c7:788 2788:c8:788 2789:c9:788 278a:ca:788 278b:cb:788 278c:cc:788 278d:cd:788 278e:ce:788 278f:cf:788',
  '2790:d0:788 2791:d1:788 2792:d2:788 2793:d3:788 2794:d4:894 2798:d8:748 2799:d9:924 279a:da:748 279b:db:918',
  '279c:dc:927 279d:dd:928 279e:de:928 279f:df:834 27a0:e0:873 27a1:e1:828 27a2:e2:924 27a3:e3:924 27a4:e4:917',
  '27a5:e5:930 27a6:e6:931 27a7:e7:463 27a8:e8:883 27a9:e9:836 27aa:ea:836 27ab:eb:867 27ac:ec:867 27ad:ed:696',
  '27ae:ee:696 27af:ef:874 27b1:f1:874 27b2:f2:760 27b3:f3:946 27b4:f4:771 27b5:f5:865 27b6:f6:771 27b7:f7:888',
  '27b8:f8:967 27b9:f9:888 27ba:fa:831 27bb:fb:873 27bc:fc:927 27bd:fd:970 27be:fe:918',
];

/** Characters (mostly emoji) drawn with the dingbat that has the same meaning. */
const EMOJI_ALIASES: ReadonlyArray<readonly [number, number]> = [
  [0x2705, 0x2714], // ✅ → ✔
  [0x274c, 0x2718], // ❌ → ✘
  [0x274e, 0x2718], // ❎ → ✘
  [0x2b50, 0x2605], // ⭐ → ★
  [0x2606, 0x2729], // ☆ → ✩
  [0x1f31f, 0x2605], // 🌟 → ★
  [0x2b24, 0x25cf], // ⬤ → ●
];

const glyphs = new Map<number, SymbolGlyph>();

function loadGlyphs(font: SymbolFontName, table: readonly string[]): void {
  for (const row of table) {
    for (const entry of row.split(' ')) {
      const [unicode = '', code = '', width = ''] = entry.split(':');
      const codePoint = parseInt(unicode, 16);
      // Symbol is loaded first: its arrows, operators and suits match text better than the dingbats.
      if (!glyphs.has(codePoint)) glyphs.set(codePoint, { font, code: parseInt(code, 16), width: Number(width) });
    }
  }
}

loadGlyphs('Symbol', SYMBOL_GLYPHS);
loadGlyphs('ZapfDingbats', ZAPF_DINGBATS_GLYPHS);
for (const [alias, target] of EMOJI_ALIASES) {
  const glyph = glyphs.get(target);
  if (glyph !== undefined) glyphs.set(alias, glyph);
}

/** The Symbol or ZapfDingbats glyph drawing `codePoint`, if either font has one. */
export function symbolGlyph(codePoint: number): SymbolGlyph | undefined {
  return glyphs.get(codePoint);
}
