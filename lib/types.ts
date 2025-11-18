import type { DepGraph } from '@snyk/dep-graph';

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

export interface CountDict {
  [k: string]: number;
}

export interface Options {
  debug?: boolean;
  file?: string;
  args?: string[];
  configuration?: {
    includeGoStandardLibraryDeps?: boolean;
  };
}

export interface DepGraphResult {
  plugin: PluginMetadata;
  dependencyGraph: DepGraph;
}

export interface DepTreeResult {
  plugin: PluginMetadata;
  package: DepTree;
}

export interface PluginMetadata {
  name: string;
  runtime: string | undefined;
  targetFile: any;
}

// https://golang.org/cmd/go/#hdr-List_packages_or_modules
export interface GoPackage {
  Dir: string; // directory containing package sources
  ImportPath: string; // import path of package in dir
  ImportComment?: string; // path in import comment on package statement
  Name: string; // package name
  Doc?: string; // package documentation string
  Target?: string; // install path
  Shlib?: string; // the shared library that contains this package (only set when -linkshared)
  Goroot?: boolean; // is this package in the Go root?
  Standard?: boolean; // is this package part of the standard Go library?
  Stale?: boolean; // would 'go install' do anything for this package?
  StaleReason?: string; // explanation for Stale==true
  Root?: string; // Go root or Go path dir containing this package
  ConflictDir?: string; // this directory shadows Dir in $GOPATH
  BinaryOnly?: boolean; // binary-only package: cannot be recompiled from sources
  ForTest?: string; // package is only for use in named test
  Export?: string; // file containing export data (when using -export)
  Module?: GoModule; // info about package's containing module, if any (can be nil)
  Match?: string[]; // command-line patterns matching this package
  DepOnly?: boolean; // package is only a dependency, not explicitly listed
  // Dependency information
  Imports?: string[]; // import paths used by this package
  ImportMap: { string: string }; // map from source import to ImportPath (identity entries omitted)
  Deps: string[]; // all (recursively) imported dependencies
  TestImports: string[]; // imports from TestGoFiles
  XTestImports: string[]; // imports from XTestGoFiles
  // Error information
  Incomplete: boolean; // this package or a dependency has an error
  Error: GoPackageError; // error loading package
  DepsErrors: GoPackageError[]; // errors loading dependencies
}

// https://golang.org/cmd/go/#hdr-List_packages_or_modules
export interface GoModule {
  Path: string; // module path
  Version: string; // module version
  Versions: string[]; // available module versions (with -versions)
  Replace: GoModule; // replaced by this module
  Time: string; // time version was created
  Update: GoModule; // available update, if any (with -u)
  Main: boolean; // is this the main module?
  Indirect: boolean; // is this module only an indirect dependency of main module?
  Dir: string; // directory holding files for this module, if any
  GoMod: string; // path to go.mod file for this module, if any
  Error: string; // error loading module
}

// https://golang.org/cmd/go/#hdr-List_packages_or_modules
interface GoPackageError {
  ImportStack: string[]; // shortest path from package named on command line to this one
  Pos: string; // position of error (if present, file:line:col)
  Err: string; // the error itself
}
