// Writes one CycloneDX 1.5 bill of materials per published package.
// Usage: node scripts/sbom.mjs --out dist-sbom
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function purl(name, version) {
  const scoped = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${scoped}@${version}`;
}

// Installed packages print as .../.pnpm/<name>@<version>[_peers]/node_modules/<name>, even
// with a hoisted linker, so read the version from the path. Workspace packages have no
// .pnpm segment; read their package.json.
export function fromPath(path) {
  const m = path.match(/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@([^/_]+)[^/]*\/node_modules\/(.+)$/);
  if (m) return { name: m[3], version: m[2] };
  try {
    const meta = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    return meta.name && meta.version ? { name: meta.name, version: meta.version } : null;
  } catch {
    return null;
  }
}

// `deps` is a list of { name, version } for every production dependency (repeats allowed);
// `pkg` is the package.json content of the package itself.
export function buildBom(deps, pkg) {
  const found = new Map();
  for (const { name, version } of deps) {
    found.set(purl(name, version), { type: 'library', name, version, purl: purl(name, version) });
  }
  const components = [...found.values()].sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  const component = {
    type: 'library',
    name: pkg.name,
    version: pkg.version,
    purl: purl(pkg.name, pkg.version),
  };
  if (pkg.license) component.licenses = [{ license: { id: pkg.license } }];
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { component },
    components,
  };
}

export function fileName(pkg) {
  return `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.cdx.json`;
}

// `pnpm ls --depth Infinity` repeats shared subtrees and runs out of memory on
// large trees, so ask for the flat, de-duplicated list of install paths instead.
function productionDependencies(root, dir, ownDir) {
  const out = execFileSync(
    'pnpm',
    ['ls', '--prod', '--parseable', '--depth', 'Infinity', '--filter', `./packages/${dir}`],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const deps = [];
  for (const path of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (resolve(path) === ownDir) continue;
    const dep = fromPath(path);
    if (dep) deps.push(dep);
  }
  return deps;
}

function main() {
  const i = process.argv.indexOf('--out');
  const out = resolve(i > -1 ? process.argv[i + 1] : 'dist-sbom');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  mkdirSync(out, { recursive: true });
  for (const dir of readdirSync(join(root, 'packages'))) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (pkg.private) continue;
    const deps = productionDependencies(root, dir, join(root, 'packages', dir));
    const file = join(out, fileName(pkg));
    writeFileSync(file, JSON.stringify(buildBom(deps, pkg), null, 2) + '\n');
    console.log(`wrote ${file}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
