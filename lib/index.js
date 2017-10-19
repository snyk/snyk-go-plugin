var fs = require('fs');
var path = require('path');
var toml = require('toml');
var graphlib = require('graphlib');

var subProcess = require('./sub-process');

module.exports = {
  inspect: inspect,
};

function inspect(root, targetFile, options) {
  return Promise.all([
    getMetaData(root, targetFile),
    getDependencies(root, targetFile),
  ])
  .then(function (result) {
    return {
      plugin: result[0],
      package: result[1],
    };
  });
}

function getMetaData(root, targetFile) {
  return subProcess.execute('go', ['version'], {cwd: root})
  .then(function (output) {
    var runtime;
    versionMatch = /(go\d+\.?\d+?\.?\d*)/.exec(output);
    if (versionMatch) {
      runtime = versionMatch[0]
    }

    return {
      name: 'snyk-go-plugin',
      runtime: runtime,
      targetFile: pathToPosix(targetFile),
    };
  });
}

function getDependencies(root, targetFile) {
  var lockedVersions;
  return new Promise(function (resolve, reject) {
    try {
      lockedVersions = parseLockFile(root, targetFile);
      resolve(lockedVersions);
    } catch (e) {
      reject(new Error(
        'failed parsing ' + targetFile + ': ' + e.message));
    }
  }).then(function () {
    var goTreeTool = path.join(__dirname, '..', 'gosrc', 'deps-tree.go')

    return subProcess.execute(
      'go',
      ['run', goTreeTool],
      { cwd: root }
    )
  }).then(function (graph) {
    graph = JSON.parse(graph);
    graph = graphlib.json.read(graph);

    if (!graphlib.alg.isAcyclic(graph)) {
      throw new Error(
        'Go import cycle detected (not allowed by the Go compiler)');
    }

    var root = graph.node('.');
    if (!root) {
      throw new Error('Failed parsing dependency graph');
    }

    var projectRootPath = getProjectRootFromTargetFile(targetFile);

    var pkgsTree = recursivelyBuildPkgTree(
      graph, root, lockedVersions, projectRootPath, [], {});
    delete pkgsTree._counts;

    pkgsTree.packageFormatVersion = 'golang:0.0.1';

    return pkgsTree;
  }).catch(function (error) {
    if (typeof error === 'string') {
      if (error.indexOf('Unresolved packages:') !== -1) {
        throw new Error(
          'Unresolved imports found, please run `' +
          syncCmdForTarget(targetFile) + '`');
      }
      throw new Error(error);
    }
    throw error;
  });
}

var PACKAGE_MANAGER_BY_TARGET = {
  'Gopkg.lock': 'dep',
  'vendor.json': 'govendor',
};

var VENDOR_SYNC_CMD_BY_PKG_MANAGER = {
  dep: 'dep ensure',
  govendor: 'govendor fetch +outside',
}

function pkgManagerByTarget(targetFile) {
  var fname = path.basename(targetFile);
  return PACKAGE_MANAGER_BY_TARGET[fname];
}

function syncCmdForTarget(targetFile) {
  return VENDOR_SYNC_CMD_BY_PKG_MANAGER[
    pkgManagerByTarget(targetFile)];
}

function getProjectRootFromTargetFile(targetFile) {
  var fname = path.basename(targetFile);

  var resolved = path.resolve(targetFile);
  var parts = resolved.split(path.sep);

  if (parts[parts.length - 1] == 'Gopkg.lock') {
    return path.dirname(resolved);
  }

  if (
    parts[parts.length - 1] == 'vendor.json' &&
    parts[parts.length - 2] == 'vendor') {
    return path.dirname(path.dirname(resolved));
  }

  throw new Error('Unsupported file:', targetFile);
}

