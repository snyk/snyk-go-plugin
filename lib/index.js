var fs = require('fs');
var path = require('path');
var toml = require('toml');

var subProcess = require('./sub-process');

module.exports = {
  inspect: inspect,
};

function inspect(root, targetFile, options) {
  return Promise.all([
    getMetaData(root),
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
  var depLocks;
  return new Promise(function (resolve, reject) {
    try {
      depLocks = parseDepLock(root, targetFile);
      resolve(depLocks);
    } catch (e) {
      reject(new Error('failed parsing Gopkg.lock file: ' + e.message));
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

    var projectRootPath = path.dirname(path.resolve(targetFile));
    var pkgsTree = recursivelyBuildPkgTree(tree, depLocks, projectRootPath, []);
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

function getMetaData(root) {
  return subProcess.execute('go', ['version'], {cwd: root})
  .then(function (output) {
    return {
      name: 'snyk-go-plugin',
      runtime: /(go\d+\.\d+\.\d+)/.exec(output)[0],
    };
  });
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

function recursivelyBuildPkgTree(goDepsTree, depLocks, projectRootPath, fromPath) {
  var isRoot = (fromPath.length == 0);

  var pkg = {
    name: (isRoot ? goDepsTree.FullImportPath : goDepsTree.Name),
    dependencies: {},
  }

  if (isRoot || isRootSubpkg(goDepsTree.Dir, projectRootPath)) {
    pkg.version = '0.0.0';
  } else if (!depLocks[pkg.name]) {
    pkg.version = '';
    // TODO: warn or set to "?" ?
  } else {
    pkg.version = depLocks[pkg.name].version;
  }

  pkg.from = fromPath.concat(pkg.name + '@' + pkg.version)

  goDepsTree.Deps && goDepsTree.Deps.forEach(function (dep) {
    var child = recursivelyBuildPkgTree(
      dep, depLocks, projectRootPath, pkg.from)
    pkg.dependencies[child.name] = child;
  })

  return pkg;
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
