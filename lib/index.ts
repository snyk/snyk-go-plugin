import * as fs from 'fs';
import * as path from 'path';
import * as toml from 'toml';
import * as graphlib from 'graphlib';
import * as tmp from 'tmp';

import * as subProcess from './sub-process';

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

export function inspect(root, targetFile) {

  return Promise.all([
    getMetaData(root, targetFile),
    getDependencies(root, targetFile),
  ])
    .then((result) => {
      return {
        plugin: result[0],
        package: result[1],
      };
    });
}

function getMetaData(root, targetFile) {
  return subProcess.execute('go', ['version'], {cwd: root})
    .then((output) => {
      let runtime;
      const versionMatch = /(go\d+\.?\d+?\.?\d*)/.exec(output);
      if (versionMatch) {
        runtime = versionMatch[0];
      }

      return {
        name: 'snyk-go-plugin',
        runtime,
        targetFile: pathToPosix(targetFile),
      };
    });
}

// Hack:
// We're using Zeit assets feature in order to support Python and Go testing
// within a binary release. By doing "path.join(__dirname, 'PATH'), Zeit adds
// PATH file auto to the assets. Sadly, Zeit doesn't support (as far as I
// understand) adding a full folder as an asset, and this is why we're adding
// the required files this way. In addition, Zeit doesn't support
// path.resolve(), and this is why I'm using path.join()
function createAssets() {
  const assets: string[] = [];
  assets.push(path.join(__dirname, '../gosrc/resolve-deps.go'));
  assets.push(path.join(__dirname, '../gosrc/resolver/pkg.go'));
  assets.push(path.join(__dirname, '../gosrc/resolver/resolver.go'));
  assets.push(path.join(__dirname, '../gosrc/resolver/dirwalk/dirwalk.go'));
  assets.push(path.join(__dirname, '../gosrc/resolver/graph/graph.go'));

  return assets;
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

function getDependencies(root, targetFile) {
  let config;
  let tempDirObj;
  return new Promise((resolve) => {
    config = parseConfig(root, targetFile);
    resolve(config);
  }).then(() => {
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
    return subProcess.execute(
      'go',
      ['run', goResolveTool, ignorePkgsParam],
      {cwd: root},
    );
  }).then((graphStr) => {
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
  }).catch((error) => {
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
  });
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

function sumCounts(a, b) {
  const sum = shallowCopyMap(a);

  for (const k of Object.keys(b)) {
    sum[k] = (sum[k] || 0) + b[k];
  }

  return sum;
}

function shallowCopyMap(m) {
  const copy = {};

  for (const k of Object.keys(m)) {
    copy[k] = m[k];
  }

  return copy;
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

function parseConfig(root, targetFile) {
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

function parseDepLock(root, targetFile) {
  try {
    const lock = fs.readFileSync(path.join(root, targetFile));

    const lockJson = toml.parse(String(lock));

    const deps = {};
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

function parseDepManifest(root, targetFile) {
  const manifestDir = path.dirname(path.join(root, targetFile));
  const manifestPath = path.resolve(path.join(manifestDir, 'Gopkg.toml'));

  try {
    const manifestToml = fs.readFileSync(manifestPath);

    const manifestJson = toml.parse(String(manifestToml)) || {};

    manifestJson.ignored = manifestJson.ignored || [];

    return manifestJson;
  } catch (e) {
    throw (new Error('failed parsing Gopkg.toml: ' + e.message));
  }
}

// TODO: branch, old Version can be a tag too?
function parseGovendorJson(root, targetFile) {
  const config = {
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
