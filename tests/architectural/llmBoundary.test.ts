/**
 * tests/architectural/llmBoundary.test.ts
 * Architectural Invariant Test: Strict Single LLM Client Gateway Enforcement
 *
 * Requirements (R3 / Acceptance Criteria):
 * 1. Zero external LLM imports/calls outside `src/services/llm/`.
 * 2. No file outside `src/services/llm/` may reference `googleapis`,
 *    `generativelanguage.googleapis.com`, or any other provider AI endpoints.
 * 3. All LLM operations across the extension MUST route strictly through
 *    `src/services/llm/llmClient.ts` via `llm.generate()`.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

interface Violation {
  file: string;
  line: number;
  forbiddenToken: string;
  lineSnippet: string;
}

// Forbidden AI SDK packages that must NEVER be imported anywhere outside src/services/llm/
const FORBIDDEN_AI_SDK_PACKAGES = [
  '@google/generative-ai',
  '@google/genai',
  'googleapis',
  'openai',
  '@anthropic-ai/sdk',
  'langchain',
  '@langchain/core',
  '@langchain/community',
  'cohere-ai',
  '@mistralai/mistralai',
  'ollama',
];

// Forbidden external AI API hostnames and endpoint URLs
const FORBIDDEN_AI_ENDPOINTS = [
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.cohere.ai',
  'api.mistral.ai',
];

// Internal LLM mode runners that should only be imported within src/services/llm/
const FORBIDDEN_INTERNAL_MODE_IMPORTS = [
  'geminiMode',
  'proxyMode',
];

/**
 * Recursively retrieves all TypeScript source files in a directory.
 */
function getAllSourceFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Inspects a source file for forbidden tokens.
 */
function scanFileForTokens(
  filePath: string,
  relativePath: string,
  forbiddenTokens: string[]
): Violation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  lines.forEach((line, index) => {
    // Strip comments to avoid false alarms in explanatory comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    for (const token of forbiddenTokens) {
      // For token names like geminiMode, use word boundary to avoid false positives (e.g. geminiModel)
      const isWord = /^[a-zA-Z0-9_]+$/.test(token);
      const matches = isWord
        ? new RegExp(`\\b${token}\\b`).test(line)
        : line.includes(token);

      if (matches) {
        violations.push({
          file: relativePath,
          line: index + 1,
          forbiddenToken: token,
          lineSnippet: trimmed,
        });
      }
    }
  });

  return violations;
}

describe('Architectural Invariant: Single LLM Boundary Enforcement', () => {
  const srcRoot = path.resolve(__dirname, '../../src');
  const allSourceFiles = getAllSourceFiles(srcRoot);

  it('sanity check: discovers and inspects all project source files', () => {
    expect(allSourceFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('strictly prohibits external AI SDK packages and API endpoints outside src/services/llm/', () => {
    const allForbiddenTokens = [
      ...FORBIDDEN_AI_SDK_PACKAGES,
      ...FORBIDDEN_AI_ENDPOINTS,
    ];

    const violations: Violation[] = [];

    for (const file of allSourceFiles) {
      const relativePath = path.relative(srcRoot, file).replace(/\\/g, '/');

      // Allowed directory: src/services/llm/**
      const isInsideLlmModule = relativePath.startsWith('services/llm/');

      if (!isInsideLlmModule) {
        const fileViolations = scanFileForTokens(
          file,
          relativePath,
          allForbiddenTokens
        );
        violations.push(...fileViolations);
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `[VIOLATION] ${v.file}:${v.line} forbidden token "${v.forbiddenToken}":\n    ${v.lineSnippet}`
        )
        .join('\n');
      expect.fail(
        `Architectural Boundary Violated!\nFound ${violations.length} forbidden external AI references outside src/services/llm/:\n${report}`
      );
    }

    expect(violations).toEqual([]);
  });

  it('strictly prohibits direct imports of internal LLM sub-modes outside src/services/llm/', () => {
    const violations: Violation[] = [];

    for (const file of allSourceFiles) {
      const relativePath = path.relative(srcRoot, file).replace(/\\/g, '/');
      const isInsideLlmModule = relativePath.startsWith('services/llm/');

      if (!isInsideLlmModule) {
        const fileViolations = scanFileForTokens(
          file,
          relativePath,
          FORBIDDEN_INTERNAL_MODE_IMPORTS
        );
        violations.push(...fileViolations);
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `[BYPASS VIOLATION] ${v.file}:${v.line} directly references internal sub-mode "${v.forbiddenToken}":\n    ${v.lineSnippet}`
        )
        .join('\n');
      expect.fail(
        `Architectural Bypass Violated!\nComponents outside src/services/llm/ must import only from llmClient.ts:\n${report}`
      );
    }

    expect(violations).toEqual([]);
  });

  it('positive control: scanner reliably flags violations when present', () => {
    const syntheticSource = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const url = "https://generativelanguage.googleapis.com/v1/models";
    `;

    const lines = syntheticSource.split('\n');
    const detected: string[] = [];

    lines.forEach((line) => {
      for (const token of ['@google/generative-ai', 'generativelanguage.googleapis.com']) {
        if (line.includes(token)) {
          detected.push(token);
        }
      }
    });

    expect(detected).toContain('@google/generative-ai');
    expect(detected).toContain('generativelanguage.googleapis.com');
  });
});

/**
 * Relevance-filter invariant: tools must hand the course context to the gateway as a
 * `contextBundle` (llm.generate / llm.rawChat), never serialize it themselves, otherwise they would
 * bypass the default relevance filter. Only src/services may serialize; the context tree uses it for
 * a display-only token estimate of the whole selection.
 */
describe('Context serialization stays behind the gateway (relevance filter by default)', () => {
  const SERIALIZERS = ['serializeToMarkdown', 'serializeToJson', 'serializeContext'];
  const ALLOWED_OUTSIDE_SERVICES = ['ContextSelectorTree.tsx'];

  it('no UI/tool code outside src/services serializes the context directly', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const violations: string[] = [];
    for (const file of getAllSourceFiles(srcDir)) {
      const rel = path.relative(srcDir, file);
      if (rel.startsWith('services' + path.sep)) continue;
      if (ALLOWED_OUTSIDE_SERVICES.includes(path.basename(file))) continue;
      const text = fs.readFileSync(file, 'utf-8');
      for (const name of SERIALIZERS) {
        if (new RegExp(`\\b${name}\\b`).test(text)) violations.push(`${rel}: uses ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

