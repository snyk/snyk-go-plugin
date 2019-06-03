import * as path from 'path';
import * as fs from 'fs';

import {test} from 'tap';

import {buildModuleGraph} from '../lib/go-mod-analysis';

if (process.env.GO_VERSION) {
  const goVersion = process.env.GO_VERSION.split('.').map(Number);

  if (goVersion[0] > 1 || goVersion[1] >= 12) {
    test('chdir and analyze', {options: {timeout: 120}}, async (t) => {
      process.chdir(path.resolve(__dirname, 'fixtures/gomod-small'));
      const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/gomod-small/expected-modgraph.json'), 'utf-8'));
      t.same(await buildModuleGraph('.'), expected);
    });

    test('analyze path', {options: {timeout: 120}}, async (t) => {
      const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/gomod-small/expected-modgraph.json'), 'utf-8'));
      t.same(await buildModuleGraph(path.resolve(__dirname, 'fixtures/gomod-small')), expected);
    });
  } else {

    test('analyze on older Go versions', (t) => {
      t.rejects('throws', buildModuleGraph('.'));
      t.end();
    });
  }
}