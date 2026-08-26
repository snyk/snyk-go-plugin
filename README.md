![Snyk logo](https://snyk.io/style/asset/logo/snyk-print.svg)

***

Snyk helps you find, fix and monitor for known vulnerabilities in your dependencies, both on an ad hoc basis and as part of your CI (Build) system.

| :information_source: This repository is only a plugin to be used with the Snyk CLI tool. To use this plugin to test and fix vulnerabilities in your project, install the Snyk CLI tool first. Head over to [snyk.io](https://github.com/snyk/snyk) to get started. |
| --- |

## Snyk Golang CLI Plugin

This plugin provides dependency metadata for Golang projects that use `dep` (and have a `Gopkg.lock` file), or `govendor` (and have a `vendor/vendor.json` file).

## Breaking changes in v2.x

When upgrading from v1 to v2 of this plugin, note that PackageURL information will be present by default when invoking the `inspect()` function.

```diff
  {
    "name": "golang.org/x/exp/slices"
    "version": "#2e198f4a06a1"
+   "purl": "pkg:golang/golang.org/x/exp@v0.0.0-20230522175609-2e198f4a06a1#slices"
  }
```

To disable this behaviour, it can be turned off through the options passed to the function:

```diff
  const result = await inspect(
    process.cwd(),
    "go.mod",
-   {},
+   { configuration: { includePackageUrls: false } },
  )
```
