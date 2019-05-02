import * as fs from 'fs';
import * as path from 'path';
import * as graphlib from 'graphlib';
import * as tmp from 'tmp';
import debugLib = require('debug');

import * as subProcess from './sub-process';

import { parseGoPkgConfig, parseGoVendorConfig, GoPackageManagerType } from 'snyk-go-parser';

const debug = debugLib('snyk-go-plugin');

const VIRTUAL_ROOT_NODE_ID = '.';

export interface DepDict {
  [name: string]: DepTree;
}

export interface DepTree {
  name: string;
  version?: string;
  dependencies?: DepDict;
  packageFormatVersion?: string;

  _counts?: any;
  _isProjSubpkg?: boolean;
}

interface CountDict {
  [k: string]: number;
}

interface Options {
  debug?: boolean;
}

export async function inspect(root, targetFile, options: Options = {}) {
  options.debug ? debugLib.enable('snyk-go-plugin') : debugLib.disable();

  const result = await Promise.all([
    getMetaData(root, targetFile),
    getDependencies(root, targetFile),
  ]);
  return {
    plugin: result[0],
    package: result[1],
  };
}

async function getMetaData(root, targetFile) {
  const output = await subProcess.execute('go', ['version'], {cwd: root});
  const versionMatch = /(go\d+\.?\d+?\.?\d*)/.exec(output);
  const runtime = (versionMatch) ? versionMatch[0] : undefined;

  return {
    name: 'snyk-go-plugin',
    runtime,
    targetFile: pathToPosix(targetFile),
  };
}

function createAssets() {
  // path.join calls have to be exactly in this format, needed by "pkg" to build a standalone Snyk CLI binary:
  // https://www.npmjs.com/package/pkg#detecting-assets-in-source-code
  return [
    path.join(__dirname, '../gosrc/resolve-deps.go'),
    path.join(__dirname, '../gosrc/resolver/pkg.go'),
    path.join(__dirname, '../gosrc/resolver/resolver.go'),
    path.join(__dirname, '../gosrc/resolver/dirwalk/dirwalk.go'),
    path.join(__dirname, '../gosrc/resolver/graph/graph.go'),
  ];
}

function writeFile(writeFilePath, contents) {
  const dirPath = path.dirname(writeFilePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
  fs.writeFileSync(writeFilePath, contents);
}

function getFilePathRelativeToDumpDir(filePath) {
  let pathParts = filePath.split('\\gosrc\\');

  // Windows
  if (pathParts.length > 1) {
    return pathParts[1];
  }

  // Unix
  pathParts = filePath.split('/gosrc/');
  return pathParts[1];
}

function dumpAllResolveDepsFilesInTempDir(tempDirName) {
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

async function getDependencies(root, targetFile) {
  let tempDirObj;
  try {
    debug('parsing manifest/lockfile', {root, targetFile});
    const config = parseConfig(root, targetFile);
    tempDirObj = tmp.dirSync({
      unsafeCleanup: true,
    });

    dumpAllResolveDepsFilesInTempDir(tempDirObj.name);

    const goResolveTool =
      path.join(tempDirObj.name, 'resolve-deps.go');
    let ignorePkgsParam;
    if (config.ignoredPkgs && config.ignoredPkgs.length > 0) {
      ignorePkgsParam = '-ignoredPkgs=' + config.ignoredPkgs.join(',');
    }
    const args = ['run', goResolveTool, ignorePkgsParam];
    debug('executing go deps resolver', {cmd: 'go' + args.join(' ')});
    const graphStr = await subProcess.execute(
      'go',
      args,
      {cwd: root},
    );
    tempDirObj.removeCallback();
    debug('loading deps resolver graph output to graphlib', {jsonSize: graphStr.length});
    const graph = graphlib.json.read(JSON.parse(graphStr));

    if (!graphlib.alg.isAcyclic(graph)) {
      throw new Error(
        'Go import cycle detected (not allowed by the Go compiler)');
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
      graph, rootNode, config.lockedVersions, projectRootPath, {});
    delete pkgsTree._counts;

    pkgsTree.packageFormatVersion = 'golang:0.0.1';
    debug('done building dep-tree', {rootPkgName: pkgsTree.name});

    return pkgsTree;
  } catch (error) {
    if (tempDirObj) {
      tempDirObj.removeCallback();
    }
    if (typeof error === 'string') {
      const unresolvedOffset = error.indexOf('Unresolved packages:');
      if (unresolvedOffset !== -1) {
        throw new Error(
          error.slice(unresolvedOffset) + '\n' +
          'Unresolved imports found, please run `' +
          syncCmdForTarget(targetFile) + '`');
      }
      throw new Error(error);
    }
    throw error;
  }
}

const PACKAGE_MANAGER_BY_TARGET: {[k: string]: GoPackageManagerType}  = {
  'Gopkg.lock': 'golangdep',
  'vendor.json': 'govendor',
};

const VENDOR_SYNC_CMD_BY_PKG_MANAGER: {[k in GoPackageManagerType]: string} = {
  golangdep: 'dep ensure',
  govendor: 'govendor sync',
};

function pkgManagerByTarget(targetFile): GoPackageManagerType {
  const fname = path.basename(targetFile);
  return PACKAGE_MANAGER_BY_TARGET[fname];
}

function syncCmdForTarget(targetFile) {
  return VENDOR_SYNC_CMD_BY_PKG_MANAGER[
    pkgManagerByTarget(targetFile)];
}

function getProjectRootFromTargetFile(targetFile) {
  const resolved = path.resolve(targetFile);
  const parts = resolved.split(path.sep);

  if (parts[parts.length - 1] === 'Gopkg.lock') {
    return path.dirname(resolved);
  }

  if (
    parts[parts.length - 1] === 'vendor.json' &&
    parts[parts.length - 2] === 'vendor') {
    return path.dirname(path.dirname(resolved));
  }

  throw new Error('Unsupported file: ' + targetFile);
}

function recursivelyBuildPkgTree(
  graph,
  node,
  lockedVersions,
  projectRootPath,
  totalPackageOccurenceCounter: CountDict,
): DepTree {

  const isRoot = (node.Name === VIRTUAL_ROOT_NODE_ID);

  const isProjSubpkg = isProjSubpackage(node.Dir, projectRootPath);

  const pkg: DepTree = {
    name: (isRoot ? node.FullImportPath : node.Name),
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

  const children = graph.successors(node.Name).sort();
  children.forEach((depName) => {

    // We drop branches of overly common pkgs:
    // this looses some paths, but avoids explosion in result size
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
        // don't merge grandchild if already a child,
        // because it was traversed with higher counts and may be more partial
        if (!pkg.dependencies![grandChildName]) {
          pkg.dependencies![grandChildName] = child.dependencies![grandChildName];
        }
      });
    } else {
      // in case was already added via a grandchild
      if (!pkg.dependencies![child.name]) {
        pkg.dependencies![child.name] = child;
        totalPackageOccurenceCounter[child.name] = (totalPackageOccurenceCounter[child.name] || 0) + 1;
      }
    }
  });

  return pkg;
}

