import { PackageURL } from 'packageurl-js';

const PURL_TYPE_GOLANG = 'golang';

interface GoModule {
  Version: string;
  Path: string;
}

/**
 * Construct a PackageURL string for a given Go module and import path.
 *
 * For a definition of golang type purls, see:
 * https://github.com/package-url/purl-spec/blob/9041aa74236686b23153652f8cd3862eef8c33a9/types-doc/golang-definition.md
 */
export function createGoPurl(
  goModule: GoModule,
  importPath?: string,
): string | undefined {
  let namespace: string | undefined;
  let name: string | undefined;
  const version = goModule.Version;
  let subpath: string | undefined;

  // Split the module path into a name and namespace.
  // If the module path does not include any /, the path is
  // the purl name.
  const idx = goModule.Path.lastIndexOf('/');
  if (idx >= 0) {
    namespace = goModule.Path.slice(0, idx);
    name = goModule.Path.slice(idx + 1);
  } else {
    name = goModule.Path;
  }

  // If an import path was given and is not exactly matching the module's
  // path, we're dealing with a sub-package. This should go under the purl's
  // subpath.
  if (importPath && importPath !== goModule.Path) {
    subpath = importPath.replace(`${goModule.Path}/`, '');
  }

  return new PackageURL(
    PURL_TYPE_GOLANG,
    namespace,
    name,
    version,
    null,
    subpath,
  ).toString();
}
