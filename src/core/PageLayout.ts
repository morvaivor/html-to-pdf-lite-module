import type { RenderOptions, Orientation } from '../types.js';

/**
 * Class representing the geometry and dimensions of a document page.
 * All properties are readonly — page geometry is immutable after construction.
 */
export class PageLayout {
  readonly leftMargin: number;
  readonly rightMargin: number;
  readonly topMargin: number;
  readonly bottomMargin: number;
  readonly headerHeight: number;
  readonly footerHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly contentWidth: number;
  readonly contentTop: number;
  readonly pageBottom: number;
  readonly format: string;
  readonly orientation: Orientation;

  constructor(doc: PDFKit.PDFDocument, options: RenderOptions) {
    this.leftMargin = options.margin?.left ?? 20;
    this.rightMargin = options.margin?.right ?? 20;
    this.topMargin = options.margin?.top ?? 20;
    this.bottomMargin = options.margin?.bottom ?? 20;
    this.headerHeight = options._headerHeight ?? 0;
    this.footerHeight = options._footerHeight ?? 0;
    this.pageWidth = doc.page.width;
    this.pageHeight = doc.page.height;
    this.contentWidth = this.pageWidth - this.leftMargin - this.rightMargin;
    this.contentTop = this.topMargin + this.headerHeight;
    this.pageBottom = this.pageHeight - this.bottomMargin - this.footerHeight;
    this.format = options.format ?? 'A4';
    this.orientation = options.orientation ?? 'portrait';
  }
}
