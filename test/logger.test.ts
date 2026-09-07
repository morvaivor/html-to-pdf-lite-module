import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLogger, Logger } from '../src/core/logger.js';
import { createPdfGenerator } from '../src/index.js';

describe('Logger unit tests', () => {
  test('Logger is silent when verbose is false or omitted (level NONE)', () => {
    const logger = createLogger();
    assert.equal(logger.level, 'NONE');
    assert.equal(logger.isEnabledFor('ERROR'), false);
    assert.equal(logger.isEnabledFor('WARN'), false);
    assert.equal(logger.isEnabledFor('INFO'), false);
    assert.equal(logger.isEnabledFor('DEBUG'), false);
  });

  test('verbose: true activates DEBUG level', () => {
    const logger = createLogger({ verbose: true });
    assert.equal(logger.level, 'DEBUG');
    assert.equal(logger.isEnabledFor('ERROR'), true);
    assert.equal(logger.isEnabledFor('WARN'), true);
    assert.equal(logger.isEnabledFor('INFO'), true);
    assert.equal(logger.isEnabledFor('DEBUG'), true);
  });

  test('respects specific levels (ERROR, WARN, INFO, DEBUG)', () => {
    const errorLogger = createLogger({ verbose: 'ERROR' });
    assert.equal(errorLogger.level, 'ERROR');
    assert.equal(errorLogger.isEnabledFor('ERROR'), true);
    assert.equal(errorLogger.isEnabledFor('WARN'), false);

    const warnLogger = createLogger({ verbose: 'WARN' });
    assert.equal(warnLogger.level, 'WARN');
    assert.equal(warnLogger.isEnabledFor('ERROR'), true);
    assert.equal(warnLogger.isEnabledFor('WARN'), true);
    assert.equal(warnLogger.isEnabledFor('INFO'), false);

    const infoLogger = createLogger({ verbose: 'INFO' });
    assert.equal(infoLogger.level, 'INFO');
    assert.equal(infoLogger.isEnabledFor('INFO'), true);
    assert.equal(infoLogger.isEnabledFor('DEBUG'), false);

    const debugLogger = createLogger({ logLevel: 'DEBUG' });
    assert.equal(debugLogger.level, 'DEBUG');
    assert.equal(debugLogger.isEnabledFor('DEBUG'), true);
  });

  test('intercepts console stdout/stderr and validates ANSI color codes', () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any;

    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as any;

    try {
      const logger = new Logger({ verbose: true });
      logger.error('Echec de construction du pdf : Test error');
      logger.warn('Erreur de chargement du CSS : Test warning');
      logger.info('Tâche de génération du PDF commencée');
      logger.debug('Css chargé à partir de style.css');

      // ERROR in Red (\x1b[31m)
      const errOut = stderrChunks.join('');
      assert.ok(errOut.includes('\x1b[31m[ERROR]\x1b[0m'));
      assert.ok(errOut.includes('Echec de construction du pdf'));

      // WARN in Orange (\x1b[38;5;208m)
      assert.ok(errOut.includes('\x1b[38;5;208m[WARN]\x1b[0m'));
      assert.ok(errOut.includes('Erreur de chargement du CSS'));

      // INFO in Green (\x1b[32m)
      const stdOut = stdoutChunks.join('');
      assert.ok(stdOut.includes('\x1b[32m[INFO]\x1b[0m'));
      assert.ok(stdOut.includes('Tâche de génération'));

      // DEBUG in Blue (\x1b[34m)
      assert.ok(stdOut.includes('\x1b[34m[DEBUG]\x1b[0m'));
      assert.ok(stdOut.includes('Css chargé'));
    } finally {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    }
  });

  test('appends clean logs without ANSI escapes to logFile', () => {
    const testLogFile = './output/test-logger-output.log';
    if (existsSync(testLogFile)) unlinkSync(testLogFile);

    const logger = new Logger({
      verbose: 'DEBUG',
      logFile: testLogFile,
    });

    logger.error('Erreur fichier');
    logger.warn('Avertissement fichier');
    logger.info('Info fichier');
    logger.debug('Debug fichier');

    assert.ok(existsSync(testLogFile));
    const content = readFileSync(testLogFile, 'utf-8');

    assert.ok(content.includes('[ERROR]'));
    assert.ok(content.includes('Erreur fichier'));
    assert.ok(content.includes('[WARN]'));
    assert.ok(content.includes('[INFO]'));
    assert.ok(content.includes('[DEBUG]'));
    // ANSI codes must NOT be present in file
    assert.ok(!content.includes('\x1b['));

    unlinkSync(testLogFile);
  });
});

describe('Verbose mode during PDF generation', () => {
  let server: Server;
  let port: number;

  test('setup mock HTTP server', async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/good.css') {
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end('h1 { color: #00ff00; }');
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  test('generates with verbose: true and writes logs for INFO, DEBUG, WARN', async () => {
    const logFile = './output/pdf-verbose-run.log';
    if (existsSync(logFile)) unlinkSync(logFile);

    const html = `<html><head>
      <style>body { font-size: 14px; }</style>
      <link rel="stylesheet" href="http://127.0.0.1:${port}/good.css">
      <link rel="stylesheet" href="http://127.0.0.1:${port}/bad-missing.css">
    </head><body><h1>Hello Verbose</h1></body></html>`;

    const generator = createPdfGenerator({
      verbose: true,
      allowedLocalIps: ['127.0.0.1'],
      logFile,
    });

    const pdf = await generator.generate(html);
    assert.ok(pdf instanceof Buffer);

    assert.ok(existsSync(logFile));
    const fileText = readFileSync(logFile, 'utf-8');

    // INFO: task start and end
    assert.ok(fileText.includes('Début de la tâche de génération du PDF'));
    assert.ok(fileText.includes('Tâche de génération du PDF terminée avec succès'));

    // DEBUG: HTML size, CSS origin, production time
    assert.ok(fileText.includes('Taille du HTML :'));
    assert.ok(fileText.includes('CSS chargé à partir de'));
    assert.ok(fileText.includes('Temps de production du html :'));

    // WARN: Erreur de chargement du CSS
    assert.ok(fileText.includes('[WARN]'));
    assert.ok(fileText.includes('Erreur de chargement du CSS depuis'));

    unlinkSync(logFile);
  });

  test('logs ERROR in red when PDF generation fails on invalid input', async () => {
    const logFile = './output/pdf-error-run.log';
    if (existsSync(logFile)) unlinkSync(logFile);

    const generator = createPdfGenerator({
      verbose: 'ERROR',
      logFile,
    });

    await assert.rejects(async () => {
      await generator.generate('');
    }, /HTML content must be a non-empty string/);

    assert.ok(existsSync(logFile));
    const fileText = readFileSync(logFile, 'utf-8');
    assert.ok(fileText.includes('[ERROR]'));
    assert.ok(fileText.includes('Echec de construction du pdf'));

    unlinkSync(logFile);
  });

  test('teardown mock server', async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
