/** Source-level companion to the screen/data contract in FRONTEND_VARIABLES.md. */
import ts from 'typescript';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(root, 'test-client/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const pages: Record<string, string> = {
  'app.ts': 'All pages: configuration, state, errors, navigation',
  'battle.ts': 'Fight and Boss',
  'debug.ts': 'Development overlay on every page',
  'helpModal.ts': 'Help overlay on Fight and Boss',
  'main.ts': 'Application startup',
  'settings-preview.ts': 'Standalone preview of the actual game API Settings component',
  'mockApi.ts': 'Browser-only canned mock implementation (`?mock=1`)',
  'ui.ts': 'Shared presentation helpers on every page',
  'scenes/BootScene.ts': 'Boot/resume',
  'scenes/UploadScene.ts': 'Course picker, upload, ingest, run setup',
  'scenes/LearningScene.ts': 'Learning/notebook',
  'scenes/FightScene.ts': 'Fight (state inherited from BattleScene)',
  'scenes/BossScene.ts': 'Boss (state inherited from BattleScene)',
  'scenes/ResultsScene.ts': 'Results/study guide',
};
const format = (s: string) => s.replaceAll('|', '\\|').replaceAll('`', "'").replace(/\s+/g, ' ');
const names = (name: ts.BindingName): ts.Identifier[] => ts.isIdentifier(name) ? [name]
  : name.elements.flatMap((e) => ts.isBindingElement(e) ? names(e.name) : []);

function scopeOf(node: ts.Node): string {
  const scopes: string[] = [];
  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if ((ts.isClassDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) scopes.unshift(p.name.text);
    else if (ts.isMethodDeclaration(p)) scopes.unshift(p.name.getText());
    else if (ts.isConstructorDeclaration(p)) scopes.unshift('constructor');
    else if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      scopes.unshift(ts.isVariableDeclaration(p.parent) ? p.parent.name.getText() : '(callback)');
    }
  }
  return scopes.join(' → ') || 'module';
}

const output = [
  '# Frontend source variable inventory',
  'Generated from the current TypeScript source. This lists every variable declaration, class field and function/callback parameter in `test-client/src`, including temporary rendering locals. Imported bindings refer to declarations in their source modules. The screen/API contract and field meanings are in [FRONTEND_VARIABLES.md](FRONTEND_VARIABLES.md).',
  'Regenerate with `npm run docs:frontend`. Types come from the TypeScript checker and are shortened after 180 characters. Repeated names are distinct bindings in the listed scopes. This inventory describes the reference harness; the Phaser AE teammate does not need to copy its presentation internals.',
];
let total = 0;
for (const [relative, page] of Object.entries(pages)) {
  const source = program.getSourceFile(path.join(root, 'test-client/src', relative));
  if (!source) throw new Error(`Missing source ${relative}`);
  const rows: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
      const bindings = ts.isPropertyDeclaration(node) ? [node.name] : names(node.name);
      for (const name of bindings) {
        const line = source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1;
        const type = checker.typeToString(checker.getTypeAtLocation(name), undefined, ts.TypeFormatFlags.NoTruncation);
        const kind = ts.isVariableDeclaration(node) ? 'variable' : ts.isPropertyDeclaration(node) ? 'field'
          : node.modifiers?.some((m) => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword].includes(m.kind)) ? 'constructor field' : 'parameter';
        rows.push(`| \`${format(name.getText(source))}\` | ${kind} | \`${format(type.length > 180 ? type.slice(0, 177) + '...' : type)}\` | ${format(scopeOf(node))} | [${line}](../test-client/src/${relative}#L${line}) |`);
        total++;
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  output.push(`## ${relative}`, `Page: ${page}.`, rows.length
    ? '| Name | Kind | Type | Scope | Line |\n|---|---|---|---|---|\n' + rows.join('\n')
    : 'No local variable/field/parameter declarations; see the base class.');
}
output.push(`Total: ${total} declarations.`);
await writeFile(path.join(root, 'docs/FRONTEND_SOURCE_VARIABLES.md'), output.join('\n\n') + '\n');
console.log(`Documented ${total} declarations across ${Object.keys(pages).length} frontend files.`);
