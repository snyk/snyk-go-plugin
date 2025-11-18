import * as path from 'path';
import { DepGraph, DepGraphBuilder, PkgInfo } from '@snyk/dep-graph';

import { resolveStdlibVersion } from './helpers';
import { GoPackage, Options } from './types';
import { CustomError } from './errors/custom-error';
import { parseVersion, toSnykVersion } from './version';
import { runGo } from './sub-process';
import { createGoPurl, shouldIncludePackageUrls } from './package-url';

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

  const includePackageUrls = shouldIncludePackageUrls(options);

  return buildDepGraphFromImportsAndModules(root, targetFile, {
    stdlibVersion,
    additionalArgs,
    includeGoStandardLibraryDeps,
    includePackageUrls,
  });
}

interface GraphOptions {
  stdlibVersion?: string;
  additionalArgs?: string[];
  includeGoStandardLibraryDeps?: boolean;
  includePackageUrls?: boolean;
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
    ...options,
  };

  let rootPkg: PkgInfo = {
    name: projectName,
    version: projectVersion,
  };

  if (options.includePackageUrls) {
    rootPkg.purl = createGoPurl({
      Path: projectName,
      Version: projectVersion,
    });
  }

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
    packagesByName[gp.ImportPath] = gp; // ImportPath is the fully qualified name
  }

  const localPackages = goDeps.filter((gp) => !gp.DepOnly);
  const localPackageWithMainModule = localPackages.find(
    (localPackage) => !!(localPackage.Module && localPackage.Module.Main),
  );
  if (localPackageWithMainModule && localPackageWithMainModule!.Module!.Path) {
    rootPkg = {
      name: localPackageWithMainModule!.Module!.Path,
      version: projectVersion,
    };
    if (options.includePackageUrls) {
      rootPkg.purl = createGoPurl({
        Path: rootPkg.name,
        Version: rootPkg.version!,
      });
    }
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
    let version = 'unknown';

    // ---------- Standard library handling ----------
    if (isStandardLibraryPackage(packagesByName[packageImport])) {
      if (!options.includeGoStandardLibraryDeps) {
        continue; // skip when flag disabled
      }

      // All standard library packages are prefixed with "std/"
      const stdPackageName = `std/${packageImport}`;

      // create synthetic node and connect, then continue loop
      const stdNode: PkgInfo = {
        name: stdPackageName,
        version: options.stdlibVersion,
      };
      if (options.includePackageUrls) {
        stdNode.purl = createGoPurl({
          Path: stdPackageName,
          Version: options.stdlibVersion!,
        });
      }
      depGraphBuilder.addPkgNode(stdNode, stdPackageName);
      depGraphBuilder.connectDep(currentParent, stdPackageName);
      continue;
    }

    // ---------- External package handling ----------
    const pkgMeta = packagesByName[packageImport];
    if (!pkgMeta || !pkgMeta.DepOnly) {
      continue; // skip local or root-module packages
    }

    const pkg = pkgMeta;
    const module = pkg.Module?.Replace || pkg.Module;
    if (module?.Version) {
      // get hash (prefixed with #) or version (with v prefix removed)
      version = toSnykVersion(parseVersion(module.Version));
    }

    if (currentParent && packageImport) {
      const newNode: PkgInfo = {
        name: packageImport,
        version,
      };

      const currentChildren = childrenChain.get(currentParent) || [];
      const currentAncestors = ancestorsChain.get(currentParent) || [];
      const isAncestorOrChild =
        currentChildren.includes(packageImport) ||
        currentAncestors.includes(packageImport);

      // @TODO boost: breaking cycles,  re-work once dep-graph lib can handle cycles
      if (packageImport === currentParent || isAncestorOrChild) {
        continue;
      }

      if (options.includePackageUrls && module) {
        newNode.purl = createGoPurl(
          {
            Path: module.Path,
            Version: module.Version,
          },
          packageImport,
        );
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

      const transitives = packagesByName[packageImport].Imports! || [];
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
        goDepsImports.add(imp);
      }
    }
  }
  return Array.from(goDepsImports);
}

function isStandardLibraryPackage(pkgName: GoPackage): boolean {
  // Go Standard Library Packages are marked as Standard: true
  return pkgName?.Standard === true;
}
