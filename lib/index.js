var fs = require('fs');
var path = require('path');
var toml = require('toml');

var subProcess = require('./sub-process');

module.exports = {
  inspect: inspect,
};

function inspect(root, targetFile, options) {
  if (!options) { options = { dev: false }; }

  return new Promise(function (resolve, reject) {
    try {
      var depLocks = parseDepLock(root, targetFile, options);
      resolve(depLocks);
    } catch (e) {
      reject(new Error('failed parsing Gopkg.lock file: ' + e.message));
    }
  }).then(function (depLocks) {
    var goTreeTool = path.join(__dirname, '..', 'gosrc', 'deps-tree.go')

    return subProcess.execute(
      'go',
      ['run', goTreeTool],
      { cwd: root }
    ).then(function (tree) {
      console.log(tree);
      tree = JSON.parse(tree);

      var pkgsTree = recursivelyBuildPkgTree(tree, depLocks, []);

      return {
        plugin: {
          name: 'snyk-go-plugin',
          // TODO: engine: `go version`
        },
        package: pkgsTree,
      }
    }).catch(function (error) {
      if (typeof error === 'string') {
        if (error.indexOf('Unresolved packages:') !== -1) {
          throw new Error('Please run `dep ensure`');
        }
        throw new Error(error);
      }
      throw error;
    });
  })
}

function recursivelyBuildPkgTree(goDepsTree, depLocks, fromPath) {
  var isRoot = (fromPath.length == 0);

  var pkg = {
    name: (isRoot ? goDepsTree.FullImportPath : goDepsTree.Name),
    dependencies: {},
  }

  pkg.version = (isRoot ? '0.0.0' : depLocks[pkg.name].version);
  pkg.from = fromPath.concat(pkg.name + '@' + pkg.version)

  goDepsTree.Deps && goDepsTree.Deps.forEach(function (dep) {
    var child = recursivelyBuildPkgTree(dep, depLocks, pkg.from)
    pkg.dependencies[child.name] = child;
  })

  return pkg;
}

function parseDepLock(root, targetFile, options) {
  var lock = fs.readFileSync(path.join(root, targetFile));

  // TODO: handle parse error
  var lockJson = toml.parse(String(lock))

  var deps = {};

  lockJson.projects.forEach(function (proj) {
    var version =
      (proj.version ? proj.version.slice(1) : '#' + proj.revision);

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