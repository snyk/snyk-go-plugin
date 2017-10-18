![Snyk logo](https://snyk.io/style/asset/logo/snyk-print.svg)

***

Snyk helps you find, fix and monitor for known vulnerabilities in your dependencies, both on an ad hoc basis and as part of your CI (Build) system.

## Snyk Golang CLI Plugin

This plugin provides dependency metadata for Golang projects that use one of the following package-management tools:
* [dep](https://github.com/golang/dep) (and have a `Gopkg.lock`)
* [govendor](https://github.com/kardianos/govendor) (and have a `vendor/vendor.json`)
* [Godep](https://github.com/tools/godep) (and have a `Godeps/Godeps.json`)
  * deprecated `Godep` behaviour that still uses `Godeps/_workspace/` instead of `vendor/` is not supported
