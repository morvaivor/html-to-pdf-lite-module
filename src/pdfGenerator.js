const { renderHtmlToPdf } = require('./htmlRenderer');

const DEFAULT_FORMAT = 'A4';
const DEFAULT_ORIENTATION = 'portrait';
const DEFAULT_MARGIN = {
  top: 20,
  bottom: 20,
  left: 20,
  right: 20,
};

class PdfGenerator {
  constructor(config = {}) {
    this.config = {
      defaultFormat: config.defaultFormat ?? DEFAULT_FORMAT,
      defaultOrientation: config.defaultOrientation ?? DEFAULT_ORIENTATION,
      defaultMargin: config.defaultMargin ?? DEFAULT_MARGIN,
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
    };

    return renderHtmlToPdf(html, mergedOptions);
  }
}

function createPdfGenerator(config = {}) {
  return new PdfGenerator(config);
}

module.exports = { PdfGenerator, createPdfGenerator, default: PdfGenerator };
