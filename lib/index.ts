import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as toml from 'toml';
import * as graphlib from 'graphlib';
import * as tmp from 'tmp';

import * as subProcess from './sub-process';

const VIRTUAL_ROOT_NODE_ID = '.';

const isWindows = /^win/.test(os.platform());

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

export async function inspect(root, targetFile) {

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
    const graphStr = await subProcess.execute(
      'go',
      ['run', goResolveTool, ignorePkgsParam],
      {cwd: root},
    );
    tempDirObj.removeCallback();
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

    const pkgsTree = recursivelyBuildPkgTree(
      graph, rootNode, config.lockedVersions, projectRootPath, {});
    delete pkgsTree._counts;

    pkgsTree.packageFormatVersion = 'golang:0.0.1';

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

const PACKAGE_MANAGER_BY_TARGET = {
  'Gopkg.lock': 'dep',
  'vendor.json': 'govendor',
};

const VENDOR_SYNC_CMD_BY_PKG_MANAGER = {
  dep: 'dep ensure',
  govendor: 'govendor sync',
};

function pkgManagerByTarget(targetFile) {
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
  counts,
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

  pkg._counts = {};

  const children = graph.successors(node.Name).sort();
  children.forEach((depName) => {

    // We drop branches of overly common pkgs:
    // this looses some paths, but avoids explosion in result size
    if ((counts[depName] || 0) + (pkg._counts[depName] || 0)  > 10) {
      return;
    }

    const dep = graph.node(depName);

    const child = recursivelyBuildPkgTree(
      graph,
      dep,
      lockedVersions,
      projectRootPath,
      sumCounts(counts, pkg._counts),
    );

    pkg._counts = sumCounts(pkg._counts, child._counts);
    delete child._counts;

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
        pkg._counts[child.name] = (pkg._counts[child.name] || 0) + 1;
      }
    }
  });

  return pkg;
}

function sumCounts(a: CountDict, b: CountDict): CountDict {
  const sum = {...a};

  for (const k of Object.keys(b)) {
    sum[k] = (sum[k] || 0) + b[k];
  }

  return sum;
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

// TODO(kyegupov): the part below will move to snyk-go-parser

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
  let config = {
    ignoredPkgs: [] as string[],
    lockedVersions: {},
  };
  switch (pkgManager) {
    case 'dep': {
      config.lockedVersions = parseDepLock(root, targetFile);
      const manifest = parseDepManifest(root, targetFile);
      config.ignoredPkgs = manifest.ignored;
      break;
    }
    case 'govendor': {
      config = parseGovendorJson(root, targetFile);
      break;
    }
    default: {
      throw new Error('Unsupported file: ' + targetFile);
    }
  }

  return config;
}

function parseDepLock(root, targetFile): LockedDeps {
  try {
    const lock = fs.readFileSync(path.join(root, targetFile));

    const lockJson = toml.parse(String(lock));

    const deps: LockedDeps = {};
    if (lockJson.projects) {
      lockJson.projects.forEach((proj) => {
        const version = proj.version || ('#' + proj.revision);

        proj.packages.forEach((subpackageName) => {
          const name =
            (subpackageName === '.' ?
              proj.name :
              proj.name + '/' + subpackageName);

          const dep = {
            name,
            version,
          };

          deps[dep.name] = dep;
        });
      });
    }

    return deps;
  } catch (e) {
    throw (new Error('failed parsing ' + targetFile + ': ' + e.message));
  }
}

function parseDepManifest(root, targetFile): DepManifest {
  const manifestDir = path.dirname(path.join(root, targetFile));
  const manifestPath = path.resolve(path.join(manifestDir, 'Gopkg.toml'));

  try {
    const manifestToml = fs.readFileSync(manifestPath, 'utf8');

    const manifestJson = toml.parse(manifestToml) || {};

    manifestJson.ignored = manifestJson.ignored || [];

    return manifestJson;
  } catch (e) {
    throw (new Error('failed parsing Gopkg.toml: ' + e.message));
  }
}

// TODO: branch, old Version can be a tag too?
function parseGovendorJson(root, targetFile): GoProjectConfig {
  const config: GoProjectConfig = {
    ignoredPkgs: [] as string[],
    lockedVersions: {},
  };
  try {
    const jsonStr = fs.readFileSync(path.join(root, targetFile), 'utf8');
    const gvJson = JSON.parse(jsonStr);

    const packages = gvJson.package || gvJson.Package;
    if (packages) {
      packages.forEach((pkg) => {
        const revision = pkg.revision || pkg.Revision || pkg.version || pkg.Version;

        const version = pkg.versionExact || ('#' + revision);

        const dep = {
          name: pkg.path,
          version,
        };

        config.lockedVersions[dep.name] = dep;
      });
    }

    const ignores = gvJson.ignore || '';
    ignores.split(/\s/).filter((s) => {
      // otherwise it's a build-tag rather than a pacakge
      return s.indexOf('/') !== -1;
    }).forEach((pkgName) => {
      pkgName = pkgName.replace(/\/+$/, ''); // remove trailing /
      config.ignoredPkgs.push(pkgName);
      config.ignoredPkgs.push(pkgName + '/*');
    });

    return config;
  } catch (e) {
    throw (new Error('failed parsing ' + targetFile + ': ' + e.message));
  }
}

function pathToPosix(fpath) {
  const parts = fpath.split(path.sep);
  return parts.join(path.posix.sep);
}
