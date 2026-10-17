import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modules = new Map();

function resolveLocal(value) {
  const candidates = [value, ...['.ts', '.tsx', '.mjs', '.js', '.json'].map(ext => value + ext), ...['index.ts', 'index.tsx', 'index.mjs', 'index.js'].map(file => path.join(value, file))];
  const found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!found) throw new Error(`Test module not found: ${path.relative(root, value)}`);
  return found;
}

/** Load actual TS/TSX source in Node tests. No globals or production code are patched. */
export function loadDashboardModule(relativePath) {
  const file = resolveLocal(path.resolve(root, relativePath));
  if (modules.has(file)) return modules.get(file).exports;
  const nativeRequire = createRequire(file);
  if (!/\.tsx?$/.test(file)) return nativeRequire(file);
  const module = { exports: {} };
  modules.set(file, module);
  try {
    const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
    const require = specifier => {
      const local = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2))
        : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
      return local ? loadDashboardModule(path.relative(root, resolveLocal(local))) : nativeRequire(specifier);
    };
    new Function('require', 'module', 'exports', '__filename', '__dirname', result.outputText)(require, module, module.exports, file, path.dirname(file));
    return module.exports;
  } catch (error) {
    modules.delete(file);
    throw error;
  }
}
