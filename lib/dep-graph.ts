import * as path from 'path';
import { DepGraph, DepGraphBuilder, PkgInfo } from '@snyk/dep-graph';

import { resolveStdlibVersion } from './helpers';
import { GoModule, GoPackage, Options } from './types';
import { CustomError } from './errors/custom-error';
import { parseVersion, toSnykVersion } from './version';
import { runGo } from './sub-process';
import { createGoPurl } from './package-url';

export async function getDepGraph(
  root: string,
  targetFile: string,
  options: Options = {},
): Promise<DepGraph> {
  const { args: additionalArgs = [], configuration } = options;

  const includeGoStandardLibraryDeps =
    configuration?.includeGoStandardLibraryDeps ?? false;

  // Determine stdlib version
  const stdlibVersion = includeGoStandardLibraryDeps
    ? await resolveStdlibVersion(root, targetFile)
    : 'unknown';

  const useReplaceName = configuration?.useReplaceName ?? false;

  const includePackageUrls = configuration?.includePackageUrls ?? true;

  return buildDepGraphFromImportsAndModules(root, targetFile, {
    stdlibVersion,
    additionalArgs,
    includeGoStandardLibraryDeps,
    includePackageUrls,
    useReplaceName,
  });
}

interface GraphOptions {
  stdlibVersion?: string;
  additionalArgs?: string[];
  includeGoStandardLibraryDeps?: boolean;
  includePackageUrls?: boolean;
  /**
   * Temporary: This option fixes the wrongful identification of a module
   * when it is actually being replaced with a differently named module.
   * This option is being used for a gradual rollout of the fix, and
   * removed once the rollout is complete.
   **/
  useReplaceName?: boolean;
}

export async function buildDepGraphFromImportsAndModules(
  root: string = '.',
  targetFile: string = 'go.mod',
  options: GraphOptions = {},
): Promise<DepGraph> {
  // TODO(BST-657): parse go.mod file to obtain root module name and go version
  const projectName = path.basename(root); // The correct name should come from the `go list` command
  const projectVersion = '0.0.0'; // TODO(BST-657): try `git describe`?

  options = {
    stdlibVersion: 'unknown',
    additionalArgs: [],
    includeGoStandardLibraryDeps: false,
    includePackageUrls: false,
    useReplaceName: false,
    ...options,
  };

  let rootPkg = createPkgInfo(projectName, projectVersion, options);

  let depGraphBuilder = new DepGraphBuilder({ name: 'gomodules' }, rootPkg);

  let goDepsOutput: string;

  const args = [
    'list',
    ...(options.additionalArgs ?? []),
    '-json',
    '-deps',
    './...',
  ];
  try {
    const goModAbsolutPath = path.resolve(root, path.dirname(targetFile));
    goDepsOutput = await runGo(args, { cwd: goModAbsolutPath });
  } catch (err: any) {
    if (/cannot find main module, but found/.test(err)) {
      return depGraphBuilder.build();
    }
    if (/does not contain main module/.test(err)) {
      return depGraphBuilder.build();
    }
    const userError = new CustomError(err);
    userError.userMessage = `'go ${args.join(
      ' ',
    )}' command failed with error: ${userError.message}`;
    throw userError;
  }

  if (goDepsOutput.includes('matched no packages')) {
    return depGraphBuilder.build();
  }

  const goDepsString = `[${goDepsOutput.replace(/}\r?\n{/g, '},{')}]`;
  const goDeps: GoPackage[] = JSON.parse(goDepsString);
  const packagesByName: { [name: string]: GoPackage } = {};
  for (const gp of goDeps) {
    packagesByName[normalizeImportPath(gp.ImportPath)] = gp;
  }

  const localPackages = goDeps.filter((gp) => !gp.DepOnly);
  const localPackageWithMainModule = localPackages.find(
    (localPackage) => !!(localPackage.Module && localPackage.Module.Main),
  );
  if (localPackageWithMainModule?.Module?.Path) {
    rootPkg = createPkgInfo(
      localPackageWithMainModule.Module.Path,
      projectVersion,
      options,
    );
    depGraphBuilder = new DepGraphBuilder({ name: 'gomodules' }, rootPkg);
  }
  const topLevelDeps = extractAllImports(localPackages);

  const childrenChain = new Map();
  const ancestorsChain = new Map();

  buildGraph(
    depGraphBuilder,
    topLevelDeps,
    packagesByName,
    'root-node',
    childrenChain,
    ancestorsChain,
    options,
  );

  return depGraphBuilder.build();
}

