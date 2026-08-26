import type { ModuleVersion } from 'snyk-go-parser';

const rePseudoVersion = /(v\d+\.\d+\.\d+)-(.*?)(\d{14})-([0-9a-f]{12})/;
const reExactVersion = /^(.*?)(\+incompatible)?$/;

export function parseVersion(versionString: string): ModuleVersion {
  const maybeRegexMatch = rePseudoVersion.exec(versionString);
  if (maybeRegexMatch) {
    const [baseVersion, suffix, timestamp, hash] = maybeRegexMatch.slice(1);
    return { baseVersion, suffix, timestamp, hash };
  } else {
    // No pseudo version recognized, assuming the provided version string is exact
    const [exactVersion, incompatibleStr] = reExactVersion
      .exec(versionString)!
      .slice(1);
    return { exactVersion, incompatible: !!incompatibleStr };
  }
}

export function toSnykVersion(v: ModuleVersion): string {
  if ('hash' in v && v.hash) {
    return '#' + v.hash;
  } else if ('exactVersion' in v && v.exactVersion) {
    return v.exactVersion.replace(/^v/, '');
  } else {
    throw new Error('Unexpected module version format');
  }
}
