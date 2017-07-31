var fs = require('fs');
var path = require('path');
var toml = require('toml');

var subProcess = require('./sub-process');

module.exports = {
  inspect: inspect,
};

// TODO:
//  - handle gopkg.in
//  - handle non github packages (like golang.org/..)

function inspect(root, targetFile, options) {
  if (!options) { options = { dev: false }; }

  // TODO: handle if missing
  var depLocks = parseDepLock(root, targetFile, options);

  var goTreeTool = path.join(__dirname, '..', 'gosrc', 'deps-tree.go')

  return subProcess.execute(
    'go',
    ['run', goTreeTool],
    {cwd: root}
  ).then(function (tree) {
    tree = JSON.parse(tree);

    var pkgsTree = buildPkgsTree(tree, depLocks);

    return {
      plugin: {
        name: 'snyk-go-plugin',
      },
      package: pkgsTree,
    }
  });
}

function buildPkgsTree(goDepsTree, depLocks) {
  // TODO: what version to use for root? 0.0.0?
  var root = {
    name: goDepsTree.FullImportPath,
    dependencies: {},
    version: '0.0.0',
  }
  root.from = [root.name + '@' + root.version]

  goDepsTree.Deps && goDepsTree.Deps.forEach(function (dep) {
    var pkg = recursivelyBuildPkgs(dep, depLocks, root.from)
    root.dependencies[pkg.name] = pkg;
  })

  return root;
}

function recursivelyBuildPkgs(goDepsTree, depLocks, fromPath) {
  var pkg = {
    name: goDepsTree.Name,
    dependencies: {},
  }
  // TODO: handle case when pkg missing in locks
  pkg.version = depLocks[pkg.name].version;
  pkg.from = fromPath.concat(pkg.name + '@' + pkg.version)

  goDepsTree.Deps && goDepsTree.Deps.forEach(function (dep) {
    var child = recursivelyBuildPkgs(dep, depLocks, pkg.from)
    pkg.dependencies[child.name] = child;
  })

  return pkg;
}

function parseDepLock(root, targetFile, options) {
  // TODO: check file exists
  var lock = fs.readFileSync(path.join(root, targetFile));

  // TODO: handle parse error
  var lockJson = toml.parse(String(lock))

  // TODO: how to treat pkgs that use  non-master branch
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