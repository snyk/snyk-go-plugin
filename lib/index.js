var fs = require('fs');
var path = require('path');
var toml = require('toml');

module.exports = {
  inspect: inspect,
};

// TODO:
//  - handle gopkg.in
//  - handle non github packages (like golang.org/..

function inspect(root, targetFile, options) {
  if (!options) { options = { dev: false }; }

  return new Promise(function (resolve, reject) {
    resolve(parseDepLock(root, targetFile, options));
  });
}

function parseDepLock(root, targetFile, options) {
  // TODO: check file exists
  var lock = fs.readFileSync(path.join(root, targetFile));

  // TODO: handle parse error
  var lockJson = toml.parse(String(lock))

  // TODO: how to treat pkgs that use  non-master branch
  var deps = {};

  lockJson.projects.forEach(function (proj) {
    // TODO: I guess git-hash "version" should be treated differently
    var version = (proj.version ? proj.version.slice(1) : '#' + proj.revision);

    proj.packages.forEach(function (subpackageName) {
      var name = (subpackageName == '.' ? proj.name : proj.name + '/' + subpackageName);

      var dep = {
        name: name,
        version: version,
      }

      deps[dep.name] = dep;
    });
  });

  return {
    plugin: {
      name: 'snyk-go-plugin',
    },
    package: {
      dependencies: deps,
    },
  }
}