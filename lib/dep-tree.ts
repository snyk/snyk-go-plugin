import * as path from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';
import * as graphlib from '@snyk/graphlib';

import { GoPackageManagerType } from 'snyk-go-parser';
// TODO: export LockedDeps from snyk-go-parser
import type { LockedDeps } from 'snyk-go-parser/dist/types';

import { CountDict, DepTree } from './types';
import { parseConfig } from './config';
import { runGo } from './sub-process';
import { pkgManagerByTarget } from './pkg-manager';
import { debug } from './debug';

const VIRTUAL_ROOT_NODE_ID = '.';

const VENDOR_SYNC_CMD_BY_PKG_MANAGER: { [k in GoPackageManagerType]: string } =
  {
    golangdep: 'dep ensure',
    govendor: 'govendor sync',
    gomodules: 'go mod download',
  };

export async function getDepTree(
  root: string,
  targetFile: string,
): Promise<DepTree> {
  let tempDirObj: tmp.DirResult | undefined;
  try {
    debug('parsing manifest/lockfile', { root, targetFile });
    const config = await parseConfig(root, targetFile);
    tempDirObj = tmp.dirSync({ unsafeCleanup: true });

    dumpAllResolveDepsFilesInTempDir(tempDirObj.name);

    const goResolveTool = path.join(tempDirObj.name, 'resolve-deps.go');
    let ignorePkgsParam = '';
    if (config.ignoredPkgs && config.ignoredPkgs.length > 0) {
      ignorePkgsParam = '-ignoredPkgs=' + config.ignoredPkgs.join(',');
    }
    const args = ['run', goResolveTool, ignorePkgsParam];
    debug('executing go deps resolver', { cmd: 'go' + args.join(' ') });
    const graphStr = await runGo(args, {
      cwd: root,
      env: { GO111MODULE: 'off' },
    });
    tempDirObj.removeCallback();
    debug('loading deps resolver graph output to graphlib', {
      jsonSize: graphStr.length,
    });
    const graph = graphlib.json.read(JSON.parse(graphStr));

    if (!graphlib.alg.isAcyclic(graph)) {
      throw new Error(
        'Go import cycle detected (not allowed by the Go compiler)',
      );
    }

    // A project can contain several "entry points",
    // i.e. pkgs with no local dependants.
    // To create a tree, we add edges from a "virutal root",
    // to these source nodes.
    const rootNode = graph.node(VIRTUAL_ROOT_NODE_ID);
    if (!rootNode) {
      throw new Error('Failed parsing dependency graph');
    }

    graph.sources().forEach((nodeId) => {
      if (nodeId !== VIRTUAL_ROOT_NODE_ID) {
        graph.setEdge(VIRTUAL_ROOT_NODE_ID, nodeId);
      }
    });

    const projectRootPath = getProjectRootFromTargetFile(targetFile);

    debug('building dep-tree');
    const pkgsTree = recursivelyBuildPkgTree(
      graph,
      rootNode,
      config.lockedVersions,
      projectRootPath,
      {},
    );
    delete pkgsTree._counts;

    pkgsTree.packageFormatVersion = 'golang:0.0.1';
    debug('done building dep-tree', { rootPkgName: pkgsTree.name });

    return pkgsTree;
  } catch (error) {
    if (tempDirObj) {
      tempDirObj.removeCallback();
    }
    if (typeof error === 'string') {
      const unresolvedOffset = error.indexOf('Unresolved packages:');
      if (unresolvedOffset !== -1) {
        throw new Error(
          error.slice(unresolvedOffset) +
            '\n' +
            'Unresolved imports found, please run `' +
            syncCmdForTarget(targetFile) +
            '`',
        );
      }
      throw new Error(error);
    }
    throw error;
  }
}