function recursivelyBuildPkgTree(
    graph,
    node,
    lockedVersions,
    projectRootPath,
    fromPath,
    counts
  ) {

  var isRoot = (fromPath.length == 0);

  var isProjSubpkg = isProjSubpackage(node.Dir, projectRootPath);

  var pkg = {
    name: (isRoot ? node.FullImportPath : node.Name),
    dependencies: {},
  }
  if (!isRoot && isProjSubpkg) {
    pkg._isProjSubpkg = true;
  }

  if (isRoot || isProjSubpkg) {
    pkg.version = '0.0.0';
  } else if (!lockedVersions[pkg.name]) {
    pkg.version = '';
    // TODO: warn or set to "?" ?
  } else {
    pkg.version = lockedVersions[pkg.name].version;
  }

  pkg.from = fromPath;
  if (isRoot || !isProjSubpkg) {
    pkg.from = pkg.from.concat(pkg.name + '@' + pkg.version)
  }

  pkg._counts = {};

  var children = graph.successors(node.Name).sort();
  children.forEach(function (depName) {

    // We drop branches of overly common pkgs:
    // this looses some paths, but avoids explosion in result size
    if ((counts[depName] || 0) + (pkg._counts[depName] || 0)  > 10) {
      return;
    }

    var dep = graph.node(depName);

    var child = recursivelyBuildPkgTree(
      graph,
      dep,
      lockedVersions,
      projectRootPath,
      pkg.from,
      sumCounts(counts, pkg._counts)
    );

    pkg._counts = sumCounts(pkg._counts, child._counts);
    delete child._counts;

    if (child._isProjSubpkg) {
      Object.keys(child.dependencies).forEach(function (grandChildName) {
        // don't merge grandchild if already a child,
        // because it was traversed with higher counts and may be more partial
        if (!pkg.dependencies[grandChildName]) {
          pkg.dependencies[grandChildName] = child.dependencies[grandChildName];
        }
      });
    } else {
      // in case was already added via a grandchild
      if (!pkg.dependencies[child.name]) {
        pkg.dependencies[child.name] = child;
        pkg._counts[child.name] = (pkg._counts[child.name] || 0) + 1;
      }
    }
  })

  return pkg;
}

function sumCounts(a, b) {
  var sum = shallowCopyMap(a);

  for (var k in b) {
    sum[k] = (sum[k] || 0) + b[k];
  }

  return sum;
}

function shallowCopyMap(m) {
  var copy = {};

  for (var k in m) {
    copy[k] = m[k]
  }

  return copy;
}

function isProjSubpackage(pkgPath, projectRootPath) {
  if (pkgPath == projectRootPath) {
    return true;
  }

  var root = projectRootPath;
  root =
   (root[root.length - 1] == path.sep) ? root : (root + path.sep);

  if (pkgPath.indexOf(root) != 0) {
    return false;
  }

  var pkgRelativePath = pkgPath.slice(root.length);

  if (
     pkgRelativePath.indexOf('vendor/') == 0 ||
     pkgRelativePath.indexOf('/vendor/') >= 0) {
    return false;
  }

  return true;
}

function parseLockFile(root, targetFile) {
  var pkgManager = pkgManagerByTarget(targetFile);
  switch (pkgManager) {
    case 'dep': {
      return parseDepLock(root, targetFile);
    }
    case 'govendor': {
      return parseGovendorLock(root, targetFile);
    }
    default: {
      throw new Error('Unsupported file:', targetFile);
    }
  }
}

function parseDepLock(root, targetFile) {
  var lock = fs.readFileSync(path.join(root, targetFile));

  // TODO: handle parse error
  var lockJson = toml.parse(String(lock))

  var deps = {};
  lockJson.projects && lockJson.projects.forEach(function (proj) {
    var version = proj.version || ('#' + proj.revision);

    proj.packages.forEach(function (subpackageName) {
      var name =
        (subpackageName == '.' ? proj.name : proj.name + '/' + subpackageName);

      var dep = {
        name: name,
        version: version,
      }

      deps[dep.name] = dep;
    });
  });

  return deps;
}

// TODO: branch, old Version can be a tag too?
function parseGovendorLock(root, targetFile) {
  var lock = fs.readFileSync(path.join(root, targetFile));

  var deps = {};
  var lockJson = JSON.parse(lock);

  var packages = lockJson.package || lockJson.Package;

  packages && packages.forEach(function (pkg) {
    var revision = pkg.revision || pkg.Revision || pkg.version || pkg.Version;

    var version = pkg.versionExact || ('#' + revision);

    var dep = {
      name: pkg.path,
      version: version,
    }

    deps[dep.name] = dep;
  });

  return deps;
}

function pathToPosix(fpath) {
  var parts = fpath.split(path.sep);
  return parts.join(path.posix.sep);
}
