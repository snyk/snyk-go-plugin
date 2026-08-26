import * as path from 'path';
import { GoPackageManagerType } from 'snyk-go-parser';

const PACKAGE_MANAGER_BY_TARGET: { [k: string]: GoPackageManagerType } = {
  'Gopkg.lock': 'golangdep',
  'vendor.json': 'govendor',
  'go.mod': 'gomodules',
};

export function pkgManagerByTarget(targetFile: string): GoPackageManagerType {
  const fname = path.basename(targetFile);
  return PACKAGE_MANAGER_BY_TARGET[fname];
}
