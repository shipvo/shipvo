import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBom, fileName, fromPath } from './sbom.mjs';

const pkg = { name: '@shipvo/demo', version: '1.2.3', license: 'Apache-2.0' };
const deps = [
  { name: 'zed', version: '2.0.0' },
  { name: '@scope/lib', version: '1.0.0' },
  { name: 'alpha', version: '1.0.0' },
  { name: '@scope/lib', version: '1.0.0' },
];

test('fixture gives a valid CycloneDX document with sorted, unique components', () => {
  const bom = buildBom(deps, pkg);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  assert.deepEqual(bom.metadata.component, {
    type: 'library',
    name: '@shipvo/demo',
    version: '1.2.3',
    purl: 'pkg:npm/%40shipvo/demo@1.2.3',
    licenses: [{ license: { id: 'Apache-2.0' } }],
  });
  assert.deepEqual(
    bom.components.map((c) => c.purl),
    ['pkg:npm/%40scope/lib@1.0.0', 'pkg:npm/alpha@1.0.0', 'pkg:npm/zed@2.0.0'],
  );
});

test('a package with no dependencies gives an empty components list', () => {
  assert.deepEqual(buildBom([], pkg).components, []);
});

test('file name is <name>-<version>.cdx.json', () => {
  assert.equal(fileName(pkg), 'shipvo-demo-1.2.3.cdx.json');
});

test('fromPath reads name and version from pnpm install paths', () => {
  assert.deepEqual(fromPath('/r/node_modules/.pnpm/zod@3.25.76/node_modules/zod'), { name: 'zod', version: '3.25.76' });
  assert.deepEqual(
    fromPath('/r/node_modules/.pnpm/@bufbuild+cel@0.6.2_@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/cel'),
    { name: '@bufbuild/cel', version: '0.6.2' },
  );
});
