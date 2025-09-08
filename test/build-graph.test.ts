import { test } from 'tap';
import { DepGraphBuilder } from '@snyk/dep-graph';
import { buildGraph } from '../lib';

test('buildGraph stdlib include/exclude logic', (t) => {
  const basePackages: any = {
    'rsc.io/quote': { DepOnly: true, Module: { Version: 'v1.5.2' } },
  };

  function run(includeStd: boolean) {
    const builder = new DepGraphBuilder(
      { name: 'gomodules' },
      {
        name: 'root',
        version: '0.0.0',
      },
    );

    buildGraph(
      builder,
      ['fmt', 'golang_project_1.24.2', 'rsc.io/quote'],
      basePackages,
      'root-node',
      new Map(),
      new Map(),
      includeStd,
      '1.21.0',
    );

    return builder
      .build()
      .getPkgs()
      .map((p) => `${p.name}@${p.version}`);
  }

  const noStd = run(false);
  t.same(
    noStd.sort(),
    ['root@0.0.0', 'rsc.io/quote@1.5.2'].sort(),
    'skip stdlib when flag off',
  );

  const withStd = run(true);
  t.same(
    withStd.sort(),
    ['root@0.0.0', 'fmt@1.21.0', 'rsc.io/quote@1.5.2'].sort(),
    'include stdlib when flag on',
  );

  t.end();
});
