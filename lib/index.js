var fs = require('fs');
var path = require('path');
var toml = require('toml');

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
  }).then(function (tree) {
    tree = JSON.parse(tree);

    var projectRootPath = getProjectRootFromTargetFile(targetFile);
    var pkgsTree = recursivelyBuildPkgTree(
      tree, lockedVersions, projectRootPath, []);

    pkgsTree.packageFormatVersion = 'golang:0.0.1';

    return pkgsTree;
  }).catch(function (error) {
    if (typeof error === 'string') {
      if (error.indexOf('Unresolved packages:') !== -1) {
        throw new Error('Please run `dep ensure`');
      }
      throw new Error(error);
    }
    throw error;
  });
}

function getMetaData(root, targetFile) {
  return subProcess.execute('go', ['version'], {cwd: root})
  .then(function (output) {
    return {
      name: 'snyk-go-plugin',
      runtime: /(go\d+\.\d+\.\d+)/.exec(output)[0],
      targetFile: pathToPosix(targetFile),
    };
  });
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

function isRootSubpkg(pkgPath, projectRootPath) {
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

function recursivelyBuildPkgTree(
   goDepsTree,
   lockedVersions,
   projectRootPath,
   fromPath) {
  var isRoot = (fromPath.length == 0);

  var pkg = {
    name: (isRoot ? goDepsTree.FullImportPath : goDepsTree.Name),
    dependencies: {},
  }

  if (isRoot || isRootSubpkg(goDepsTree.Dir, projectRootPath)) {
    pkg.version = '0.0.0';
  } else if (!lockedVersions[pkg.name]) {
    pkg.version = '';
    // TODO: warn or set to "?" ?
  } else {
    pkg.version = lockedVersions[pkg.name].version;
  }

  pkg.from = fromPath;
  if (!isInternalPackage(pkg.name)) {
    pkg.from = pkg.from.concat(pkg.name + '@' + pkg.version)
  }

  goDepsTree.Deps && goDepsTree.Deps.forEach(function (dep) {
    var child = recursivelyBuildPkgTree(
      dep, lockedVersions, projectRootPath, pkg.from);

    if (isInternalPackage(child.name)) {
      Object.keys(child.dependencies).forEach(function (grandChildName) {
        pkg.dependencies[grandChildName] = child.dependencies[grandChildName];
      });
    } else {
      pkg.dependencies[child.name] = child;
    }
  })

  return pkg;
}

function isInternalPackage(importPath) {
  return (importPath.indexOf('/internal/') != -1)
}

function parseLockFile(root, targetFile) {
  var fname = path.basename(targetFile);
  switch (fname) {
    case 'Gopkg.lock': {
      return parseDepLock(root, targetFile);
    }
    case 'vendor.json': {
      return parseGovendorLock(root, targetFile);
    }
    default: {
      throw new Error('Unsupported file:', targetFile);
    }
  }
}

function parseDepLock(root, targetFile) {
  // TODO: handle read error
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

function parseGovendorLock(root, targetFile) {
  // TODO: handle read error
  var lock = fs.readFileSync(path.join(root, targetFile));

  var deps = {};
  var lockJson = JSON.parse(lock);
  lockJson.package && lockJson.package.forEach(function (pkg) {
    var version = pkg.versionExact || ('#' + pkg.revision);

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
