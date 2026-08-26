import { lookpath } from 'lookpath';
import { DepGraph } from '@snyk/dep-graph';

import { execute } from './sub-process';
import { pathToPosix, jsonParse } from './helpers';
import type {
  Options,
  PluginMetadata,
  DepGraphResult,
  DepTreeResult,
  DepTree,
  DepDict,
} from './types';
import { pkgManagerByTarget } from './pkg-manager';
import { getDepTree } from './dep-tree';
import {
  getDepGraph,
  buildDepGraphFromImportsAndModules,
  buildGraph,
} from './dep-graph';
import * as debug from './debug';

export async function inspect(
  root: string,
  targetFile: string,
  options: Options = {},
): Promise<DepGraphResult | DepTreeResult> {
  if (options.debug) {
    debug.enable();
  } else {
    debug.disable();
  }

  const hasGoBinary = Boolean(await lookpath('go'));
  if (!hasGoBinary) {
    throw new Error(
      'The "go" command is not available on your system. To scan your dependencies in the CLI, you must ensure you have first installed the relevant package manager.',
    );
  }

  const [metadata, deps] = await Promise.all([
    getMetadata(root, targetFile),
    getDependencies(root, targetFile, options),
  ]);

  if (deps.dependencyGraph) {
    return {
      plugin: metadata,
      dependencyGraph: deps.dependencyGraph,
    };
  }

  // TODO @boost: get rid of the rest of depTree and fully convert this plugin to use depGraph
  if (deps.dependencyTree) {
    return {
      plugin: metadata,
      package: deps.dependencyTree,
    };
  }

  // TODO @boost: remove me
  throw new Error('Failed to scan this go project.');
}

async function getMetadata(
  root: string,
  targetFile: string,
): Promise<PluginMetadata> {
  const output = await execute('go', ['version'], { cwd: root });
  const versionMatch = /(go\d+\.?\d+?\.?\d*)/.exec(output);
  const runtime = versionMatch ? versionMatch[0] : undefined;

  return {
    name: 'snyk-go-plugin',
    runtime,
    targetFile: pathToPosix(targetFile),
  };
}

async function getDependencies(
  root: string,
  targetFile: string,
  options: Options = {},
): Promise<{ dependencyGraph?: DepGraph; dependencyTree?: DepTree }> {
  switch (pkgManagerByTarget(targetFile)) {
    case 'gomodules':
      return {
        dependencyGraph: await getDepGraph(root, targetFile, options),
      };
    default:
      return {
        dependencyTree: await getDepTree(root, targetFile),
      };
  }
}

export {
  DepDict,
  DepTree,
  buildDepGraphFromImportsAndModules,
  buildGraph,
  jsonParse,
};
