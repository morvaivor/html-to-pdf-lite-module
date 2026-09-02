/**
 * Class representing the geometry and dimensions of a document page.
 */
export class PageLayout {
  constructor(doc, options) {
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
    this.format = options.format || 'A4';
    this.orientation = options.orientation || 'portrait';
  }
}
