import debugLib = require('debug');

export const debug = debugLib('snyk-go-plugin');

export function enable(): void {
  debugLib.enable('snyk-go-plugin');
}

export function disable(): void {
  debugLib.disable();
}