function recursivelyBuildPkgTree(
  graph: graphlib.Graph,
  node: any,
  lockedVersions: LockedDeps,
  projectRootPath: string,
  totalPackageOccurenceCounter: CountDict,
): DepTree {
  const isRoot = node.Name === VIRTUAL_ROOT_NODE_ID;

  const isProjSubpkg = isProjSubpackage(node.Dir, projectRootPath);

  const pkg: DepTree = {
    name: isRoot ? node.FullImportPath : node.Name,
    dependencies: {},
  };
  if (!isRoot && isProjSubpkg) {
    pkg._isProjSubpkg = true;
  }

  if (isRoot || isProjSubpkg) {
    pkg.version = '';
  } else if (!lockedVersions[pkg.name]) {
    pkg.version = '';
    // TODO: warn or set to "?" ?
  } else {
    pkg.version = lockedVersions[pkg.name].version;
  }

  const children = (graph.successors(node.Name) || []).sort();
  children.forEach((depName) => {
    // We drop whole dep tree branches for frequently repeatedpackages:
    // this loses some paths, but avoids explosion in result size
    if ((totalPackageOccurenceCounter[depName] || 0) > 10) {
      return;
    }

    const dep = graph.node(depName);

    const child = recursivelyBuildPkgTree(
      graph,
      dep,
      lockedVersions,
      projectRootPath,
      totalPackageOccurenceCounter,
    );

    if (child._isProjSubpkg) {
      Object.keys(child.dependencies!).forEach((grandChildName) => {
        // We merge all the subpackages of the project into the root project, by transplanting dependencies of the
        // subpackages one level up.
        // This is done to decrease the tree size - and to be similar to other languages, where we are only showing
        // dependencies at the project level, not at the level of individual code sub-directories (which Go packages
        // are, essentially).
        if (!pkg.dependencies![grandChildName]) {
          pkg.dependencies![grandChildName] =
            child.dependencies![grandChildName];
        }
      });
      // Even though subpackages are not preserved in the result, we still need protection from combinatorial explosion
      // while scanning the tree.
      totalPackageOccurenceCounter[child.name] =
        (totalPackageOccurenceCounter[child.name] || 0) + 1;
    } else {
      // in case was already added via a grandchild
      if (!pkg.dependencies![child.name]) {
        pkg.dependencies![child.name] = child;
        totalPackageOccurenceCounter[child.name] =
          (totalPackageOccurenceCounter[child.name] || 0) + 1;
      }
    }
  });

  return pkg;
}

function dumpAllResolveDepsFilesInTempDir(tempDirName: string): void {
  createAssets().forEach((currentReadFilePath) => {
    if (!fs.existsSync(currentReadFilePath)) {
      throw new Error('The file `' + currentReadFilePath + '` is missing');
    }

    const relFilePathToDumpDir =
      getFilePathRelativeToDumpDir(currentReadFilePath);

    const writeFilePath = path.join(tempDirName, relFilePathToDumpDir);

    const contents = fs.readFileSync(currentReadFilePath);
    writeFile(writeFilePath, contents);
  });
}

function syncCmdForTarget(targetFile: string): string {
  return VENDOR_SYNC_CMD_BY_PKG_MANAGER[pkgManagerByTarget(targetFile)];
}

function getProjectRootFromTargetFile(targetFile: string): string {
  const resolved = path.resolve(targetFile);
  const parts = resolved.split(path.sep);

  if (parts[parts.length - 1] === 'Gopkg.lock') {
    return path.dirname(resolved);
  }

  if (
    parts[parts.length - 1] === 'vendor.json' &&
    parts[parts.length - 2] === 'vendor'
  ) {
    return path.dirname(path.dirname(resolved));
  }

  if (parts[parts.length - 1] === 'go.mod') {
    return path.dirname(resolved);
  }

  throw new Error('Unsupported file: ' + targetFile);
}

function createAssets(): [string] {
  // path.join calls have to be exactly in this format, needed by "pkg" to build a standalone Snyk CLI binary:
  // https://www.npmjs.com/package/pkg#detecting-assets-in-source-code
  return [path.join(__dirname, '../gosrc/resolve-deps.go')];
}

function writeFile(writeFilePath: string, contents: NonSharedBuffer): void {
  const dirPath = path.dirname(writeFilePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
  fs.writeFileSync(writeFilePath, contents);
}

function getFilePathRelativeToDumpDir(filePath: string): string {
  let pathParts = filePath.split('\\gosrc\\');

  // Windows
  if (pathParts.length > 1) {
    return pathParts[1];
  }

  // Unix
  pathParts = filePath.split('/gosrc/');
  return pathParts[1];
}

function isProjSubpackage(pkgPath, projectRootPath) {
  if (pkgPath === projectRootPath) {
    return true;
  }

  let root = projectRootPath;
  root = root[root.length - 1] === path.sep ? root : root + path.sep;

  if (pkgPath.indexOf(root) !== 0) {
    return false;
  }

  const pkgRelativePath = pkgPath.slice(root.length);
  if (pkgRelativePath.split(path.sep).indexOf('vendor') !== -1) {
    return false;
  }

  return true;
}
