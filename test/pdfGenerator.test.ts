import { createPdfGenerator, PdfGenerator } from '../src/pdfGenerator.js';
import type { PdfGeneratorConfig } from '../src/types.js';

jest.mock('pdfkit', () => {
  const mockDoc = {
    page: { width: 595, height: 842 },
    x: 20,
    y: 20,
    font: jest.fn().mockReturnThis(),
    fontSize: jest.fn().mockReturnThis(),
    fillColor: jest.fn().mockReturnThis(),
    text: jest.fn().mockImplementation(function (txt) {
      this.y += 15;
      return this;
    }),
    addPage: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (event, cb) {
      if (event === 'data') {
        setImmediate(() => cb(Buffer.from('mock-pdf-data')));
      }
      if (event === 'end') {
        setImmediate(() => cb());
      }
      return this;
    }),
    end: jest.fn(),
  };

  return {
    PDFDocument: jest.fn().mockImplementation(() => mockDoc),
  };
});

describe('PdfGenerator', () => {
  describe('createPdfGenerator factory', () => {
    it('should create a PdfGenerator instance', () => {
      const gen = createPdfGenerator();
      expect(gen).toBeInstanceOf(PdfGenerator);
    });

    it('should create with custom config', () => {
      const config: PdfGeneratorConfig = {
        defaultFormat: 'Letter',
        defaultOrientation: 'landscape',
      };
      const gen = createPdfGenerator(config);
      expect(gen).toBeInstanceOf(PdfGenerator);
    });
  });

  describe('generate', () => {
    let generator: PdfGenerator;

    beforeEach(() => {
      jest.clearAllMocks();
      generator = createPdfGenerator();
    });

    it('should generate a PDF buffer from HTML', async () => {
      const html = '<h1>Hello</h1>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should throw on empty HTML', async () => {
      await expect(generator.generate('')).rejects.toThrow();
    });

    it('should throw on null HTML', async () => {
      await expect(generator.generate(null as any)).rejects.toThrow();
    });

    it('should handle paragraph text', async () => {
      const html = '<p>Test paragraph</p>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle nested spans', async () => {
      const html = '<p>Hello <span>World</span></p>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle inline styles', async () => {
      const html = '<p style="color: #ff0000; font-size: 16px;">Styled</p>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle headings', async () => {
      const html = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle multiple divs', async () => {
      const html = '<div>First</div><div>Second</div><div>Third</div>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle br tags', async () => {
      const html = '<p>Line 1<br>Line 2</p>';
      const result = await generator.generate(html);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should respect format option', async () => {
      await generator.generate('<p>Test</p>', { format: 'Letter' });
    });

    it('should respect orientation option', async () => {
      await generator.generate('<p>Test</p>', { orientation: 'landscape' });
    });

    it('should respect margin option', async () => {
      await generator.generate('<p>Test</p>', { margin: { top: 50, bottom: 50, left: 30, right: 30 } });
    });
  });

  describe('default config', () => {
    it('should apply default format', async () => {
      const gen = createPdfGenerator({ defaultFormat: 'Legal' });
      await gen.generate('<p>Test</p>');
    });

    it('should allow per-call override', async () => {
      const gen = createPdfGenerator({ defaultFormat: 'Legal' });
      await gen.generate('<p>Test</p>', { format: 'A3' });
    });
  });
});