function isProjSubpackage(pkgPath, projectRootPath) {
  if (pkgPath === projectRootPath) {
    return true;
  }

  let root = projectRootPath;
  root =
   (root[root.length - 1] === path.sep) ? root : (root + path.sep);

  if (pkgPath.indexOf(root) !== 0) {
    return false;
  }

  const pkgRelativePath = pkgPath.slice(root.length);
  if (pkgRelativePath.split(path.sep).indexOf('vendor') !== -1) {
    return false;
  }

  return true;
}

interface LockedDep {
  name: string;
  version: string;
}

interface LockedDeps {
  [dep: string]: LockedDep;
}

interface GoProjectConfig {
  ignoredPkgs: string[];
  lockedVersions: LockedDeps;
}

interface DepManifest {
  ignored: string[];
}

function parseConfig(root, targetFile): GoProjectConfig {
  const pkgManager = pkgManagerByTarget(targetFile);
  debug('detected package-manager:', pkgManager);
  switch (pkgManager) {
    case 'golangdep': {
      try {
        return parseGoPkgConfig(getDepManifest(root, targetFile), getDepLock(root, targetFile));
      } catch (e) {
        throw (new Error('failed parsing manifest/lock files for Go dep: ' + e.message));
      }
    }
    case 'govendor': {
      try {
        return parseGoVendorConfig(getGovendorJson(root, targetFile));
      } catch (e) {
        throw (new Error('failed parsing config file for Go Vendor Tool: ' + e.message));
      }
    }
    default: {
      throw new Error('Unsupported file: ' + targetFile);
    }
  }

}

function getDepLock(root, targetFile): string {
  return fs.readFileSync(path.join(root, targetFile), 'utf8');
}

function getDepManifest(root, targetFile): string {
  const manifestDir = path.dirname(path.join(root, targetFile));
  const manifestPath = path.join(manifestDir, 'Gopkg.toml');

  return fs.readFileSync(manifestPath, 'utf8');
}

// TODO: branch, old Version can be a tag too?
function getGovendorJson(root, targetFile): string {
  return fs.readFileSync(path.join(root, targetFile), 'utf8');
}

function pathToPosix(fpath) {
  const parts = fpath.split(path.sep);
  return parts.join(path.posix.sep);
}
