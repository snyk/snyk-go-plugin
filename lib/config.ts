import * as fs from 'fs';
import * as path from 'path';
import {
  GoPackageConfig,
  parseGoPkgConfig,
  parseGoVendorConfig,
} from 'snyk-go-parser';

import { pkgManagerByTarget } from './pkg-manager';
import { debug } from './debug';

export async function parseConfig(
  root: string,
  targetFile: string,
): Promise<GoPackageConfig> {
  const pkgManager = pkgManagerByTarget(targetFile);
  debug('detected package-manager:', pkgManager);
  switch (pkgManager) {
    case 'golangdep': {
      try {
        return await parseGoPkgConfig(
          getDepManifest(root, targetFile),
          getDepLock(root, targetFile),
        );
      } catch (e: any) {
        throw new Error(
          'failed parsing manifest/lock files for Go dep: ' + e.message,
        );
      }
    }
    case 'govendor': {
      try {
        return await parseGoVendorConfig(getGovendorJson(root, targetFile));
      } catch (e: any) {
        throw new Error(
          'failed parsing config file for Go Vendor Tool: ' + e.message,
        );
      }
    }
    default: {
      throw new Error('Unsupported file: ' + targetFile);
    }
  }
}

function getDepLock(root: string, targetFile: string): string {
  return fs.readFileSync(path.join(root, targetFile), 'utf8');
}

function getDepManifest(root: string, targetFile: string): string {
  const manifestDir = path.dirname(path.join(root, targetFile));
  const manifestPath = path.join(manifestDir, 'Gopkg.toml');

  return fs.readFileSync(manifestPath, 'utf8');
}

// TODO: branch, old Version can be a tag too?
function getGovendorJson(root: string, targetFile: string): string {
  return fs.readFileSync(path.join(root, targetFile), 'utf8');
}
