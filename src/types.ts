import type { Worker } from 'node:worker_threads';

// ─── Literal Unions ───

export type PaperFormat = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal';
export type Orientation = 'portrait' | 'landscape';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** @page CSS zones for header/footer */
export type PageZoneName = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

// ─── Public Interfaces ───

export interface MarginOptions {
  readonly top?: number;
  readonly bottom?: number;
  readonly left?: number;
  readonly right?: number;
}

export interface RequiredMargin {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface WorkerPoolStats {
  readonly totalWorkers: number;
  readonly freeWorkers: number;
  readonly activeTasks: number;
  readonly queuedTasks: number;
  readonly maxWorkers: number;
}

export interface PdfGeneratorConfig {
  readonly defaultFormat?: PaperFormat | (string & {});
  readonly defaultOrientation?: Orientation;
  readonly defaultMargin?: MarginOptions;
  readonly css?: string;
  readonly header?: string;
  readonly footer?: string;
  /** Enable Worker Thread Pool for CPU offloading */
  readonly useWorkerPool?: boolean;
  /** Max CPU cores ratio limit (e.g. 0.5 for moderate 50% CPU, default 0.5) */
  readonly cpuRatio?: number;
  /** Explicit max worker count override */
  readonly maxWorkers?: number;
  /** Auto-terminate idle workers after idleTimeoutMs (default 10000 ms) */
  readonly idleTimeoutMs?: number;
}

export interface PdfGenerateOptions {
  readonly format?: PaperFormat | (string & {});
  readonly orientation?: Orientation;
  readonly margin?: MarginOptions;
  readonly css?: string;
  readonly header?: string;
  readonly footer?: string;
}

// ─── Internal Interfaces ───

/** Enriched options passed through the rendering pipeline */
export interface RenderOptions extends PdfGenerateOptions {
  readonly _headerHeight: number;
  readonly _footerHeight: number;
  readonly _pageZones: PageZones | null;
  _fontBufferCache: Map<string, Buffer>;
}

/** Parsed CSS properties of a @page zone */
export interface PageZoneProperties {
  content?: string;
  color?: string;
  'font-size'?: string;
  'font-family'?: string;
  'font-weight'?: string;
  'font-style'?: string;
  [key: string]: string | undefined;
}

export type PageZones = Partial<Record<PageZoneName, PageZoneProperties>>;

/** Resolved text style for rendering */
export interface TextStyle {
  color: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontFamily: string;
  backgroundColor?: string;
  border?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: string;
  borderTopWidth?: number;
  borderTopColor?: string;
  borderBottomWidth?: number;
  borderBottomColor?: string;
  borderLeftWidth?: number;
  borderLeftColor?: string;
  borderRightWidth?: number;
  borderRightColor?: string;
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  display?: string;
  textAlign?: TextAlign;
  // Propriétés de layout Flexbox & Grid
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  gap?: number;
  gridTemplateColumns?: string;
  width?: string | number;
  height?: string | number;
  minWidth?: number;
  maxWidth?: number;
  borderRadius?: number;
}

/** Parsed CSS rule */
export interface CssRule {
  readonly selector: string;
  readonly properties: Record<string, string>;
}

/** Parsed @font-face declaration */
export interface FontFace {
  readonly family: string;
  readonly url: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

// ─── Worker types (discriminated union) ───

/** Task in the WorkerPool queue */
export interface WorkerTask {
  readonly id: number;
  readonly html: string;
  readonly options: PdfGenerateOptions;
  resolve: (value: Buffer) => void;
  reject: (reason: Error) => void;
  worker?: Worker;
}

/** Message sent to the worker thread */
export interface WorkerMessage {
  readonly id: number;
  readonly html: string;
  readonly options: PdfGenerateOptions;
}

/** Response from the worker thread — discriminated union on `success` */
export type WorkerResponse =
  | { readonly id: number; readonly success: true; readonly result: ArrayBuffer }
  | { readonly id: number; readonly success: false; readonly error: string };
