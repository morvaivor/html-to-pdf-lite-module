import { renderHtmlToPdf } from './htmlRenderer.js';

const DEFAULT_FORMAT = 'A4';
const DEFAULT_ORIENTATION = 'portrait';
const DEFAULT_MARGIN = {
  top: 20,
  bottom: 20,
  left: 20,
  right: 20,
};

export class PdfGenerator {
  constructor(config = {}) {
    this.config = {
      defaultFormat: config.defaultFormat ?? DEFAULT_FORMAT,
      defaultOrientation: config.defaultOrientation ?? DEFAULT_ORIENTATION,
      defaultMargin: config.defaultMargin ?? DEFAULT_MARGIN,
      css: config.css ?? '',
      header: config.header ?? '',
      footer: config.footer ?? '',
    };
  }

  async generate(html, options = {}) {
    const mergedOptions = {
      format: options.format ?? this.config.defaultFormat,
      orientation: options.orientation ?? this.config.defaultOrientation,
      margin: {
        ...DEFAULT_MARGIN,
        ...this.config.defaultMargin,
        ...options.margin,
      },
      css: options.css ?? this.config.css,
      header: options.header ?? this.config.header,
      footer: options.footer ?? this.config.footer,
    };

    return renderHtmlToPdf(html, mergedOptions);
  }
}

export function createPdfGenerator(config = {}) {
  return new PdfGenerator(config);
}

export default PdfGenerator;