export function buildGraph(
  depGraphBuilder: DepGraphBuilder,
  depPackages: string[],
  packagesByName: { [name: string]: GoPackage },
  currentParent: string,
  childrenChain: Map<string, string[]>,
  ancestorsChain: Map<string, string[]>,
  options: GraphOptions,
  visited?: Set<string>,
): void {
  const depPackagesLen: number = depPackages.length;

  for (let i = depPackagesLen - 1; i >= 0; i--) {
    const localVisited = visited || new Set<string>();
    const packageImport: string = depPackages[i];
    const version = 'unknown';

    // ---------- Standard library handling ----------
    if (isStandardLibraryPackage(packagesByName[packageImport])) {
      if (!options.includeGoStandardLibraryDeps) {
        continue; // skip when flag disabled
      }

      // All standard library packages are prefixed with "std/"
      const stdPackageName = `std/${packageImport}`;

      // create synthetic node and connect, then continue loop
      const stdNode = createPkgInfo(
        stdPackageName,
        options.stdlibVersion || version,
        options,
      );

      depGraphBuilder.addPkgNode(stdNode, stdPackageName);
      depGraphBuilder.connectDep(currentParent, stdPackageName);
      continue;
    }

    // ---------- External package handling ----------
    const pkg = packagesByName[packageImport];
    if (!pkg || !pkg.DepOnly) {
      continue; // skip local or root-module packages
    }

    if (currentParent && packageImport) {
      const newNode = createPkgInfo(
        packageImport,
        version,
        options,
        pkg.Module,
      );

      const currentChildren = childrenChain.get(currentParent) || [];
      const currentAncestors = ancestorsChain.get(currentParent) || [];
      const isAncestorOrChild =
        currentChildren.includes(packageImport) ||
        currentAncestors.includes(packageImport);

      // @TODO boost: breaking cycles,  re-work once dep-graph lib can handle cycles
      if (packageImport === currentParent || isAncestorOrChild) {
        continue;
      }

      if (localVisited.has(packageImport)) {
        const prunedId = `${packageImport}:pruned`;
        depGraphBuilder.addPkgNode(newNode, prunedId, {
          labels: { pruned: 'true' },
        });
        depGraphBuilder.connectDep(currentParent, prunedId);
        continue;
      }

      depGraphBuilder.addPkgNode(newNode, packageImport);
      depGraphBuilder.connectDep(currentParent, packageImport);
      localVisited.add(packageImport);

      childrenChain.set(currentParent, [...currentChildren, packageImport]);
      ancestorsChain.set(packageImport, [...currentAncestors, currentParent]);

      const rawImports = packagesByName[packageImport].Imports || [];
      const transitives = [...new Set(rawImports.map(normalizeImportPath))];
      if (transitives.length > 0) {
        buildGraph(
          depGraphBuilder,
          transitives,
          packagesByName,
          packageImport,
          childrenChain,
          ancestorsChain,
          options,
          localVisited,
        );
      }
    }
  }
}

function extractAllImports(goDeps: GoPackage[]): string[] {
  const goDepsImports = new Set<string>();
  for (const pkg of goDeps) {
    if (pkg.Imports) {
      for (const imp of pkg.Imports) {
        goDepsImports.add(normalizeImportPath(imp));
      }
    }
  }
  return Array.from(goDepsImports);
}

function isStandardLibraryPackage(pkgName: GoPackage): boolean {
  // Go Standard Library Packages are marked as Standard: true
  return pkgName?.Standard === true;
}

// Normalize the ImportPath by stripping Go's variant annotations
// https://go.dev/doc/pgo
function normalizeImportPath(importPath: string): string {
  return importPath.split(' ')[0];
}

function createPkgInfo(
  packageImport: string,
  version: string,
  options: GraphOptions,
  goModule?: GoModule,
): PkgInfo {
  const useReplaceInfo = goModule?.Replace?.Path && goModule?.Replace?.Version;
  const includePurl = options.includePackageUrls && options.useReplaceName;

  /**
   * By default, the name is the full import path and the given version.
   */
  const pkg: PkgInfo = {
    name: packageImport,
    version,
  };

  /**
   * If the module has any .Version information, parse and use it.
   */
  if (goModule?.Version) {
    pkg.version = toSnykVersion(parseVersion(goModule.Version));
  }

  /**
   * If the module has a potential override with both .Path and .Version information,
   * use that information instead.
   */
  if (useReplaceInfo) {
    // Temporary: this is behind an option for controlled rollout and will
    // get cleaned up later.
    if (options.useReplaceName) {
      pkg.name = packageImport.replace(goModule.Path, goModule.Replace.Path);
    }
    pkg.version = toSnykVersion(parseVersion(goModule.Replace.Version));
  }

  /**
   * If no purls are being included, stop here.
   */
  if (!includePurl) {
    return pkg;
  }

  if (useReplaceInfo) {
    // Create purl from replaced module only if both .Name and .Version are present.
    pkg.purl = createGoPurl(goModule.Replace, pkg);
  } else if (goModule) {
    // Otherwise use the original module.
    pkg.purl = createGoPurl(goModule, pkg);
  } else {
    // Or if there is none, create a purl from the import path and given version.
    pkg.purl = createGoPurl({ Path: packageImport, Version: version });
  }

  return pkg;
}
